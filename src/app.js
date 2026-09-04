const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { randomUUID } = require('crypto');

const generationRoutes = require('./routes/generationRoutes');
const authRoutes = require('./routes/authRoutes');
const folderRoutes = require('./routes/folderRoutes');
const planRoutes = require('./routes/planRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const customerRoutes = require('./routes/customerRoutes');
const sequelize = require('./config/database');
const { errorHandler } = require('./middleware/errorHandler');
const { logger } = require('./utils/logger');

const app = express();
const publicDir = path.join(__dirname, '..', 'public');
const foodIconsDir = path.join(__dirname, '..', 'icons');
const isProduction = process.env.NODE_ENV === 'production';

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function requestId(req, res, next) {
  const incomingId = req.get('x-request-id');
  req.id = incomingId && incomingId.length <= 128 ? incomingId : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

function shouldLogRequest(req, statusCode) {
  if (statusCode >= 400) return true;
  if (req.path.startsWith('/food-icons/')) return false;
  return !/\.(?:css|js|png|jpg|jpeg|gif|svg|ico|webp|woff2?)$/i.test(req.path);
}

function requestLogPath(req) {
  return String(req.originalUrl || req.url || req.path || '').split('?')[0];
}

function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();
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
    });
  });
  next();
}

function rateLimitHandler(req, res, _next, options) {
  logger.warn('Rate limit exceeded', {
    requestId: req.id,
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

function createLimiter({ windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: message },
    handler: rateLimitHandler,
  });
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

const apiLimiter = createLimiter({
  windowMs: envNumber('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  limit: envNumber('RATE_LIMIT_MAX', 600),
  message: 'Too many API requests. Please try again later.',
});
const authLimiter = createLimiter({
  windowMs: envNumber('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  limit: envNumber('AUTH_RATE_LIMIT_MAX', 60),
  message: 'Too many authentication requests. Please try again later.',
});
const generationLimiter = createLimiter({
  windowMs: envNumber('GENERATION_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  limit: envNumber('GENERATION_RATE_LIMIT_MAX', 60),
  message: 'Too many plan generation requests. Please try again later.',
});
const pdfExportLimiter = createLimiter({
  windowMs: envNumber('PDF_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  limit: envNumber('PDF_RATE_LIMIT_MAX', 30),
  message: 'Too many PDF export requests. Please try again later.',
});

app.disable('x-powered-by');
app.set('trust proxy', envNumber('TRUST_PROXY_HOPS', 1));
app.use(requestId);
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
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://www.gstatic.com'],
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
app.use(compression({
  threshold: envNumber('COMPRESSION_THRESHOLD_BYTES', 1024),
}));

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.locals.isShuttingDown = false;

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
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/plans/:id/export.pdf', pdfExportLimiter);
app.use('/api/plans', planRoutes);
app.use('/api/generate-plan', generationLimiter);
app.use('/api/rebalance-meal', generationLimiter);
app.use('/api/produce-swap-options', generationLimiter);
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
