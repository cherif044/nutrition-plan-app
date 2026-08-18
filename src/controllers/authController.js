const jwt = require('jsonwebtoken');
const { getFirebaseAdmin } = require('../config/firebaseAdmin');
const {
  MAX_SESSION_MS,
  assertFirebaseTokenCanAccessApp,
  profileFromFirebaseToken,
  publicFirebaseConfigFromEnv,
} = require('../services/firebaseAuthService');
const { clearSessionCookie, sessionCookieOptions, SESSION_COOKIE_NAME } = require('../middleware/auth');
const { deleteUser, syncFirebaseUser } = require('../repositories/userRepository');

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

function legacyPasswordAuthDisabled(_req, res) {
  res.status(410).json({
    error: 'Password authentication is handled by Firebase. Please use the current login form.',
  });
}

function publicHost(req) {
  const forwarded = req.headers['x-forwarded-host'];
  const host = Array.isArray(forwarded) ? forwarded[0] : forwarded || req.get('host') || '';
  return String(host).split(',')[0].trim();
}

function shouldUseRequestHostForAuthDomain(host) {
  return host
    && !host.startsWith('localhost')
    && !host.startsWith('127.0.0.1')
    && !host.endsWith('.local');
}

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw Object.assign(new Error('JWT_SECRET is required.'), { status: 500 });
  }
  return secret;
}

function signSessionToken(user) {
  return jwt.sign(
    {
      userId: String(user.id),
      firebaseUid: user.firebase_uid,
      tokenVersion: Number(user.token_version || 0),
    },
    jwtSecret(),
    {
      subject: String(user.id),
      expiresIn: process.env.JWT_EXPIRES_IN || '5d',
    },
  );
}

function getFirebaseConfig(req, res) {
  const { config, missing } = publicFirebaseConfigFromEnv();
  if (missing.length > 0) {
    return res.status(500).json({
      error: 'Firebase web configuration is incomplete.',
      missing: missing.map((key) => {
        if (key === 'apiKey') return 'FIREBASE_WEB_API_KEY';
        if (key === 'authDomain') return 'FIREBASE_WEB_AUTH_DOMAIN';
        if (key === 'projectId') return 'FIREBASE_WEB_PROJECT_ID or FIREBASE_PROJECT_ID';
        if (key === 'appId') return 'FIREBASE_WEB_APP_ID';
        return key;
      }),
    });
  }
  const host = publicHost(req);
  if (shouldUseRequestHostForAuthDomain(host)) {
    config.authDomain = host;
  }
  res.json(config);
}

async function createSession(req, res, next) {
  try {
    const { idToken, profile = {} } = req.body || {};
    if (!idToken || typeof idToken !== 'string') {
      return res.status(400).json({ error: 'Firebase ID token is required.' });
    }

    const firebase = getFirebaseAdmin();
    const decodedToken = await firebase.auth().verifyIdToken(idToken, true);
    assertFirebaseTokenCanAccessApp(decodedToken);

    const authTimeMs = decodedToken.auth_time ? decodedToken.auth_time * 1000 : 0;
    if (Date.now() - authTimeMs > 5 * 60 * 1000) {
      return res.status(401).json({ error: 'Please log in again before starting a new session.' });
    }

    const userProfile = profileFromFirebaseToken(decodedToken, profile);
    const user = await syncFirebaseUser(userProfile);
    const sessionToken = signSessionToken(user);

    clearSessionCookie(res);
    res.cookie(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions(MAX_SESSION_MS));
    res.json({ user: serializeUser(user) });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    if (err.code === 'auth/id-token-expired' || err.code === 'auth/argument-error') {
      return res.status(401).json({ error: 'Invalid or expired Firebase login. Please try again.' });
    }
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    clearSessionCookie(res);
    res.json({ message: 'Logged out successfully.' });
  } catch (err) {
    next(err);
  }
}

function getMe(req, res) {
  res.json({ user: serializeUser(req.user) });
}

async function deleteUserHandler(req, res, next) {
  try {
    const firebaseUid = req.firebaseUid;
    const ok = await deleteUser(req.user.id);
    if (!ok) return res.status(404).json({ error: 'User not found.' });

    if (firebaseUid) {
      await getFirebaseAdmin().auth().deleteUser(firebaseUid).catch((err) => {
        if (err.code !== 'auth/user-not-found') throw err;
      });
    }

    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createSession,
  deleteUserHandler,
  getFirebaseConfig,
  getMe,
  legacyPasswordAuthDisabled,
  logout,
};
