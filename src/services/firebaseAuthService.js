const MAX_SESSION_MS = 5 * 24 * 60 * 60 * 1000;
const REQUIRED_PUBLIC_CONFIG = ['apiKey', 'authDomain', 'projectId', 'appId'];

function normalizeEmail(email) {
  if (typeof email !== 'string') return null;
  const value = email.trim().toLowerCase();
  return value || null;
}

function splitDisplayName(displayName, email) {
  const cleaned = typeof displayName === 'string' ? displayName.trim().replace(/\s+/g, ' ') : '';
  if (cleaned) {
    const [first, ...rest] = cleaned.split(' ');
    return {
      firstname: limitName(first || 'User'),
      lastname: limitName(rest.join(' ')),
    };
  }

  const localPart = normalizeEmail(email)?.split('@')[0] || 'user';
  const readable = localPart
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!readable) return { firstname: 'User', lastname: '' };
  const [first, ...rest] = readable.split(' ');
  return {
    firstname: limitName(capitalize(first)),
    lastname: limitName(rest.map(capitalize).join(' ')),
  };
}

function limitName(value) {
  return String(value || '').trim().slice(0, 50);
}

function capitalize(value) {
  const text = String(value || '');
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function providerId(decodedToken) {
  return decodedToken?.firebase?.sign_in_provider || null;
}

function isEmailPasswordProvider(decodedToken) {
  return providerId(decodedToken) === 'password';
}

function assertFirebaseTokenCanAccessApp(decodedToken) {
  if (!decodedToken?.uid) {
    const err = new Error('Invalid Firebase authentication token.');
    err.status = 401;
    throw err;
  }

  if (isEmailPasswordProvider(decodedToken) && decodedToken.email_verified !== true) {
    const err = new Error('Please verify your email address before continuing.');
    err.status = 403;
    err.code = 'email-not-verified';
    throw err;
  }
}

function profileFromFirebaseToken(decodedToken, clientProfile = {}) {
  const email = normalizeEmail(decodedToken.email);
  const displayName = decodedToken.name || clientProfile.displayName || '';
  const names = splitDisplayName(displayName, email);

  return {
    firebaseUid: decodedToken.uid,
    email,
    usernameSeed: email || decodedToken.uid,
    firstname: limitName(clientProfile.firstname) || names.firstname || 'User',
    lastname: limitName(clientProfile.lastname) || names.lastname || '',
    provider: providerId(decodedToken),
  };
}

function publicFirebaseConfigFromEnv(env = process.env) {
  const config = {
    apiKey: env.FIREBASE_WEB_API_KEY,
    authDomain: env.FIREBASE_WEB_AUTH_DOMAIN,
    projectId: env.FIREBASE_WEB_PROJECT_ID || env.FIREBASE_PROJECT_ID,
    appId: env.FIREBASE_WEB_APP_ID,
  };

  if (env.FIREBASE_WEB_MESSAGING_SENDER_ID) {
    config.messagingSenderId = env.FIREBASE_WEB_MESSAGING_SENDER_ID;
  }
  if (env.FIREBASE_WEB_STORAGE_BUCKET) {
    config.storageBucket = env.FIREBASE_WEB_STORAGE_BUCKET;
  }
  if (env.FIREBASE_WEB_MEASUREMENT_ID) {
    config.measurementId = env.FIREBASE_WEB_MEASUREMENT_ID;
  }

  const missing = REQUIRED_PUBLIC_CONFIG.filter((key) => !config[key]);
  return { config, missing };
}

module.exports = {
  MAX_SESSION_MS,
  assertFirebaseTokenCanAccessApp,
  cleanPrivateKey: require('../config/firebaseAdmin').cleanPrivateKey,
  isEmailPasswordProvider,
  normalizeEmail,
  profileFromFirebaseToken,
  publicFirebaseConfigFromEnv,
  splitDisplayName,
};
