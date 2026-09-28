const { test, expect } = require('@playwright/test');
const Module = require('module');
const jwt = require('jsonwebtoken');

// Session security (remediation P1.1, N01, N17, N24). The repositories and
// Firebase Admin are replaced with in-memory fakes so the real middleware can
// be exercised over HTTP without a database.

process.env.JWT_SECRET = 'test-secret-that-is-definitely-longer-than-32-bytes';

const userRepositoryPath = require.resolve('../src/repositories/userRepository');
const sessionRepositoryPath = require.resolve('../src/repositories/sessionRepository');
const firebaseAdminPath = require.resolve('../src/config/firebaseAdmin');
const authPath = require.resolve('../src/middleware/auth');

const db = { users: new Map(), sessions: new Map() };
const firebase = { record: null, fail: false, calls: 0 };

function loadAuthWithFakes() {
  const originalLoad = Module._load;
  delete require.cache[authPath];
  Module._load = function fakeLoad(request, parent, isMain) {
    const resolved = Module._resolveFilename(request, parent, isMain);
    if (resolved === userRepositoryPath) {
      return { findUserById: async (id) => db.users.get(String(id)) || null };
    }
    if (resolved === sessionRepositoryPath) {
      return {
        findSessionById: async (id) => db.sessions.get(String(id)) || null,
        markFirebaseChecked: async (id, now) => { db.sessions.get(id).firebase_checked_at = now; },
        revokeSession: async (id) => { const s = db.sessions.get(id); if (s) s.revoked_at = new Date(); return true; },
        touchSession: (id, now) => { db.sessions.get(id).last_seen_at = now; },
      };
    }
    if (resolved === firebaseAdminPath) {
      return {
        getFirebaseAdmin: () => ({
          auth: () => ({
            getUser: async () => {
              firebase.calls += 1;
              if (firebase.fail) throw Object.assign(new Error('unavailable'), { code: 'app/network-error' });
              return firebase.record;
            },
          }),
        }),
      };
    }
    return originalLoad.apply(this, arguments);
  };
  try {
    return require('../src/middleware/auth');
  } finally {
    Module._load = originalLoad;
  }
}

const auth = loadAuthWithFakes();
const session = require('../src/config/session');

let server;
let baseUrl;
let nextSessionId = 1;

function addUser(id, extra = {}) {
  const user = { id: String(id), firebase_uid: `uid-${id}`, token_version: 0, firstname: 'T', ...extra };
  db.users.set(String(id), user);
  return user;
}

function addSession(user, extra = {}) {
  const now = new Date();
  const id = `00000000-0000-4000-8000-${String(nextSessionId++).padStart(12, '0')}`;
  const row = {
    id,
    user_id: user.id,
    created_at: now,
    last_seen_at: now,
    firebase_checked_at: now,
    expires_at: new Date(now.getTime() + session.SESSION_ABSOLUTE_MS),
    revoked_at: null,
    ...extra,
  };
  db.sessions.set(id, row);
  return { row, token: auth.signSessionToken(user, row) };
}

async function call(token, { method = 'GET', headers = {} } = {}) {
  const cookie = token ? { cookie: `${session.SESSION_COOKIE_NAME}=${token}` } : {};
  const res = await fetch(`${baseUrl}/me`, { method, headers: { ...cookie, ...headers } });
  return res.status;
}

