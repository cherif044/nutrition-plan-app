const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { createCustomer, getCustomersByCoach, getCustomerById, deleteCustomer } = require('../models/Customer');
const { createPlan, getPlansByCustomer, getPlanById, deletePlan } = require('../models/Plan');
const { generatePlan } = require('../services/planGenerator');

const router = express.Router();

// ── Customers ────────────────────────────────────────────────────────────────

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const customers = await getCustomersByCoach(req.user.id);
    res.json({ customers });
  } catch (err) { next(err); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { username, firstName, lastName } = req.body;
    if (!username?.trim()) return res.status(400).json({ error: 'Username is required.' });
    if (!firstName?.trim()) return res.status(400).json({ error: 'First name is required.' });
    const customer = await createCustomer(req.user.id, { username, firstName, lastName });
    res.status(201).json({ customer });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A customer with that username already exists.' });
    next(err);
  }
});

router.get('/:customerId', requireAuth, async (req, res, next) => {
  try {
    const customer = await getCustomerById(req.params.customerId, req.user.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });
    res.json({ customer });
  } catch (err) { next(err); }
});

router.delete('/:customerId', requireAuth, async (req, res, next) => {
  try {
    const deleted = await deleteCustomer(req.params.customerId, req.user.id);
    if (!deleted) return res.status(404).json({ error: 'Customer not found.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Plans ────────────────────────────────────────────────────────────────────

router.get('/:customerId/plans', requireAuth, async (req, res, next) => {
  try {
    const customer = await getCustomerById(req.params.customerId, req.user.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });
    const plans = await getPlansByCustomer(req.params.customerId);
    res.json({ plans });
  } catch (err) { next(err); }
});

router.post('/:customerId/plans', requireAuth, async (req, res, next) => {
  try {
    const customer = await getCustomerById(req.params.customerId, req.user.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });

    const { planName, planData: existingData, ...planInput } = req.body;
    if (!planName?.trim()) return res.status(400).json({ error: 'Plan name is required.' });

    // Accept either pre-built plan data (from interactive planner) or regenerate from inputs
    const planData = existingData || generatePlan(planInput);
    const plan = await createPlan(req.params.customerId, planName, planData);
    res.status(201).json({ plan, planData });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A plan with that name already exists for this customer.' });
    next(err);
  }
});

router.get('/:customerId/plans/:planId', requireAuth, async (req, res, next) => {
  try {
    const customer = await getCustomerById(req.params.customerId, req.user.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });
    const plan = await getPlanById(req.params.planId, req.params.customerId);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });
    res.json({ plan });
  } catch (err) { next(err); }
});

router.delete('/:customerId/plans/:planId', requireAuth, async (req, res, next) => {
  try {
    const customer = await getCustomerById(req.params.customerId, req.user.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });
    const deleted = await deletePlan(req.params.planId, req.params.customerId);
    if (!deleted) return res.status(404).json({ error: 'Plan not found.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
