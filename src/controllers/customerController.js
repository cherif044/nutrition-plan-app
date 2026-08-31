const {
  findCustomerByNormalizedName,
  createCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
  getCustomerPlans,
  deleteCustomer,
} = require('../repositories/customerRepository');

async function listCustomersHandler(req, res, next) {
  try {
    const customers = await listCustomers(req.user.id, { query: req.query.query || '' });
    res.json({ customers });
  } catch (err) { next(err); }
}

async function matchCustomerHandler(req, res, next) {
  try {
    const customer = await findCustomerByNormalizedName(req.user.id, req.query.name || '');
    res.json({ customer });
  } catch (err) { next(err); }
}

async function createCustomerHandler(req, res, next) {
  try {
    const customer = await createCustomer(req.user.id, req.body || {});
    res.status(201).json({ customer });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
}

async function getCustomerHandler(req, res, next) {
  try {
    const customer = await getCustomer(req.user.id, req.params.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });
    return res.json({ customer });
  } catch (err) { return next(err); }
}

async function updateCustomerHandler(req, res, next) {
  try {
    const customer = await updateCustomer(req.user.id, req.params.id, req.body || {});
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });
    return res.json({ customer });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
}

async function getCustomerPlansHandler(req, res, next) {
  try {
    const data = await getCustomerPlans(req.user.id, req.params.id);
    if (!data) return res.status(404).json({ error: 'Customer not found.' });
    res.json({ customer: data.customer, plans: data.plans });
  } catch (err) { next(err); }
}

async function deleteCustomerHandler(req, res, next) {
  try {
    const ok = await deleteCustomer(req.user.id, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Customer not found.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = {
  listCustomersHandler,
  matchCustomerHandler,
  createCustomerHandler,
  getCustomerHandler,
  updateCustomerHandler,
  getCustomerPlansHandler,
  deleteCustomerHandler,
};