test.beforeAll(async () => {
  const express = require('express');
  const cookieParser = require('cookie-parser');
  const app = express();
  app.use(cookieParser());
  app.all('/me', auth.requireAuth, (req, res) => res.json({ id: req.user.id }));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(() => new Promise((resolve) => server.close(resolve)));

test.beforeEach(() => {
  firebase.record = { disabled: false, tokensValidAfterTime: new Date(Date.now() - 60 * 60 * 1000).toUTCString() };
  firebase.fail = false;
  firebase.calls = 0;
});

test('a valid session cookie is accepted', async () => {
  const user = addUser(1);
  const { token } = addSession(user);
  expect(await call(token)).toBe(200);
});

test('a copied token stops working once its session is logged out', async () => {
  const user = addUser(2);
  const { row, token } = addSession(user);
  expect(await call(token)).toBe(200);
  row.revoked_at = new Date();
  expect(await call(token)).toBe(401);
});

test('logging out session A leaves session B valid', async () => {
  const user = addUser(3);
  const a = addSession(user);
  const b = addSession(user);
  a.row.revoked_at = new Date();
  expect(await call(a.token)).toBe(401);
  expect(await call(b.token)).toBe(200);
});

test('sign out everywhere (token version bump) ends every session', async () => {
  const user = addUser(4);
  const a = addSession(user);
  const b = addSession(user);
  user.token_version = 1;
  expect(await call(a.token)).toBe(401);
  expect(await call(b.token)).toBe(401);
});

test('tokens with alg none, a wrong audience, issuer or secret are rejected', async () => {
  const user = addUser(5);
  const { row } = addSession(user);
  const claims = { sid: row.id, tokenVersion: 0 };
  const opts = { subject: user.id, issuer: session.JWT_ISSUER, audience: session.JWT_AUDIENCE, expiresIn: 60 };
  const none = jwt.sign(claims, null, { ...opts, algorithm: 'none' });
  const wrongAud = jwt.sign(claims, process.env.JWT_SECRET, { ...opts, audience: 'pincherize:preview' });
  const wrongIss = jwt.sign(claims, process.env.JWT_SECRET, { ...opts, issuer: 'someone-else' });
  const wrongKey = jwt.sign(claims, 'x'.repeat(40), opts);
  const hs512 = jwt.sign(claims, process.env.JWT_SECRET, { ...opts, algorithm: 'HS512' });
  for (const token of [none, wrongAud, wrongIss, wrongKey, hs512]) {
    expect(await call(token)).toBe(401);
  }
});

test('a bearer token is not an accepted credential', async () => {
  const user = addUser(6);
  const { token } = addSession(user);
  expect(await call(null, { headers: { authorization: `Bearer ${token}` } })).toBe(401);
});

test('a session token for a different user than its row is rejected', async () => {
  const owner = addUser(7);
  const other = addUser(8);
  const { row } = addSession(owner);
  expect(await call(auth.signSessionToken(other, row))).toBe(401);
});

test('idle and expired sessions are rejected', async () => {
  const user = addUser(9);
  const idle = addSession(user, { last_seen_at: new Date(Date.now() - session.SESSION_IDLE_MS - 1000) });
  expect(await call(idle.token)).toBe(401);
  const expired = addSession(user, { expires_at: new Date(Date.now() - 1000) });
  // The JWT itself is still in date; the row's absolute expiry wins.
  expect(await call(auth.signSessionToken(user, { ...expired.row, expires_at: new Date(Date.now() + 60000) }))).toBe(401);
});

test('a password reset in Firebase ends older sessions at the next check', async () => {
  const user = addUser(10);
  const stale = new Date(Date.now() - session.FIREBASE_RECHECK_MS - 1000);
  const { row, token } = addSession(user, { created_at: new Date(Date.now() - 10 * 60 * 1000), firebase_checked_at: stale });
  firebase.record = { disabled: false, tokensValidAfterTime: new Date().toUTCString() };
  expect(await call(token)).toBe(401);
  expect(row.revoked_at).toBeTruthy();
});

test('a disabled Firebase account ends the session', async () => {
  const user = addUser(11);
  const stale = new Date(Date.now() - session.FIREBASE_RECHECK_MS - 1000);
  const { token } = addSession(user, { firebase_checked_at: stale });
  firebase.record = { disabled: true, tokensValidAfterTime: null };
  expect(await call(token)).toBe(401);
});

test('Firebase is only consulted when the last check is stale', async () => {
  const user = addUser(12);
  const { token } = addSession(user);
  expect(await call(token)).toBe(200);
  expect(firebase.calls).toBe(0);
});

test('during a Firebase outage reads are served within the grace window, writes fail closed', async () => {
  const user = addUser(13);
  const stale = new Date(Date.now() - session.FIREBASE_RECHECK_MS - 1000);
  const { token } = addSession(user, { firebase_checked_at: stale });
  firebase.fail = true;
  expect(await call(token)).toBe(200);
  expect(await call(token, { method: 'POST' })).toBe(503);
});

test('an account being deleted cannot use its sessions', async () => {
  const user = addUser(14, { deletion_pending_at: new Date() });
  const { token } = addSession(user);
  expect(await call(token)).toBe(401);
});

test.describe('sign-in providers (N24)', () => {
  const { assertFirebaseTokenCanAccessApp } = require('../src/services/firebaseAuthService');
  const token = (provider, verified = true) => ({
    uid: 'u', email: 'a@example.com', email_verified: verified, firebase: { sign_in_provider: provider },
  });

  test('password and Google with a verified email are allowed', () => {
    expect(() => assertFirebaseTokenCanAccessApp(token('password'))).not.toThrow();
    expect(() => assertFirebaseTokenCanAccessApp(token('google.com'))).not.toThrow();
  });

  test('other providers are rejected with 403', () => {
    for (const provider of ['github.com', 'microsoft.com', 'anonymous', 'custom']) {
      expect(() => assertFirebaseTokenCanAccessApp(token(provider))).toThrow(expect.objectContaining({ status: 403 }));
    }
  });

  test('an unverified email is rejected for every provider', () => {
    expect(() => assertFirebaseTokenCanAccessApp(token('google.com', false))).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => assertFirebaseTokenCanAccessApp(token('password', false))).toThrow(expect.objectContaining({ status: 403 }));
  });
});

test.describe('JWT secret check', () => {
  test('production refuses a missing, short or placeholder secret', () => {
    for (const secret of [undefined, 'short', 'replace_with_a_long_random_secret']) {
      expect(() => session.assertJwtSecretConfigured({ NODE_ENV: 'production', JWT_SECRET: secret })).toThrow();
    }
    expect(() => session.assertJwtSecretConfigured({ NODE_ENV: 'production', JWT_SECRET: 'k'.repeat(48) })).not.toThrow();
  });
});
