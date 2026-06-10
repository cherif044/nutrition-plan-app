const { createCustomer, getCustomersByCoach, getCustomerById, deleteCustomer } = require('../repositories/customerRepository');
const { createPlan, getPlansByCustomer, getPlanById, deletePlan } = require('../repositories/planRepository');
const { generatePlan } = require('../services/planGenerator');

async function listCustomers(req, res, next) {
  try {
    const customers = await getCustomersByCoach(req.user.id);
    res.json({ customers });
  } catch (err) { next(err); }
}

async function createCustomerHandler(req, res, next) {
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
}

async function getCustomer(req, res, next) {
  try {
    const customer = await getCustomerById(req.params.customerId, req.user.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });
    res.json({ customer });
  } catch (err) { next(err); }
}

async function deleteCustomerHandler(req, res, next) {
  try {
    const deleted = await deleteCustomer(req.params.customerId, req.user.id);
    if (!deleted) return res.status(404).json({ error: 'Customer not found.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function listCustomerPlans(req, res, next) {
  try {
    const customer = await getCustomerById(req.params.customerId, req.user.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });
    const plans = await getPlansByCustomer(req.params.customerId);
    res.json({ plans });
  } catch (err) { next(err); }
}

async function createCustomerPlan(req, res, next) {
  try {
    const customer = await getCustomerById(req.params.customerId, req.user.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });

    const { planName, planData: existingData, ...planInput } = req.body;
    if (!planName?.trim()) return res.status(400).json({ error: 'Plan name is required.' });

    const planData = existingData || generatePlan(planInput);
    const plan = await createPlan(req.params.customerId, planName, planData);
    res.status(201).json({ plan, planData });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A plan with that name already exists for this customer.' });
    next(err);
  }
}

async function getCustomerPlan(req, res, next) {
  try {
    const customer = await getCustomerById(req.params.customerId, req.user.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });
    const plan = await getPlanById(req.params.planId, req.params.customerId);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });
    res.json({ plan });
  } catch (err) { next(err); }
}

async function deleteCustomerPlan(req, res, next) {
  try {
    const customer = await getCustomerById(req.params.customerId, req.user.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });
    const deleted = await deletePlan(req.params.planId, req.params.customerId);
    if (!deleted) return res.status(404).json({ error: 'Plan not found.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = {
  listCustomers,
  createCustomerHandler,
  getCustomer,
  deleteCustomerHandler,
  listCustomerPlans,
  createCustomerPlan,
  getCustomerPlan,
  deleteCustomerPlan,
};
