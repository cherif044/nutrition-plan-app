const jwt = require('jsonwebtoken');
const {
  FIREBASE_OUTAGE_READ_GRACE_MS,
  FIREBASE_RECHECK_MS,
  JWT_ALGORITHM,
  JWT_AUDIENCE,
  JWT_ISSUER,
  LEGACY_COOKIE_NAMES,
  SESSION_COOKIE_NAME,
  SESSION_IDLE_MS,
  SESSION_TOUCH_INTERVAL_MS,
  jwtSecret,
} = require('../config/session');
const { findUserById } = require('../features/auth/userRepository');
const {
  findSessionById,
  markFirebaseChecked,
  revokeSession,
  touchSession,
} = require('../features/auth/sessionRepository');
const { getFirebaseAdmin } = require('../config/firebaseAdmin');
const { firebaseCall } = require('../utils/firebaseCall');
const { logger } = require('../utils/logger');
const { hashIp } = require('../utils/ipHash');
const { recordSessionRejection } = require('../utils/metrics');

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function elapsedMs(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1e6;
}

function recordMetric(req, key, value) {
  req.metrics = req.metrics || {};
  req.metrics[key] = Number(value.toFixed(1));
}

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
  for (const name of LEGACY_COOKIE_NAMES) res.clearCookie(name, sessionCookieOptions());
}

function signSessionToken(user, session) {
  return jwt.sign(
    { sid: String(session.id), tokenVersion: Number(user.token_version || 0) },
    jwtSecret(),
    {
      algorithm: JWT_ALGORITHM,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      subject: String(user.id),
      expiresIn: Math.floor((new Date(session.expires_at).getTime() - Date.now()) / 1000),
    },
  );
}

// Only the session cookie authenticates a request. There is no bearer-token
// path: the UI never used one, and it would bypass the cookie's SameSite and
// the Origin check.
function verifySessionToken(token) {
  return jwt.verify(token, jwtSecret(), {
    algorithms: [JWT_ALGORITHM],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

function unauthorized(req, res, reason, error = 'Invalid or expired session. Please log in again.') {
  recordSessionRejection(reason);
  logger.info('Session rejected', { requestId: req.id, reason, ipHash: hashIp(req.ip) });
  clearSessionCookie(res);
  return res.status(401).json({ error, code: 'session-invalid' });
}

function sessionProblem(session, claims, now) {
  if (!session) return 'missing';
  if (String(session.user_id) !== String(claims.sub)) return 'user_mismatch';
  if (session.revoked_at) return 'revoked';
  if (new Date(session.expires_at).getTime() <= now) return 'expired';
  if (new Date(session.last_seen_at).getTime() + SESSION_IDLE_MS <= now) return 'idle';
  return null;
}

// Re-reads the Firebase account at most every FIREBASE_RECHECK_MS. A disabled
// or deleted account, or a password reset / "revoke all" in Firebase
// (tokensValidAfterTime after this session started), ends the session.
// Returns 'ok', 'revoked' or 'unavailable'.
async function checkFirebaseAccount(req, session, user, now) {
  if (!user.firebase_uid) return 'ok';
  const checkedAt = new Date(session.firebase_checked_at).getTime();
  if (now - checkedAt < FIREBASE_RECHECK_MS) return 'ok';

  let record;
  try {
    record = await firebaseCall('get_user', () => getFirebaseAdmin().auth().getUser(user.firebase_uid));
  } catch (error) {
    if (error?.code === 'auth/user-not-found') return 'revoked';
    logger.warn('Firebase account check failed', {
      requestId: req.id,
      error: { name: error?.name, code: error?.code },
    });
    const withinGrace = now - checkedAt < FIREBASE_OUTAGE_READ_GRACE_MS;
    return READ_METHODS.has(req.method) && withinGrace ? 'ok' : 'unavailable';
  }

  const validAfter = Date.parse(record.tokensValidAfterTime || '') || 0;
  if (record.disabled || validAfter > new Date(session.created_at).getTime()) return 'revoked';

  await markFirebaseChecked(session.id, new Date(now)).catch(() => {});
  return 'ok';
}

async function requireAuth(req, res, next) {
  // Some routers authenticate before their account-keyed rate limiter; the
  // route's own requireAuth then has nothing left to do.
  if (req.user && req.session?.id) return next();
  const authStartedAt = process.hrtime.bigint();
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Authentication required.' });

  let claims;
  try {
    const jwtStartedAt = process.hrtime.bigint();
    claims = verifySessionToken(token);
    recordMetric(req, 'authJwtMs', elapsedMs(jwtStartedAt));
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError' || err.name === 'NotBeforeError') {
      return unauthorized(req, res, 'invalid_token');
    }
    return next(err);
  }
  if (!claims?.sid || !claims?.sub) return unauthorized(req, res, 'invalid_token');

  try {
    const lookupStartedAt = process.hrtime.bigint();
    const [session, user] = await Promise.all([
      findSessionById(claims.sid),
      findUserById(claims.sub),
    ]);
    recordMetric(req, 'authUserLookupMs', elapsedMs(lookupStartedAt));

    const now = Date.now();
    const problem = sessionProblem(session, claims, now);
    if (problem) return unauthorized(req, res, problem);
    if (!user || user.deletion_pending_at) {
      return unauthorized(req, res, 'user_missing', 'Application user not found. Please log in again.');
    }
    if (Number(user.token_version || 0) !== Number(claims.tokenVersion || 0)) {
      return unauthorized(req, res, 'token_version', 'Session has been revoked. Please log in again.');
    }

    const firebaseStatus = await checkFirebaseAccount(req, session, user, now);
    if (firebaseStatus === 'revoked') {
      await revokeSession(session.id).catch(() => {});
      return unauthorized(req, res, 'firebase_revoked', 'Session has been revoked. Please log in again.');
    }
    if (firebaseStatus === 'unavailable') {
      res.setHeader('Retry-After', '30');
      return res.status(503).json({
        error: 'Sign-in could not be confirmed right now. Please try again shortly.',
        requestId: req.id,
      });
    }

    if (now - new Date(session.last_seen_at).getTime() >= SESSION_TOUCH_INTERVAL_MS) {
      touchSession(session.id, new Date(now));
    }

    req.session = { id: session.id, createdAt: session.created_at };
    req.firebaseUid = user.firebase_uid || null;
    req.user = user;
    recordMetric(req, 'authTotalMs', elapsedMs(authStartedAt));
    return next();
  } catch (err) {
    return next(err);
  }
}

// Reads the session id from the cookie without requiring the session to be
// valid, so logout can revoke whatever the browser still holds.
function sessionIdFromRequest(req) {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (!token) return null;
  try {
    return verifySessionToken(token).sid || null;
  } catch {
    return null;
  }
}

module.exports = {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  requireAuth,
  sessionCookieOptions,
  sessionIdFromRequest,
  signSessionToken,
  verifySessionToken,
};
