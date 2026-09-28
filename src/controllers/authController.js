const { getFirebaseAdmin } = require('../config/firebaseAdmin');
const {
  assertFirebaseTokenCanAccessApp,
  profileFromFirebaseToken,
  publicFirebaseConfigFromEnv,
} = require('../services/firebaseAuthService');
const { SESSION_ABSOLUTE_MS } = require('../config/session');
const {
  clearSessionCookie,
  sessionCookieOptions,
  sessionIdFromRequest,
  signSessionToken,
  SESSION_COOKIE_NAME,
} = require('../middleware/auth');
const { incrementTokenVersion, syncFirebaseUser } = require('../repositories/userRepository');
const {
  createSessionRecord,
  revokeAllSessionsForUser,
  revokeSession,
} = require('../repositories/sessionRepository');
const { deleteAccount } = require('../services/accountDeletionService');
const { hashIp } = require('../utils/ipHash');
const { logger } = require('../utils/logger');
const { firebaseCall } = require('../utils/firebaseCall');

const RECENT_LOGIN_MS = 5 * 60 * 1000;

function serializeUser(user) {
  return {
    id: user.id,
    firebaseUid: user.firebase_uid,
    email: user.email,
    username: user.username,
    firstname: user.firstname,
    lastname: user.lastname,
  };
}

// The auth domain is where Firebase runs its sign-in and password-reset
// handler pages. It comes only from configuration, never from the request's
// Host / X-Forwarded-Host header, which a proxy or cache could let a client
// choose. FIREBASE_AUTH_DOMAINS lists extra hosts that serve the /__/auth
// proxy (vercel.json); a request from one of them uses its own host so the
// sign-in popup stays same-origin.
const DEFAULT_AUTH_DOMAINS = 'pincherize.vercel.app';

function allowedAuthDomains(env = process.env) {
  return String(env.FIREBASE_AUTH_DOMAINS ?? DEFAULT_AUTH_DOMAINS)
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

function requestHost(req) {
  return String(req.hostname || '').toLowerCase();
}

function getFirebaseConfig(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const { config, missing } = publicFirebaseConfigFromEnv();
  if (missing.length > 0) {
    logger.error('Firebase web configuration is incomplete', { requestId: req.id, missing });
    const body = { error: 'Sign-in is not configured yet.' };
    // Env var names help local setup but tell an outsider nothing useful.
    if (process.env.NODE_ENV !== 'production') body.missing = missing;
    return res.status(500).json(body);
  }
  const host = requestHost(req);
  if (host && allowedAuthDomains().includes(host)) config.authDomain = host;
  return res.json(config);
}

function requestFailure(err) {
  if (err.code === 'auth/id-token-expired'
    || err.code === 'auth/id-token-revoked'
    || err.code === 'auth/argument-error'
    || err.code === 'auth/user-disabled') {
    return { status: 401, error: 'Invalid or expired Firebase login. Please try again.' };
  }
  if (err.status && err.status < 500) return { status: err.status, error: err.message, code: err.code };
  return null;
}

async function createSession(req, res, next) {
  try {
    const { idToken, profile } = req.body;
    const decodedToken = await firebaseCall(
      'verify_token',
      () => getFirebaseAdmin().auth().verifyIdToken(idToken, true),
    );
    assertFirebaseTokenCanAccessApp(decodedToken);

    const authTimeMs = decodedToken.auth_time ? decodedToken.auth_time * 1000 : 0;
    if (Date.now() - authTimeMs > RECENT_LOGIN_MS) {
      return res.status(401).json({ error: 'Please log in again before starting a new session.' });
    }

    const user = await syncFirebaseUser(profileFromFirebaseToken(decodedToken, profile || {}));
    if (user.deletion_pending_at) {
      return res.status(403).json({ error: 'This account is being deleted.' });
    }
    const session = await createSessionRecord(user.id, {
      userAgent: req.get('user-agent'),
      ipHash: hashIp(req.ip, { daily: false }),
    });

    clearSessionCookie(res);
    res.cookie(SESSION_COOKIE_NAME, signSessionToken(user, session), sessionCookieOptions(SESSION_ABSOLUTE_MS));
    logger.info('Session created', { requestId: req.id, provider: decodedToken.firebase?.sign_in_provider });
    return res.json({ user: serializeUser(user) });
  } catch (err) {
    const failure = requestFailure(err);
    if (failure) return res.status(failure.status).json({ error: failure.error, code: failure.code });
    return next(err);
  }
}

// Logout works even for an invalid or expired session: whatever session the
// cookie names is revoked, and the cookie is cleared either way.
async function logout(req, res, next) {
  try {
    const sessionId = sessionIdFromRequest(req);
    if (sessionId) await revokeSession(sessionId);
    clearSessionCookie(res);
    res.setHeader('Clear-Site-Data', '"cache"');
    res.json({ message: 'Logged out successfully.' });
  } catch (err) {
    next(err);
  }
}

// Ends every session of this account on every device: the token version
// bump invalidates all issued JWTs, the rows are revoked, and Firebase
// refresh tokens are revoked so no device can silently mint a new login.
async function logoutAll(req, res, next) {
  try {
    await incrementTokenVersion(req.user.id);
    const revoked = await revokeAllSessionsForUser(req.user.id);
    if (req.firebaseUid) {
      await firebaseCall(
        'revoke_refresh_tokens',
        () => getFirebaseAdmin().auth().revokeRefreshTokens(req.firebaseUid),
      );
    }
    logger.info('All sessions revoked', { requestId: req.id, userId: req.user.id, revoked });
    clearSessionCookie(res);
    res.setHeader('Clear-Site-Data', '"cache"');
    res.json({ ok: true, revoked });
  } catch (err) {
    next(err);
  }
}

// Browser-side auth email events (reset / verification requests), logged
// without the email address so abuse of those buttons is visible.
function authClientEvent(req, res) {
  logger.info('Auth client event', {
    requestId: req.id,
    event: req.body.event,
    ipHash: hashIp(req.ip),
  });
  res.status(204).end();
}

function getMe(req, res) {
  res.json({ user: serializeUser(req.user) });
}

// Deleting an account needs a fresh Firebase login for this same account and
// an explicit confirmation, so a stolen session cookie alone cannot do it.
async function deleteUserHandler(req, res, next) {
  try {
    const decoded = await firebaseCall(
      'verify_token',
      () => getFirebaseAdmin().auth().verifyIdToken(req.body.idToken, true),
    );
    if (!req.firebaseUid || decoded.uid !== req.firebaseUid) {
      return res.status(403).json({ error: 'Please sign in with this account to delete it.' });
    }
    const authTimeMs = decoded.auth_time ? decoded.auth_time * 1000 : 0;
    if (Date.now() - authTimeMs > RECENT_LOGIN_MS) {
      return res.status(401).json({
        error: 'Please confirm your password or Google sign-in again, then retry.',
        code: 'reauth-required',
      });
    }

    await deleteAccount(req.user.id, req.firebaseUid, { requestId: req.id });
    clearSessionCookie(res);
    res.setHeader('Clear-Site-Data', '"cache", "cookies", "storage"');
    return res.json({ ok: true });
  } catch (err) {
    const failure = requestFailure(err);
    if (failure) return res.status(failure.status).json({ error: failure.error, code: failure.code });
    return next(err);
  }
}

module.exports = {
  authClientEvent,
  createSession,
  deleteUserHandler,
  getFirebaseConfig,
  getMe,
  logout,
  logoutAll,
};
