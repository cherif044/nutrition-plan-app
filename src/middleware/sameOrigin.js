const { SESSION_COOKIE_NAME, LEGACY_COOKIE_NAMES } = require('../config/session');

// CSRF defense for cookie-authenticated requests. A state-changing request
// (POST/PUT/PATCH/DELETE) is accepted only when:
//   - the browser does not label it cross-site (Sec-Fetch-Site), and
//   - its Origin (or Referer) is exactly one of this app's own origins, or
//   - it carries neither header and no session cookie (a non-browser client,
//     which cannot ride on anyone's cookies).
// The app only authenticates with the cookie, so there is no header-token
// path that would need an exemption.

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DEFAULT_APP_ORIGIN = 'https://pincherize.vercel.app';

function originOf(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function buildAllowedOrigins(env = process.env) {
  const origins = new Set();
  const add = (value) => {
    const origin = value && originOf(value);
    if (origin && origin !== 'null') origins.add(origin);
  };

  add(env.APP_ORIGIN || DEFAULT_APP_ORIGIN);
  String(env.ALLOWED_ORIGINS || '').split(',').map((v) => v.trim()).forEach(add);
  // Vercel sets these per deployment, so preview URLs work without config.
  for (const name of ['VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL']) {
    if (env[name]) add(`https://${env[name]}`);
  }
  if (env.NODE_ENV !== 'production') {
    const port = env.PORT || 3000;
    add(`http://localhost:${port}`);
    add(`http://127.0.0.1:${port}`);
  }
  return origins;
}

function hasSessionCookie(req) {
  const cookies = req.cookies || {};
  if (cookies[SESSION_COOKIE_NAME]) return true;
  if (LEGACY_COOKIE_NAMES.some((name) => cookies[name])) return true;
  // cookie-parser may not have run yet on this path.
  return /(?:^|;\s*)(?:__Host-session|session|token|__session)=/.test(req.get('cookie') || '');
}

function createSameOriginOnly(allowedOrigins = buildAllowedOrigins()) {
  return function sameOriginOnly(req, res, next) {
    if (!UNSAFE_METHODS.has(req.method)) return next();

    const reject = () => res.status(403).json({
      error: 'Cross-site request blocked.',
      requestId: req.id,
    });

    const fetchSite = req.get('sec-fetch-site');
    if (fetchSite === 'cross-site' || fetchSite === 'same-site') return reject();

    const source = req.get('origin') || req.get('referer');
    if (!source) return hasSessionCookie(req) ? reject() : next();

    const origin = originOf(source);
    return origin && allowedOrigins.has(origin) ? next() : reject();
  };
}

const sameOriginOnly = createSameOriginOnly();

module.exports = { buildAllowedOrigins, createSameOriginOnly, sameOriginOnly };
