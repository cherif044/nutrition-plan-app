const assert = require('assert');

const {
  assertFirebaseTokenCanAccessApp,
  cleanPrivateKey,
  profileFromFirebaseToken,
  publicFirebaseConfigFromEnv,
  splitDisplayName,
} = require('../src/services/firebaseAuthService');
const { usernameBaseFromSeed } = require('../src/repositories/userRepository');

function assertThrowsWithStatus(fn, status) {
  let thrown = null;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  assert(thrown, 'Expected function to throw');
  assert.strictEqual(thrown.status, status);
}

function testPrivateKeyCleaning() {
  const raw = '"-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n"';
  assert.strictEqual(cleanPrivateKey(raw), '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n');
}

function testPublicFirebaseConfig() {
  const { config, missing } = publicFirebaseConfigFromEnv({
    FIREBASE_PROJECT_ID: 'server-project',
    FIREBASE_WEB_API_KEY: 'api-key',
    FIREBASE_WEB_AUTH_DOMAIN: 'example.firebaseapp.com',
    FIREBASE_WEB_APP_ID: 'app-id',
  });

  assert.deepStrictEqual(missing, []);
  assert.strictEqual(config.projectId, 'server-project');

  const incomplete = publicFirebaseConfigFromEnv({});
  assert(incomplete.missing.includes('apiKey'));
  assert(incomplete.missing.includes('authDomain'));
  assert(incomplete.missing.includes('projectId'));
  assert(incomplete.missing.includes('appId'));
}

function testEmailVerificationGate() {
  assert.doesNotThrow(() => assertFirebaseTokenCanAccessApp({
    uid: 'firebase-uid-1',
    email_verified: true,
    firebase: { sign_in_provider: 'password' },
  }));

  assertThrowsWithStatus(() => assertFirebaseTokenCanAccessApp({
    uid: 'firebase-uid-2',
    email_verified: false,
    firebase: { sign_in_provider: 'password' },
  }), 403);

  assert.doesNotThrow(() => assertFirebaseTokenCanAccessApp({
    uid: 'firebase-uid-3',
    email_verified: true,
    firebase: { sign_in_provider: 'google.com' },
  }));
}

function testProfileDerivation() {
  assert.deepStrictEqual(splitDisplayName('Ada Lovelace', 'ada@example.com'), {
    firstname: 'Ada',
    lastname: 'Lovelace',
  });

  const profile = profileFromFirebaseToken({
    uid: 'firebase-uid-4',
    email: 'ADA@Example.COM ',
    name: 'Ada Lovelace',
    firebase: { sign_in_provider: 'google.com' },
  });

  assert.strictEqual(profile.firebaseUid, 'firebase-uid-4');
  assert.strictEqual(profile.email, 'ada@example.com');
  assert.strictEqual(profile.firstname, 'Ada');
  assert.strictEqual(profile.lastname, 'Lovelace');
  assert.strictEqual(profile.provider, 'google.com');
}

function testUsernameBase() {
  assert.strictEqual(usernameBaseFromSeed('Ada.Lovelace@example.com'), 'ada.lovelace');
  assert.strictEqual(usernameBaseFromSeed('12345@example.com'), 'user');
  assert.strictEqual(usernameBaseFromSeed(' -- pin ch -- '), 'pinch--');
}

testPrivateKeyCleaning();
testPublicFirebaseConfig();
testEmailVerificationGate();
testProfileDerivation();
testUsernameBase();

console.log('Firebase auth migration checks passed.');
