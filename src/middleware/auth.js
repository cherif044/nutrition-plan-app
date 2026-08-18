const jwt = require('jsonwebtoken');
const { findUserById } = require('../repositories/userRepository');

const SESSION_COOKIE_NAME = 'token';

function sessionCookieOptions(maxAge) {
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  };
  if (maxAge) options.maxAge = maxAge;
  return options;
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions());
  res.clearCookie('__session', sessionCookieOptions());
}

function extractBearerToken(req) {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw Object.assign(new Error('JWT_SECRET is required.'), { status: 500 });
  }
  return secret;
}

function verifyAppJwtRequest(req) {
  const sessionCookie = req.cookies?.[SESSION_COOKIE_NAME];
  const bearerToken = extractBearerToken(req);
  if (!sessionCookie && !bearerToken) return null;

  return jwt.verify(sessionCookie || bearerToken, jwtSecret());
}

async function requireAuth(req, res, next) {
  let session;
  try {
    session = verifyAppJwtRequest(req);
    if (!session?.userId) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
  } catch (err) {
    const status = err.status || (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError' ? 401 : 500);
    return res.status(status).json({
      error: status >= 500 ? err.message : 'Invalid or expired session. Please log in again.',
      code: err.code,
    });
  }

  const user = await findUserById(session.userId).catch(() => null);
  if (!user) {
    return res.status(401).json({ error: 'Application user not found. Please log in again.' });
  }

  const userTokenVersion = Number(user.token_version || 0);
  const sessionTokenVersion = Number(session.tokenVersion || 0);
  if (userTokenVersion !== sessionTokenVersion) {
    return res.status(401).json({
      error: 'Session has been revoked. Please log in again.',
      code: 'session-revoked',
    });
  }

  req.session = session;
  req.firebaseUid = user.firebase_uid || session.firebaseUid || null;
  req.user = user;
  next();
}

module.exports = {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  extractBearerToken,
  requireAuth,
  sessionCookieOptions,
  verifyAppJwtRequest,
};
