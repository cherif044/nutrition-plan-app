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

// Names are shown across the app and in PDFs; drop control and bidi-override
// characters that could garble or disguise how they render.
// eslint-disable-next-line no-control-regex
const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g;

function limitName(value) {
  if (typeof value !== 'string') return '';
  return value.replace(UNSAFE_NAME_CHARS, '').trim().slice(0, 50);
}

function capitalize(value) {
  const text = String(value || '');
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function providerId(decodedToken) {
  return decodedToken?.firebase?.sign_in_provider || null;
}

// Only these sign-in methods may open an app session. Enabling another
// provider in Firebase must be a deliberate code change, because the app
// links accounts by email and an unverified email from some other provider
// could otherwise claim (squat) a real person's address.
const ALLOWED_SIGN_IN_PROVIDERS = new Set(['password', 'google.com']);

function assertFirebaseTokenCanAccessApp(decodedToken) {
  if (!decodedToken?.uid) {
    const err = new Error('Invalid Firebase authentication token.');
    err.status = 401;
    throw err;
  }

  if (!ALLOWED_SIGN_IN_PROVIDERS.has(providerId(decodedToken))) {
    const err = new Error('This sign-in method is not supported.');
    err.status = 403;
    err.code = 'provider-not-allowed';
    throw err;
  }

  if (decodedToken.email_verified !== true) {
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
    emailVerified: decodedToken.email_verified === true,
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
  ALLOWED_SIGN_IN_PROVIDERS,
  assertFirebaseTokenCanAccessApp,
  cleanPrivateKey: require('../../config/firebaseAdmin').cleanPrivateKey,
  normalizeEmail,
  profileFromFirebaseToken,
  publicFirebaseConfigFromEnv,
  splitDisplayName,
};
