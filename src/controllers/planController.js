const { createPlan, getPlanById, updatePlan, deletePlan, duplicatePlan } = require('../repositories/planRepository');

async function createPlanHandler(req, res, next) {
  try {
    const { name, planData, folderId = null } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Plan name is required.' });
    if (!planData) return res.status(400).json({ error: 'planData is required.' });
    const plan = await createPlan(req.user.id, folderId || null, name, planData);
    res.status(201).json({ plan });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
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

async function updatePlanHandler(req, res, next) {
  try {
    const { name, planData } = req.body;
    if (!name && !planData) return res.status(400).json({ error: 'name or planData required.' });
    const plan = await updatePlan(req.params.id, req.user.id, { name, planData });
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

module.exports = { createPlanHandler, getPlan, updatePlanHandler, deletePlanHandler, duplicatePlanHandler };
