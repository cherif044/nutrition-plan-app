const { rateLimit } = require('express-rate-limit');
const { logger } = require('../utils/logger');
const { recordRateLimit } = require('../utils/metrics');
const { PostgresRateLimitStore } = require('../utils/postgresRateLimitStore');

// Shared by app.js and the standalone Vercel functions in api/, so every
// entry point enforces the same limits against the same counters.

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function requestLogPath(req) {
  return String(req.originalUrl || req.url || req.path || '').split('?')[0];
}

function rateLimitHandler(scope, req, res, _next, options) {
  recordRateLimit(scope);
  logger.warn('Rate limit exceeded', {
    requestId: req.id,
    scope,
    method: req.method,
    path: requestLogPath(req),
    ip: req.ip,
  });
  const body = typeof options.message === 'object'
    ? options.message
    : { error: options.message };
  res.status(options.statusCode).json({
    ...body,
    requestId: req.id,
  });
}

function createLimiter({ scope, windowMs, limit, message }) {
  // RATE_LIMIT_STORE=memory keeps tests and offline development independent
  // of the rate_limits table.
  const store = process.env.RATE_LIMIT_STORE === 'memory'
    ? undefined
    : new PostgresRateLimitStore({ prefix: scope });
  return rateLimit({
    windowMs,
    limit,
    store,
    // A database hiccup must never lock users out; fail open and log.
    passOnStoreError: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: message },
    handler: (req, res, next, options) => rateLimitHandler(scope, req, res, next, options),
  });
}

const apiLimiter = createLimiter({
  scope: 'api',
  windowMs: envNumber('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  limit: envNumber('RATE_LIMIT_MAX', 600),
  message: 'Too many API requests. Please try again later.',
});
const authLimiter = createLimiter({
  scope: 'auth',
  windowMs: envNumber('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  limit: envNumber('AUTH_RATE_LIMIT_MAX', 60),
  message: 'Too many authentication requests. Please try again later.',
});
const generationLimiter = createLimiter({
  scope: 'generation',
  windowMs: envNumber('GENERATION_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  limit: envNumber('GENERATION_RATE_LIMIT_MAX', 60),
  message: 'Too many plan generation requests. Please try again later.',
});
const pdfExportLimiter = createLimiter({
  scope: 'pdf',
  windowMs: envNumber('PDF_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  limit: envNumber('PDF_RATE_LIMIT_MAX', 30),
  message: 'Too many PDF export requests. Please try again later.',
});

function trustProxyHops() {
  return envNumber('TRUST_PROXY_HOPS', 1);
}

module.exports = {
  apiLimiter,
  authLimiter,
  generationLimiter,
  pdfExportLimiter,
  trustProxyHops,
};
