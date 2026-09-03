const express = require('express');
const cookieParser = require('cookie-parser');
const { requireAuth } = require('../src/middleware/auth');
const { errorHandler } = require('../src/middleware/errorHandler');
const { getPlanById } = require('../src/repositories/planRepository');
const { generatePlanPdf, pdfFilename } = require('../src/services/planPdfService');

const app = express();

app.use(cookieParser());

app.use(requireAuth, async (req, res, next) => {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed.' });
    }

    const planId = req.query.id || String(req.url || '').match(/\/plans\/([^/]+)\/export\.pdf/)?.[1];
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
