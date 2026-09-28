const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

function cleanPrivateKey(value) {
  if (!value) return value;
  const trimmed = value.trim();
  const unquoted = trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1)
    : trimmed;
  return unquoted.replace(/\\n/g, '\n');
}

function firebaseApp() {
  const [existing] = getApps();
  if (existing) return existing;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = cleanPrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Firebase Admin is not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.',
    );
  }

  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

// firebase-admin 13+ only has the modular API. This keeps the
// getFirebaseAdmin().auth() shape the rest of the app uses.
function getFirebaseAdmin() {
  const app = firebaseApp();
  return { auth: () => getAuth(app) };
}

module.exports = { getFirebaseAdmin, cleanPrivateKey };
