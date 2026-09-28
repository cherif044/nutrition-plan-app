const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const helmet = require('helmet');
const { randomUUID } = require('crypto');

const generationRoutes = require('./routes/generationRoutes');
const authRoutes = require('./routes/authRoutes');
const folderRoutes = require('./routes/folderRoutes');
const planRoutes = require('./routes/planRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const customerRoutes = require('./routes/customerRoutes');
const sequelize = require('./config/database');
const { errorHandler } = require('./middleware/errorHandler');
const {
  apiLimiter,
  authLimiter,
  generationLimiter,
  pdfExportLimiter,
  trustProxyHops,
} = require('./middleware/rateLimits');
const { sameOriginOnly } = require('./middleware/sameOrigin');
const { INPUT_LIMITS } = require('./config/inputLimits');
const { logger } = require('./utils/logger');
const {
  httpMetricsMiddleware,
  metricsHandler,
  recordWebVitals,
} = require('./utils/metrics');

const app = express();
const publicDir = path.join(__dirname, '..', 'public');
const foodIconsDir = path.join(__dirname, '..', 'public', 'food-icons');
const isProduction = process.env.NODE_ENV === 'production';
let nextRequestIsColdStart = true;

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function requestId(req, res, next) {
  // A client-supplied id is echoed in a header and written to logs, so only a
  // plain token is accepted.
  const incomingId = req.get('x-request-id');
  req.id = incomingId && /^[A-Za-z0-9-]{1,64}$/.test(incomingId) ? incomingId : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
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
      ip: req.ip,
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
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  hsts: isProduction
    ? { maxAge: 15552000, includeSubDomains: true }
    : false,
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      // Firebase popup/redirect auth loads Google's iframe helper from this origin.
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://www.gstatic.com', 'https://apis.google.com'],
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
      frameSrc: ["'self'", 'https://*.firebaseapp.com', 'https://accounts.google.com'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: isProduction ? [] : null,
    },
  },
}));
// OAuth popups must retain their connection to the page that opened them.
// Keep Helmet's stricter default on all other pages.
app.use(['/login', '/register', '/login.html', '/register.html'],
  helmet.crossOriginOpenerPolicy({ policy: 'same-origin-allow-popups' }));
app.use(compression({
  threshold: envNumber('COMPRESSION_THRESHOLD_BYTES', 1024),
}));

// Only saving a plan carries a large document; every other endpoint needs a
// few kilobytes, so the parser refuses anything bigger before it is read.
const PLAN_SAVE_PATH = /^\/api\/(?:plans(?:\/\d+)?|folders\/\d+\/plans)\/?$/;
const planBodyParser = express.json({ limit: INPUT_LIMITS.planBodyBytes });
const defaultBodyParser = express.json({ limit: INPUT_LIMITS.defaultBodyBytes });
app.use((req, res, next) => (
  PLAN_SAVE_PATH.test(req.path) ? planBodyParser : defaultBodyParser
)(req, res, next));
app.use(cookieParser());

app.locals.isShuttingDown = false;

app.get('/metrics', metricsHandler);

app.get('/livez', (_req, res) => {
  res.status(200).json({
    status: 'live',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get('/readyz', async (_req, res) => {
  if (app.locals.isShuttingDown) {
    return res.status(503).json({
      status: 'not_ready',
      reason: 'shutdown_in_progress',
      timestamp: new Date().toISOString(),
    });
  }

  try {
    await sequelize.authenticate();
    return res.status(200).json({
      status: 'ready',
      database: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(503).json({
      status: 'not_ready',
      database: 'unavailable',
      error: isProduction ? undefined : error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

app.use('/api', sameOriginOnly);
app.use('/api', apiLimiter);
app.post('/api/vitals', (req, res) => {
  recordWebVitals(req.body);
  res.status(204).end();
});
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/plans/:id/export.pdf', pdfExportLimiter);
app.use('/api/plans', planRoutes);
app.use('/api/generate-plan', generationLimiter);
app.use('/api/rebalance-meal', generationLimiter);
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
app.get('/customers/:id', (_req, res) => sendPage(res, 'customer.html'));
app.get('/planner', (_req, res) => sendPage(res, 'planner.html'));
app.get('/explorer', (_req, res) => sendPage(res, 'explorer.html'));

app.use(errorHandler);

module.exports = app;
