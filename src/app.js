const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const helmet = require('helmet');
const { timingSafeEqual } = require('crypto');

const generationRoutes = require('./features/planner/routes');
const authRoutes = require('./features/auth/routes');
const planRoutes = require('./features/plans/routes');
const dashboardRoutes = require('./features/dashboard/routes');
const customerRoutes = require('./features/customers/routes');
const sequelize = require('./config/database');
const { errorHandler } = require('./middleware/errorHandler');
const { requireAuth } = require('./middleware/auth');
const {
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
} = require('./middleware/rateLimits');
const { sameOriginOnly } = require('./middleware/sameOrigin');
const {
  CSP_REPORT_PATH,
  pageSecurityHeaders,
  privateApiCache,
  requestId,
} = require('./middleware/security');
const { assertJwtSecretConfigured } = require('./config/session');
const { INPUT_LIMITS } = require('./config/inputLimits');
const { logger } = require('./utils/logger');
const { hashIp } = require('./utils/ipHash');
const { finishPendingDeletions } = require('./services/accountDeletionService');
const {
  httpMetricsMiddleware,
  metricsHandler,
  recordWebVitals,
} = require('./utils/metrics');

// Refuse to start in production with a missing, short or placeholder secret.
assertJwtSecretConfigured();

const app = express();
const publicDir = path.join(__dirname, '..', 'public');
const foodIconsDir = path.join(__dirname, '..', 'public', 'food-icons');
const isProduction = process.env.NODE_ENV === 'production';
let nextRequestIsColdStart = true;

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function shouldLogRequest(req, statusCode) {
  if (statusCode >= 400) return true;
  if (req.path === '/metrics' || req.path === '/api/vitals') return false;
  if (req.path.startsWith('/food-icons/')) return false;
  return !/\.(?:css|js|png|jpg|jpeg|gif|svg|ico|webp|woff2?)$/i.test(req.path);
}

function requestLogPath(req) {
  return String(req.originalUrl || req.url || req.path || '').split('?')[0];
}

function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();
  req.metrics = req.metrics || {};
  req.metrics.coldStart = nextRequestIsColdStart;
  nextRequestIsColdStart = false;
  res.on('finish', () => {
    if (!shouldLogRequest(req, res.statusCode)) return;
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logger.info('HTTP request completed', {
      requestId: req.id,
      method: req.method,
      path: requestLogPath(req),
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(1)),
      // A keyed, daily-rotating hash: groups one client's requests without
      // storing the address itself.
      ipHash: hashIp(req.ip),
      metrics: req.metrics,
    });
  });
  next();
}

function isHashedAsset(filePath) {
  return /(?:^|[.-])[a-f0-9]{8,}\.(?:css|js|png|jpg|jpeg|gif|svg|webp|woff2?)$/i
    .test(path.basename(filePath));
}

function setStaticCacheHeaders(res, filePath) {
  if (isHashedAsset(filePath)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return;
  }

  if (/\.html?$/i.test(filePath)) {
    res.setHeader('Cache-Control', 'no-cache');
    return;
  }

  // Unhashed CSS/JS: serve from cache immediately and revalidate in the
  // background, so a page load never blocks on a 304. Mirrors the
  // Cache-Control set for these paths in vercel.json.
  if (/\.(?:css|js)$/i.test(filePath)) {
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
    return;
  }

  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
}

function setFoodIconCacheHeaders(res, filePath) {
  if (isHashedAsset(filePath)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return;
  }

  res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
}

function sendPage(res, fileName) {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(publicDir, fileName));
}

app.disable('x-powered-by');
app.set('trust proxy', trustProxyHops());
app.use(requestId);
app.use(httpMetricsMiddleware);
app.use(requestLogger);
app.use(pageSecurityHeaders());

// OAuth popups must retain their connection to the page that opened them.
// Keep Helmet's stricter default on all other pages.
app.use(['/login', '/register', '/account', '/login.html', '/register.html', '/account.html'],
  helmet.crossOriginOpenerPolicy({ policy: 'same-origin-allow-popups' }));
app.use(compression({
  threshold: envNumber('COMPRESSION_THRESHOLD_BYTES', 1024),
}));

// Only saving a plan carries a large document; every other endpoint needs a
// few kilobytes, so the parser refuses anything bigger before it is read.
const PLAN_SAVE_PATH = /^\/api\/plans(?:\/\d+)?\/?$/;
const planBodyParser = express.json({ limit: INPUT_LIMITS.planBodyBytes });
const defaultBodyParser = express.json({ limit: INPUT_LIMITS.defaultBodyBytes });
app.use((req, res, next) => (
  PLAN_SAVE_PATH.test(req.path) ? planBodyParser : defaultBodyParser
)(req, res, next));
app.use(cookieParser());

app.locals.isShuttingDown = false;

app.get('/metrics', probeLimiter, metricsHandler);

