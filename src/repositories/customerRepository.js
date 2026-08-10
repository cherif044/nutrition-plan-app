const { Op, fn, col, where } = require('sequelize');
const { Customer, Plan } = require('../models');

const PROFILE_FIELD_MAP = Object.freeze({
  age: 'age',
  sex: 'sex',
  weight: 'weight',
  weightKg: 'weight',
  height: 'height',
  heightCm: 'height',
  activityLevel: 'activity_level',
  activity_level: 'activity_level',
  goal: 'goal',
});

function normalizeCustomerName(name) {
  return String(name || '').trim().toLowerCase();
}

function cleanCustomerName(name) {
  return String(name || '').trim();
}

function normalizedNameWhere(name) {
  return where(fn('lower', fn('btrim', col('name'))), normalizeCustomerName(name));
}

function customerProfileFromInput(input = {}) {
  return {
    age: nullableNumber(input.age, { integer: true }),
    sex: input.sex || null,
    weight: nullableNumber(input.weightKg ?? input.weight),
    height: nullableNumber(input.heightCm ?? input.height),
    activity_level: input.activityLevel || input.activity_level || null,
    goal: input.goal || null,
  };
}

function nullableNumber(value, { integer = false } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return integer ? Math.round(number) : number;
}

function profileUpdatesFromTouched(input = {}, touchedFields = []) {
  const profile = customerProfileFromInput(input);
  const updates = {};

  for (const field of touchedFields || []) {
    const column = PROFILE_FIELD_MAP[field];
    if (!column || !(column in profile)) continue;
    updates[column] = profile[column];
  }

  return updates;
}

async function findCustomerByNormalizedName(userId, name, options = {}) {
  const normalized = normalizeCustomerName(name);
  if (!normalized) return null;
  return Customer.findOne({
    where: {
      user_id: userId,
      [Op.and]: [normalizedNameWhere(name)],
    },
    ...options,
  });
}

async function findCustomerById(userId, customerId, options = {}) {
  if (!customerId) return null;
  return Customer.findOne({ where: { id: customerId, user_id: userId }, ...options });
}

async function resolveCustomerForPlan(userId, selection = null, planInput = {}, options = {}) {
  const transaction = options.transaction;
  if (!selection) return { customer: null, matchedExisting: false };

  const touchedFields = Array.isArray(selection.touchedFields) ? selection.touchedFields : [];

  if (selection.id) {
    const customer = await findCustomerById(userId, selection.id, {
      transaction,
      lock: transaction?.LOCK?.UPDATE,
    });
    if (!customer) throw Object.assign(new Error('Customer not found.'), { status: 404 });
    await syncTouchedProfileFields(customer, planInput, touchedFields, transaction);
    return { customer, matchedExisting: true };
  }

  const name = cleanCustomerName(selection.name);
  if (!name) return { customer: null, matchedExisting: false };

  const existing = await findCustomerByNormalizedName(userId, name, {
    transaction,
    lock: transaction?.LOCK?.UPDATE,
  });
  if (existing) {
    await syncTouchedProfileFields(existing, planInput, touchedFields, transaction);
    return { customer: existing, matchedExisting: true };
  }

  const customer = await Customer.create({
    user_id: userId,
    name,
    ...customerProfileFromInput(planInput),
  }, { transaction });
  return { customer, matchedExisting: false };
}

async function syncTouchedProfileFields(customer, planInput, touchedFields, transaction) {
  const updates = profileUpdatesFromTouched(planInput, touchedFields);
  if (!Object.keys(updates).length) return;

  // Existing customers sync only fields the coach explicitly touched in the
  // generation form this session. Untouched fields are never overwritten by a
  // saved plan's current values.
  updates.updated_at = new Date();
  await customer.update(updates, { transaction });
}

async function listCustomers(userId, { query = '' } = {}) {
  const whereClause = { user_id: userId };
  const normalized = normalizeCustomerName(query);
  if (normalized) {
    whereClause[Op.and] = [
      where(fn('lower', fn('btrim', col('name'))), {
        [Op.like]: `%${normalized}%`,
      }),
    ];
  }

  return Customer.findAll({
    where: whereClause,
    attributes: ['id', 'name', 'age', 'sex', 'weight', 'height', 'activity_level', 'goal', 'created_at', 'updated_at'],
    order: [['name', 'ASC']],
    limit: 25,
  });
}

async function listCustomersWithPlanSummary(userId) {
  const [customers, plans] = await Promise.all([
    Customer.findAll({
      where: { user_id: userId },
      attributes: ['id', 'name', 'age', 'sex', 'weight', 'height', 'activity_level', 'goal', 'created_at', 'updated_at'],
      order: [['name', 'ASC']],
    }),
    Plan.findAll({
      where: { user_id: userId },
      attributes: ['id', 'customer_id', 'name', 'is_active', 'updated_at', 'created_at'],
      order: [['updated_at', 'DESC'], ['created_at', 'DESC']],
    }),
  ]);

  const plansByCustomer = new Map();
  for (const plan of plans.map((p) => p.toJSON())) {
    if (!plan.customer_id) continue;
    const key = String(plan.customer_id);
    if (!plansByCustomer.has(key)) plansByCustomer.set(key, []);
    plansByCustomer.get(key).push(plan);
  }

  return customers.map((customer) => {
    const data = customer.toJSON();
    const customerPlans = plansByCustomer.get(String(data.id)) || [];
    const activePlan = customerPlans.find((plan) => plan.is_active) || null;
    return {
      ...data,
      planCount: customerPlans.length,
      activePlan: activePlan ? { id: activePlan.id, name: activePlan.name } : null,
    };
  });
}

async function getCustomerPlans(userId, customerId) {
  const customer = await findCustomerById(userId, customerId);
  if (!customer) return null;

  const plans = await Plan.findAll({
    where: { user_id: userId, customer_id: customerId },
    attributes: ['id', 'folder_id', 'customer_id', 'name', 'is_active', 'created_at', 'updated_at'],
    order: [['is_active', 'DESC'], ['updated_at', 'DESC'], ['created_at', 'DESC']],
  });

  return {
    customer,
    plans,
  };
}

async function deleteCustomer(userId, customerId) {
  const count = await Customer.destroy({ where: { id: customerId, user_id: userId } });
  return count > 0;
}

module.exports = {
  PROFILE_FIELD_MAP,
  normalizeCustomerName,
  cleanCustomerName,
  customerProfileFromInput,
  profileUpdatesFromTouched,
  findCustomerByNormalizedName,
  findCustomerById,
  resolveCustomerForPlan,
  listCustomers,
  listCustomersWithPlanSummary,
  getCustomerPlans,
  deleteCustomer,
};
