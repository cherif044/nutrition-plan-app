const {
  createPlan, getPlanById, markPlanOpened, updatePlan, deletePlan,
} = require('./repository');
const { logger } = require('../../utils/logger');

function elapsedMs(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1e6;
}

function recordMetric(req, key, value) {
  req.metrics = req.metrics || {};
  req.metrics[key] = Number(value.toFixed(1));
}

function timelineIdFromRequest(req) {
  return String(req.get('x-plan-timeline-id') || req.body?.timelineId || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 128);
}

function generationRequestIdFromRequest(req) {
  return String(req.get('x-plan-generation-request-id') || req.body?.generationRequestId || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 128);
}

async function createPlanHandler(req, res, next) {
  try {
    const {
      name, planData, customer = null, clientRequestId = null, startDate, durationWeeks,
    } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Plan name is required.' });
    if (!planData) return res.status(400).json({ error: 'planData is required.' });
    const saveStartedAt = process.hrtime.bigint();
    const plan = await createPlan(req.user.id, name, planData, {
      customer,
      clientRequestId,
      startDate,
      durationWeeks,
    });
    recordMetric(req, 'planSaveDbMs', elapsedMs(saveStartedAt));
    logger.info('Plan timeline: server saved plan', {
      requestId: req.id,
      timelineId: timelineIdFromRequest(req),
      generationRequestId: generationRequestIdFromRequest(req),
      planId: plan.id,
      hasCustomer: Boolean(plan.customer_id),
      idempotentReplay: Boolean(plan.idempotentReplay),
      metrics: req.metrics,
    });
    res.status(plan.idempotentReplay ? 200 : 201).json({ plan });
  } catch (err) {
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

async function getPlan(req, res, next) {
  try {
    const plan = await getPlanById(req.params.id, req.user.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });
    res.json({ plan });
  } catch (err) { next(err); }
}

async function markPlanOpenedHandler(req, res, next) {
  try {
    const ok = await markPlanOpened(req.params.id, req.user.id);
    if (!ok) return res.status(404).json({ error: 'Plan not found.' });
    res.status(204).end();
  } catch (err) { next(err); }
}

async function exportPlanPdfHandler(req, res, next) {
  try {
    const plan = await getPlanById(req.params.id, req.user.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });

    const { generatePlanPdf, pdfFilename } = require('./pdfService');
    const { cachedPdf } = require('./pdfCache');
    const options = { clientName: req.validatedQuery?.clientName };
    const { pdf, cache } = await cachedPdf(plan, options, () => generatePlanPdf(plan, options));
    const filename = pdfFilename(plan);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdf.length);
    res.setHeader('X-PDF-Cache', cache);
    return res.send(pdf);
  } catch (err) {
    return next(err);
  }
}

async function updatePlanHandler(req, res, next) {
  try {
    const {
      name, planData, customer, expectedVersion, startDate, durationWeeks,
    } = req.body;
    if (!name && !planData && customer === undefined && startDate === undefined && durationWeeks === undefined) {
      return res.status(400).json({ error: 'name, planData, customer, startDate, or durationWeeks required.' });
    }
    const plan = await updatePlan(req.params.id, req.user.id, {
      name, planData, customer, expectedVersion, startDate, durationWeeks,
    });
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });
    res.json({ plan });
  } catch (err) {
    if (err.code === 'plan-version-conflict') {
      return res.status(409).json({
        error: err.message,
        code: err.code,
        currentVersion: err.currentVersion,
      });
    }
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

async function deletePlanHandler(req, res, next) {
  try {
    const ok = await deletePlan(req.params.id, req.user.id);
    if (!ok) return res.status(404).json({ error: 'Plan not found.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = {
  createPlanHandler,
  getPlan,
  markPlanOpenedHandler,
  exportPlanPdfHandler,
  updatePlanHandler,
  deletePlanHandler,
};
