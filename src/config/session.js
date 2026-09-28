// Session lifetimes, cookie and JWT settings in one place, so the cookie, the
// JWT and the sessions row can never disagree about how long a login lasts.

const isProduction = process.env.NODE_ENV === 'production';

const SESSION_ABSOLUTE_MS = 5 * 24 * 60 * 60 * 1000;
const SESSION_IDLE_MS = 24 * 60 * 60 * 1000;
// last_seen_at is written at most this often per session.
const SESSION_TOUCH_INTERVAL_MS = 60 * 1000;
// How long a session trusts the last Firebase account check (disabled,
// deleted, password reset / "revoke all").
const FIREBASE_RECHECK_MS = 5 * 60 * 1000;
// While Firebase is unreachable, read-only requests are still served if the
// last successful check is at most this old. Writes fail closed.
const FIREBASE_OUTAGE_READ_GRACE_MS = 30 * 60 * 1000;

// __Host- cookies must be Secure, Path=/ and have no Domain, so the browser
// refuses to let any subdomain or plain-HTTP page set or overwrite them.
const SESSION_COOKIE_NAME = isProduction ? '__Host-session' : 'session';
// Cookie names used by older releases; cleared on login and logout.
const LEGACY_COOKIE_NAMES = ['token', '__session'];

const JWT_ALGORITHM = 'HS256';
const JWT_ISSUER = 'pincherize';
// A token minted for Preview must not work on Production (and vice versa),
// even if both deployments were ever given the same secret.
const JWT_AUDIENCE = `pincherize:${process.env.VERCEL_ENV || process.env.NODE_ENV || 'development'}`;

const PLACEHOLDER_SECRETS = new Set([
  'replace_with_a_long_random_secret',
  'changeme',
  'secret',
]);
const MIN_SECRET_BYTES = 32;

function jwtSecretProblem(secret) {
  if (!secret) return 'JWT_SECRET is required.';
  if (PLACEHOLDER_SECRETS.has(secret)) return 'JWT_SECRET is still the example placeholder.';
  if (Buffer.byteLength(secret, 'utf8') < MIN_SECRET_BYTES) {
    return `JWT_SECRET must be at least ${MIN_SECRET_BYTES} bytes.`;
  }
  return null;
}

// Called once when the app module loads. Production refuses to start with a
// missing, short or placeholder secret; development only warns.
function assertJwtSecretConfigured(env = process.env) {
  const problem = jwtSecretProblem(env.JWT_SECRET);
  if (!problem) return;
  if (env.NODE_ENV === 'production') throw new Error(problem);
  // eslint-disable-next-line no-console
  console.warn(`[security] ${problem} (allowed outside production only)`);
}

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Deliberately generic: this message may reach a log, never a client.
    throw Object.assign(new Error('Session signing key is not configured.'), { status: 500 });
  }
  return secret;
}

module.exports = {
  FIREBASE_OUTAGE_READ_GRACE_MS,
  FIREBASE_RECHECK_MS,
  JWT_ALGORITHM,
  JWT_AUDIENCE,
  JWT_ISSUER,
  LEGACY_COOKIE_NAMES,
  SESSION_ABSOLUTE_MS,
  SESSION_COOKIE_NAME,
  SESSION_IDLE_MS,
  SESSION_TOUCH_INTERVAL_MS,
  assertJwtSecretConfigured,
  jwtSecret,
  jwtSecretProblem,
};
