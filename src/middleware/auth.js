const jwt = require('jsonwebtoken');
const { findUserById } = require('../models/User');

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is not set.');
  return secret;
}

function signToken(payload) {
  return jwt.sign(payload, getSecret(), { expiresIn: '7d' });
}

function verifyToken(token) {
  return jwt.verify(token, getSecret());
}

function extractToken(req) {
  const cookie = req.cookies?.token;
  if (cookie) return cookie;
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

async function requireAuth(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
  }

  const user = await findUserById(payload.userId).catch(() => null);
  if (!user) {
    return res.status(401).json({ error: 'User not found.' });
  }

  if (user.token_version !== payload.tokenVersion) {
    return res.status(401).json({ error: 'Session has been revoked. Please log in again.' });
  }

  req.user = user;
  next();
}

module.exports = { requireAuth, signToken, verifyToken, extractToken };
