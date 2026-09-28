const express = require('express');
const cookieParser = require('cookie-parser');
const { randomUUID } = require('crypto');
const { requireAuth } = require('../src/middleware/auth');
const { errorHandler } = require('../src/middleware/errorHandler');
const { apiLimiter, pdfExportLimiter, trustProxyHops } = require('../src/middleware/rateLimits');
const { validateQuery } = require('../src/middleware/validate');
const { pdfExportQuery } = require('../src/validation/schemas');
const { getPlanById } = require('../src/repositories/planRepository');
const { generatePlanPdf, pdfFilename } = require('../src/services/planPdfService');
const { httpMetricsMiddleware } = require('../src/utils/metrics');

const app = express();

// vercel.json routes PDF exports straight to this function, bypassing
// src/app.js, so it must apply the same limits itself. Without trusting
// Vercel's proxy, req.ip would be the proxy and every user would share one
// rate-limit bucket.
app.disable('x-powered-by');
app.set('trust proxy', trustProxyHops());
app.use((req, res, next) => {
  req.id = randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
});
app.use(httpMetricsMiddleware);
app.use(apiLimiter, pdfExportLimiter);
app.use(cookieParser());

app.use(requireAuth, validateQuery(pdfExportQuery), async (req, res, next) => {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed.' });
    }

    const planId = req.query.id || String(req.url || '').match(/\/plans\/(\d{1,18})\/export\.pdf/)?.[1];
    if (!planId) return res.status(400).json({ error: 'Plan id is required.' });

    const plan = await getPlanById(planId, req.user.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });

    const pdf = await generatePlanPdf(plan, { clientName: req.query.clientName });
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
