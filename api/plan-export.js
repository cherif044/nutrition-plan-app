const express = require('express');
const cookieParser = require('cookie-parser');
const { requireAuth } = require('../src/middleware/auth');
const { errorHandler } = require('../src/middleware/errorHandler');
const { apiLimiter, pdfExportLimiter, trustProxyHops } = require('../src/middleware/rateLimits');
const { apiSecurityHeaders, privateApiCache, requestId } = require('../src/middleware/security');
const { validateQuery } = require('../src/middleware/validate');
const { assertJwtSecretConfigured } = require('../src/config/session');
const { pdfExportQuery } = require('../src/validation/schemas');
const { getPlanById } = require('../src/features/plans/repository');
const { generatePlanPdf, pdfFilename } = require('../src/features/plans/pdfService');
const { httpMetricsMiddleware } = require('../src/utils/metrics');

assertJwtSecretConfigured();

const app = express();

// vercel.json routes PDF exports straight to this function, bypassing
// src/app.js, so it applies the same request id, headers, cache policy and
// limits itself. Without trusting Vercel's proxy, req.ip would be the proxy
// and every anonymous client would share one rate-limit bucket.
app.disable('x-powered-by');
app.set('trust proxy', trustProxyHops());
app.use(requestId);
app.use(apiSecurityHeaders());
app.use(privateApiCache);
app.use(httpMetricsMiddleware);
app.use(cookieParser());
app.use((req, res, next) => (
  req.method === 'GET' || req.method === 'HEAD'
    ? next()
    : res.status(405).set('Allow', 'GET').json({ error: 'Method not allowed.', requestId: req.id })
));
app.use(apiLimiter, requireAuth, pdfExportLimiter);

app.use(validateQuery(pdfExportQuery), async (req, res, next) => {
  try {
    const query = req.validatedQuery;
    const planId = query.id || String(req.url || '').match(/\/plans\/(\d{1,18})\/export\.pdf/)?.[1];
    if (!planId) return res.status(400).json({ error: 'Plan id is required.' });

    const plan = await getPlanById(planId, req.user.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });

    const pdf = await generatePlanPdf(plan, { clientName: query.clientName });
    const filename = pdfFilename(plan);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdf.length);
    return res.send(pdf);
  } catch (err) {
    return next(err);
  }
});

app.use(errorHandler);

module.exports = app;
