const {
  createPlan, getPlanById, markPlanOpened, updatePlan, deletePlan, duplicatePlan,
} = require('../repositories/planRepository');
const { logger } = require('../utils/logger');

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
      name, planData, folderId = null, customer = null, clientRequestId = null,
    } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Plan name is required.' });
    if (!planData) return res.status(400).json({ error: 'planData is required.' });
    const saveStartedAt = process.hrtime.bigint();
    const plan = await createPlan(req.user.id, folderId || null, name, planData, {
      customer,
      clientRequestId,
    });
    recordMetric(req, 'planSaveDbMs', elapsedMs(saveStartedAt));
    logger.info('Plan timeline: server saved plan', {
      requestId: req.id,
      timelineId: timelineIdFromRequest(req),
      generationRequestId: generationRequestIdFromRequest(req),
      planId: plan.id,
      folderId: folderId || null,
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

    const { generatePlanPdf, pdfFilename } = require('../services/planPdfService');
    const pdf = await generatePlanPdf(plan, { clientName: req.validatedQuery?.clientName });
    const filename = pdfFilename(plan);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdf.length);
    return res.send(pdf);
  } catch (err) {
    return next(err);
  }
}

async function updatePlanHandler(req, res, next) {
  try {
    const {
      name, planData, folderId, customer, expectedVersion,
    } = req.body;
    if (!name && !planData && folderId === undefined && customer === undefined) {
      return res.status(400).json({ error: 'name, planData, folderId, or customer required.' });
    }
    const plan = await updatePlan(req.params.id, req.user.id, {
      name, planData, folderId, customer, expectedVersion,
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

async function duplicatePlanHandler(req, res, next) {
  try {
    const { targetFolderId = null, newName } = req.body;
    const plan = await duplicatePlan(req.params.id, req.user.id, targetFolderId, newName);
    res.status(201).json({ plan });
  } catch (err) {
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

module.exports = {
  createPlanHandler,
  getPlan,
  markPlanOpenedHandler,
  exportPlanPdfHandler,
  updatePlanHandler,
  deletePlanHandler,
  duplicatePlanHandler,
};
