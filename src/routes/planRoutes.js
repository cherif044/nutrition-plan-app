const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getPlanById, updatePlan, deletePlan, duplicatePlan } = require('../models/Plan');

const router = express.Router();

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const plan = await getPlanById(req.params.id, req.user.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });
    res.json({ plan });
  } catch (err) { next(err); }
});

router.put('/:id', requireAuth, async (req, res, next) => {
  try {
    const { name, planData } = req.body;
    if (!name && !planData) return res.status(400).json({ error: 'name or planData required.' });
    const plan = await updatePlan(req.params.id, req.user.id, { name, planData });
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });
    res.json({ plan });
  } catch (err) { next(err); }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const ok = await deletePlan(req.params.id, req.user.id);
    if (!ok) return res.status(404).json({ error: 'Plan not found.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/:id/duplicate', requireAuth, async (req, res, next) => {
  try {
    const { targetFolderId, newName } = req.body;
    if (!targetFolderId) return res.status(400).json({ error: 'targetFolderId is required.' });
    const plan = await duplicatePlan(req.params.id, req.user.id, targetFolderId, newName);
    res.status(201).json({ plan });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
