const {
  findCustomerByNormalizedName,
  listCustomers,
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
  getCustomerPlansHandler,
  deleteCustomerHandler,
};
