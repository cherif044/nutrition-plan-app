const { getFirebaseAdmin } = require('../config/firebaseAdmin');
const { assertFirebaseTokenCanAccessApp } = require('../services/firebaseAuthService');
const { findUserByFirebaseUid } = require('../repositories/userRepository');

const SESSION_COOKIE_NAME = '__session';

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
  res.clearCookie('token', sessionCookieOptions());
}

function extractBearerToken(req) {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

async function verifyFirebaseRequest(req) {
  const sessionCookie = req.cookies?.[SESSION_COOKIE_NAME];
  const bearerToken = extractBearerToken(req);
  if (!sessionCookie && !bearerToken) return null;

  const firebase = getFirebaseAdmin();
  if (sessionCookie) {
    return firebase.auth().verifySessionCookie(sessionCookie, true);
  }

  if (bearerToken) {
    return firebase.auth().verifyIdToken(bearerToken, true);
  }

  return null;
}

async function requireAuth(req, res, next) {
  let decodedToken;
  try {
    decodedToken = await verifyFirebaseRequest(req);
    if (!decodedToken) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    assertFirebaseTokenCanAccessApp(decodedToken);
  } catch (err) {
    const status = err.status || 401;
    return res.status(status).json({
      error: status === 403
        ? err.message
        : 'Invalid or expired session. Please log in again.',
      code: err.code,
    });
  }

  const user = await findUserByFirebaseUid(decodedToken.uid).catch(() => null);
  if (!user) {
    return res.status(401).json({ error: 'Application user not found. Please log in again.' });
  }

  req.firebaseToken = decodedToken;
  req.firebaseUid = decodedToken.uid;
  req.user = user;
  next();
}

module.exports = {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  extractBearerToken,
  requireAuth,
  sessionCookieOptions,
  verifyFirebaseRequest,
};
