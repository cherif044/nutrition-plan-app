const { createUser, verifyPassword } = require('../services/userService');
const { findUserByUsername, updateLastLogin, incrementTokenVersion } = require('../repositories/userRepository');
const { signToken } = require('../middleware/auth');

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

async function register(req, res, next) {
  try {
    const { username, password, firstname, lastname } = req.body || {};
    const user = await createUser({ username, password, firstname, lastname });
    const token = signToken({ userId: user.id, tokenVersion: 0 });
    res.cookie('token', token, COOKIE_OPTS);
    console.log(`[auth] Registered and logged in: ${user.username}`);
    res.status(201).json({
      user: { id: user.id, username: user.username, firstname: user.firstname, lastname: user.lastname },
    });
  } catch (err) {
    if (err.message.match(/too weak|must be|may only|already taken|at least|at most/i)) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const user = await findUserByUsername(username);
    if (!user) {
      console.log(`[auth] Failed login attempt for unknown user: ${username}`);
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      console.log(`[auth] Failed login attempt for user: ${username}`);
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    await updateLastLogin(user.id);
    const token = signToken({ userId: user.id, tokenVersion: user.token_version });
    res.cookie('token', token, COOKIE_OPTS);
    console.log(`[auth] Login successful: ${user.username}`);
    res.json({
      user: { id: user.id, username: user.username, firstname: user.firstname, lastname: user.lastname },
    });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    await incrementTokenVersion(req.user.id);
    console.log(`[auth] Logged out: ${req.user.username}`);
    res.clearCookie('token');
    res.json({ message: 'Logged out successfully.' });
  } catch (err) {
    next(err);
  }
}

async function revokeAllSessions(req, res, next) {
  try {
    await incrementTokenVersion(req.user.id);
    console.log(`[auth] All sessions revoked for: ${req.user.username}`);
    res.clearCookie('token');
    res.json({ message: 'All sessions revoked.' });
  } catch (err) {
    next(err);
  }
}

function getMe(req, res) {
  const { id, username, firstname, lastname } = req.user;
  res.json({ user: { id, username, firstname, lastname } });
}

module.exports = { register, login, logout, revokeAllSessions, getMe };
