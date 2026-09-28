const { randomUUID } = require('crypto');
const helmet = require('helmet');

// Security middleware shared by every entry point (src/app.js and the
// standalone Vercel functions in api/), so each response gets the same
// request id handling, headers and API cache policy.

const isProduction = process.env.NODE_ENV === 'production';
const FIREBASE_SDK_ORIGIN = 'https://www.gstatic.com/firebasejs/10.14.1/';
const FIREBASE_AUTH_FRAME = `https://${process.env.FIREBASE_WEB_AUTH_DOMAIN || 'nutrition-628a4.firebaseapp.com'}`;
const CSP_REPORT_PATH = '/api/csp-report';

function requestId(req, res, next) {
  // A client-supplied id is echoed in a header and written to logs, so only a
  // plain token is accepted.
  const incomingId = req.get('x-request-id');
  req.id = incomingId && /^[A-Za-z0-9-]{1,64}$/.test(incomingId) ? incomingId : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

const baseDirectives = {
  defaultSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
  imgSrc: ["'self'", 'data:', 'blob:'],
  connectSrc: [
    "'self'",
    'https://identitytoolkit.googleapis.com',
    'https://securetoken.googleapis.com',
    'https://www.googleapis.com',
    'https://firebaseinstallations.googleapis.com',
  ],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  scriptSrcAttr: ["'none'"],
  ...(isProduction ? { upgradeInsecureRequests: [] } : {}),
};

// The policy enforced until the strict one has run clean in report-only mode.
const legacyDirectives = {
  ...baseDirectives,
  // Firebase popup/redirect auth loads Google's iframe helper from this origin.
  scriptSrc: ["'self'", "'unsafe-inline'", 'https://www.gstatic.com', 'https://apis.google.com'],
  frameSrc: ["'self'", 'https://*.firebaseapp.com', 'https://accounts.google.com'],
};

// No inline script, the Firebase SDK pinned to its exact versioned path, and
// only this project's auth frame. apis.google.com stays because the Firebase
// SDK loads Google's gapi helper from it for popup and redirect sign-in.
const strictDirectives = {
  ...baseDirectives,
  scriptSrc: ["'self'", FIREBASE_SDK_ORIGIN, 'https://apis.google.com'],
  frameSrc: ["'self'", FIREBASE_AUTH_FRAME, 'https://accounts.google.com'],
  reportUri: [CSP_REPORT_PATH],
};

// upgrade-insecure-requests is ignored (and warned about) in report-only mode.
function withoutUpgrade(directives) {
  const { upgradeInsecureRequests: _ignored, ...rest } = directives;
  return rest;
}

function strictCspEnforced() {
  return process.env.CSP_STRICT_ENFORCE === 'true';
}

function pageSecurityHeaders() {
  const enforced = strictCspEnforced() ? strictDirectives : legacyDirectives;
  const enforce = helmet({
    crossOriginEmbedderPolicy: false,
    hsts: isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
    contentSecurityPolicy: { useDefaults: false, directives: enforced },
  });
  if (strictCspEnforced()) return enforce;

  const reportOnly = helmet.contentSecurityPolicy({
    useDefaults: false,
    reportOnly: true,
    directives: withoutUpgrade(strictDirectives),
  });
  return (req, res, next) => enforce(req, res, (err) => (err ? next(err) : reportOnly(req, res, next)));
}

// For endpoints that only ever return data or files (the PDF function): no
// content may load or run, and nothing may frame the response.
function apiSecurityHeaders() {
  return helmet({
    crossOriginEmbedderPolicy: false,
    hsts: isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] },
    },
  });
}

// API responses are per-user. They must never be stored by a shared cache or
// kept in the browser cache after logout. The two static catalog routes set
// their own public Cache-Control afterwards, which overrides this default.
function privateApiCache(_req, res, next) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.vary('Cookie');
  next();
}

module.exports = {
  CSP_REPORT_PATH,
  apiSecurityHeaders,
  pageSecurityHeaders,
  privateApiCache,
  requestId,
};