app.get('/livez', probeLimiter, (_req, res) => {
  res.status(200).json({
    status: 'live',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Readiness is cached briefly so a flood of probes cannot turn into a flood
// of database round trips.
const READINESS_CACHE_MS = 10 * 1000;
let readinessCache = { checkedAt: 0, ok: false, error: null };

async function databaseReady() {
  if (Date.now() - readinessCache.checkedAt < READINESS_CACHE_MS) return readinessCache;
  try {
    await sequelize.authenticate();
    readinessCache = { checkedAt: Date.now(), ok: true, error: null };
  } catch (error) {
    readinessCache = { checkedAt: Date.now(), ok: false, error };
  }
  return readinessCache;
}

app.get('/readyz', probeLimiter, async (_req, res) => {
  if (app.locals.isShuttingDown) {
    return res.status(503).json({
      status: 'not_ready',
      reason: 'shutdown_in_progress',
      timestamp: new Date().toISOString(),
    });
  }

  const readiness = await databaseReady();
  if (readiness.ok) {
    return res.status(200).json({
      status: 'ready',
      database: 'connected',
      timestamp: new Date().toISOString(),
    });
  }
  return res.status(503).json({
    status: 'not_ready',
    database: 'unavailable',
    error: isProduction ? undefined : readiness.error?.message,
    timestamp: new Date().toISOString(),
  });
});

// Browsers send CSP violation reports without an Origin the app can check,
// so this route sits before the CSRF check. Only a few fields are logged.
const cspReportParser = express.json({
  type: ['application/csp-report', 'application/reports+json', 'application/json'],
  limit: '16kb',
});
app.post(CSP_REPORT_PATH, cspReportLimiter, cspReportParser, (req, res) => {
  const report = req.body?.['csp-report'] || (Array.isArray(req.body) ? req.body[0]?.body : null) || {};
  logger.warn('CSP violation', {
    directive: String(report['effective-directive'] || report.effectiveDirective || report['violated-directive'] || '').slice(0, 80),
    blocked: String(report['blocked-uri'] || report.blockedURL || '').slice(0, 200),
    page: String(report['document-uri'] || report.documentURL || '').split('?')[0].slice(0, 200),
  });
  res.status(204).end();
});

app.use('/api', privateApiCache);
app.use('/api', sameOriginOnly);
app.use('/api', apiLimiter);
app.post('/api/vitals', vitalsLimiter, (req, res) => {
  recordWebVitals(req.body);
  res.status(204).end();
});

// Finishes account deletions that stopped part-way. Called by Vercel Cron,
// which sends "Authorization: Bearer $CRON_SECRET".
app.get('/api/internal/finish-deletions', async (req, res, next) => {
  const secret = process.env.CRON_SECRET;
  const presented = String(req.get('authorization') || '');
  const expected = `Bearer ${secret}`;
  const matches = secret && presented.length === expected.length
    && timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
  if (!matches) return res.status(404).json({ error: 'Not found.' });
  try {
    return res.json(await finishPendingDeletions());
  } catch (err) {
    return next(err);
  }
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/customers', customerRoutes);

// Expensive and state-changing routes authenticate first, so their limits
// are counted per account (see rateLimits.js), then fail closed.
const PLAN_WRITE_METHODS = new Set(['POST', 'PUT']);
app.use((req, res, next) => (
  PLAN_WRITE_METHODS.has(req.method) && PLAN_SAVE_PATH.test(req.path)
    ? requireAuth(req, res, (err) => (err ? next(err) : planWriteLimiter(req, res, next)))
    : next()
));
app.use('/api/plans/:id/export.pdf', requireAuth, pdfExportLimiter);
app.use('/api/plans', planRoutes);
app.use('/api/generate-plan', requireAuth, generationLimiter);
app.use('/api/rebalance-meal', requireAuth, generationLimiter);
app.use('/api/swap-suggestions', requireAuth, plannerLimiter);
app.use('/api', generationRoutes);

app.use('/food-icons', express.static(foodIconsDir, {
  etag: true,
  lastModified: true,
  setHeaders: setFoodIconCacheHeaders,
}));
app.use(express.static(publicDir, {
  etag: true,
  lastModified: true,
  maxAge: 0,
  setHeaders: setStaticCacheHeaders,
}));
app.get('/js/zxcvbn.browser.js', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  res.sendFile(path.join(__dirname, '..', 'node_modules', 'zxcvbn', 'dist', 'zxcvbn.js'));
});

// Page routes
app.get('/', (_req, res) => sendPage(res, 'index.html'));
app.get('/login', (_req, res) => sendPage(res, 'login.html'));
app.get('/register', (_req, res) => sendPage(res, 'register.html'));
app.get('/dashboard', (_req, res) => sendPage(res, 'dashboard.html'));
app.get('/planner', (_req, res) => sendPage(res, 'planner.html'));
app.get('/account', (_req, res) => sendPage(res, 'account.html'));

app.use(errorHandler);

module.exports = app;
