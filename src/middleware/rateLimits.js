const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { logger } = require('../utils/logger');
const { hashIp } = require('../utils/ipHash');
const { recordRateLimit, recordRateLimitStoreError } = require('../utils/metrics');
const { PostgresRateLimitStore } = require('../utils/postgresRateLimitStore');
const { UpstashRateLimitStore } = require('../utils/upstashRateLimitStore');
const { isUpstashRedisConfigured } = require('../utils/upstashRedis');

// Shared by app.js and the standalone Vercel functions in api/, so every
// entry point enforces the same limits against the same counters.

function envNumber(name, fallback, { allowZero = false } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  const ok = Number.isFinite(value) && (allowZero ? value >= 0 : value > 0);
  return ok ? value : fallback;
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
    ipHash: hashIp(req.ip),
    userId: req.user?.id,
  });
  const body = typeof options.message === 'object'
    ? options.message
    : { error: options.message };
  res.status(options.statusCode).json({
    ...body,
    requestId: req.id,
  });
}

// Signed-in requests are counted per account, so one user cannot spread load
// over many IPs and many users behind one NAT do not share a bucket.
// Anonymous requests fall back to the (IPv6-subnet aware) client IP.
function accountOrIpKey(req) {
  return req.user?.id ? `u:${req.user.id}` : ipKeyGenerator(req.ip);
}

// Wraps the store so a failure is always logged and counted, whether the
// limiter then fails open or closed.
function observedStore(store, scope) {
  if (!store) return store;
  const increment = store.increment.bind(store);
  store.increment = async (key) => {
    try {
      return await increment(key);
    } catch (error) {
      recordRateLimitStoreError(scope);
      logger.warn('Rate limit store error', { scope, error: { name: error?.name, code: error?.code } });
      // Only reaches the client for fail-closed scopes.
      throw Object.assign(new Error('The service is busy. Please try again shortly.'), {
        status: 503,
        expose: true,
      });
    }
  };
  return store;
}

function createLimiter({
  scope, windowMs, limit, message, failOpen = true, perAccount = false,
}) {
  // RATE_LIMIT_STORE=memory keeps tests and offline development independent
  // of external stores. RATE_LIMIT_STORE=postgres can force the legacy table
  // during rollback; otherwise Redis is preferred when configured.
  const storeMode = String(process.env.RATE_LIMIT_STORE || '').toLowerCase();
  let rawStore;
  if (storeMode === 'memory') {
    rawStore = undefined;
  } else if (storeMode === 'postgres' || !isUpstashRedisConfigured()) {
    rawStore = new PostgresRateLimitStore({ prefix: scope });
  } else {
    rawStore = new UpstashRateLimitStore({ prefix: scope });
  }
  const store = observedStore(rawStore, scope);
  return rateLimit({
    windowMs,
    limit,
    store,
    // Cheap reads fail open so a database hiccup never locks users out.
    // Expensive or state-changing scopes fail closed (the error handler
    // answers 500) so an outage of the limiter is not an outage of the limit.
    passOnStoreError: failOpen,
    keyGenerator: perAccount ? accountOrIpKey : undefined,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: message },
    handler: (req, res, next, options) => rateLimitHandler(scope, req, res, next, options),
  });
}

const WINDOW_15_MIN = 15 * 60 * 1000;

const apiLimiter = createLimiter({
  scope: 'api',
  windowMs: envNumber('RATE_LIMIT_WINDOW_MS', WINDOW_15_MIN),
  limit: envNumber('RATE_LIMIT_MAX', 600),
  message: 'Too many API requests. Please try again later.',
});
const authLimiter = createLimiter({
  scope: 'auth',
  windowMs: envNumber('AUTH_RATE_LIMIT_WINDOW_MS', WINDOW_15_MIN),
  limit: envNumber('AUTH_RATE_LIMIT_MAX', 60),
  message: 'Too many authentication requests. Please try again later.',
});
const generationLimiter = createLimiter({
  scope: 'generation',
  windowMs: envNumber('GENERATION_RATE_LIMIT_WINDOW_MS', WINDOW_15_MIN),
  limit: envNumber('GENERATION_RATE_LIMIT_MAX', 60),
  message: 'Too many plan generation requests. Please try again later.',
  failOpen: false,
  perAccount: true,
});
// Swap suggestions are clicked far more often than a plan is generated, but
// each one still runs a portion search, so they get their own budget.
const plannerLimiter = createLimiter({
  scope: 'planner',
  windowMs: envNumber('PLANNER_RATE_LIMIT_WINDOW_MS', WINDOW_15_MIN),
  limit: envNumber('PLANNER_RATE_LIMIT_MAX', 300),
  message: 'Too many planner requests. Please try again later.',
  failOpen: false,
  perAccount: true,
});
const planWriteLimiter = createLimiter({
  scope: 'plan_write',
  windowMs: envNumber('PLAN_WRITE_RATE_LIMIT_WINDOW_MS', WINDOW_15_MIN),
  limit: envNumber('PLAN_WRITE_RATE_LIMIT_MAX', 300),
  message: 'Too many plan saves. Please try again later.',
  failOpen: false,
  perAccount: true,
});
const pdfExportLimiter = createLimiter({
  scope: 'pdf',
  windowMs: envNumber('PDF_RATE_LIMIT_WINDOW_MS', WINDOW_15_MIN),
  limit: envNumber('PDF_RATE_LIMIT_MAX', 30),
  message: 'Too many PDF export requests. Please try again later.',
  failOpen: false,
  perAccount: true,
});
// Anonymous browser telemetry (web vitals, CSP reports).
const vitalsLimiter = createLimiter({
  scope: 'vitals',
  windowMs: WINDOW_15_MIN,
  limit: envNumber('VITALS_RATE_LIMIT_MAX', 120),
  message: 'Too many telemetry requests.',
});
const cspReportLimiter = createLimiter({
  scope: 'csp',
  windowMs: WINDOW_15_MIN,
  limit: 60,
  message: 'Too many reports.',
});
// /readyz, /livez and /metrics sit outside /api.
const probeLimiter = createLimiter({
  scope: 'probe',
  windowMs: 60 * 1000,
  limit: envNumber('PROBE_RATE_LIMIT_MAX', 60),
  message: 'Too many requests.',
});

// Number of proxies in front of the app whose X-Forwarded-For is trusted.
// Vercel adds exactly one. Elsewhere (pm2, Northflank, local) the default is
// 0, so a client cannot choose its own rate-limit bucket by sending a fake
// X-Forwarded-For; set TRUST_PROXY_HOPS explicitly for a known proxy chain.
function trustProxyHops() {
  return envNumber('TRUST_PROXY_HOPS', process.env.VERCEL ? 1 : 0, { allowZero: true });
}

module.exports = {
  apiLimiter,
  authLimiter,
  cspReportLimiter,
  generationLimiter,
  pdfExportLimiter,
  planWriteLimiter,
  plannerLimiter,
  probeLimiter,
  trustProxyHops,
  vitalsLimiter,
};
