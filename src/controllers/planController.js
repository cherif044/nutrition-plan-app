const { createPlan, getPlanById, updatePlan, deletePlan, duplicatePlan, setPlanActive } = require('../repositories/planRepository');
const { generatePlanPdf, pdfFilename } = require('../services/planPdfService');

async function createPlanHandler(req, res, next) {
  try {
    const { name, planData, folderId = null, customer = null, isActive = false } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Plan name is required.' });
    if (!planData) return res.status(400).json({ error: 'planData is required.' });
    const plan = await createPlan(req.user.id, folderId || null, name, planData, { customer, isActive });
    res.status(201).json({ plan });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

async function getPlan(req, res, next) {
  try {
    const plan = await getPlanById(req.params.id, req.user.id, { markOpened: true });
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });
    res.json({ plan });
  } catch (err) { next(err); }
}

async function exportPlanPdfHandler(req, res, next) {
  try {
    const plan = await getPlanById(req.params.id, req.user.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });

    const pdf = await generatePlanPdf(plan);
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
    const { name, planData, folderId, customer, isActive } = req.body;
    if (!name && !planData && folderId === undefined && customer === undefined && isActive === undefined) {
      return res.status(400).json({ error: 'name, planData, folderId, customer, or isActive required.' });
    }
    const plan = await updatePlan(req.params.id, req.user.id, { name, planData, folderId, customer, isActive });
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });
    res.json({ plan });
  } catch (err) { next(err); }
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
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

async function setPlanActiveHandler(req, res, next) {
  try {
    const plan = await setPlanActive(req.params.id, req.user.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });
    res.json({ plan });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

module.exports = {
  createPlanHandler,
  getPlan,
  exportPlanPdfHandler,
  updatePlanHandler,
  deletePlanHandler,
  duplicatePlanHandler,
  setPlanActiveHandler,
};
