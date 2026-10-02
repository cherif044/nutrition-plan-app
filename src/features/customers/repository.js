const sequelize = require('../../config/database');
const { Op, fn, col, where } = require('sequelize');
const { Customer, Plan } = require('../../models');
const { customerBody } = require('../../validation/schemas');
const { likePattern } = require('../../shared/likePattern');
const { assertCanAddCustomer } = require('../../shared/accountQuotas');

const PROFILE_FIELD_MAP = Object.freeze({
  age: 'age',
  sex: 'sex',
  weight: 'weight',
  weightKg: 'weight',
  height: 'height',
  heightCm: 'height',
  activityLevel: 'activity_level',
  activity_level: 'activity_level',
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

// Every write path (the customer routes and plan saves) goes through the same
// bounds as customerBody. A value outside them is stored as unknown (null)
// rather than as-is, so a plan save can never write age 999 or weight -1.
function boundedField(schema, value) {
  const result = schema.safeParse(value);
  return result.success && result.data !== '' && result.data !== undefined ? result.data : null;
}

function customerProfileFromInput(input = {}) {
  const { shape } = customerBody;
  return {
    age: boundedField(shape.age, input.age),
    sex: boundedField(shape.sex, input.sex),
    weight: boundedField(shape.weightKg, input.weightKg ?? input.weight),
    height: boundedField(shape.heightCm, input.heightCm ?? input.height),
    activity_level: boundedField(shape.activityLevel, input.activityLevel ?? input.activity_level),
  };
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

  await assertCanAddCustomer(userId, transaction);
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

async function listCustomers(userId, { query = '', limit = 25 } = {}) {
  const whereClause = { user_id: userId };
  const normalized = normalizeCustomerName(query);
  if (normalized) {
    whereClause[Op.and] = [
      // %, _ and \\ in the search are matched literally, not as wildcards.
      where(fn('lower', fn('btrim', col('name'))), {
        [Op.like]: likePattern(normalized),
      }),
    ];
  }

  return Customer.findAll({
    where: whereClause,
    attributes: ['id', 'name', 'age', 'sex', 'weight', 'height', 'activity_level', 'created_at', 'updated_at'],
    order: [['name', 'ASC']],
    limit: customerListLimit(limit),
  });
}

function customerListLimit(value) {
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) return 25;
  return Math.min(Math.round(limit), 100);
}

async function createCustomer(userId, input = {}) {
  const name = cleanCustomerName(input.name);
  if (!name) throw Object.assign(new Error('Customer name is required.'), { status: 400 });

  return sequelize.transaction(async (transaction) => {
    await assertCanAddCustomer(userId, transaction);
    return Customer.create({
      user_id: userId,
      name,
      ...customerProfileFromInput(input),
    }, { transaction });
  });
}

async function getCustomer(userId, customerId) {
  return findCustomerById(userId, customerId);
}

async function updateCustomer(userId, customerId, input = {}) {
  const customer = await findCustomerById(userId, customerId);
  if (!customer) return null;

  const name = cleanCustomerName(input.name);
  if (!name) throw Object.assign(new Error('Customer name is required.'), { status: 400 });

  const existing = await findCustomerByNormalizedName(userId, name);
  if (existing && String(existing.id) !== String(customer.id)) {
    throw Object.assign(new Error('A customer with this name already exists.'), { status: 409 });
  }

  await customer.update({
    name,
    ...customerProfileFromInput(input),
    updated_at: new Date(),
  });
  return customer;
}

async function getCustomerPlans(userId, customerId, options = {}) {
  const customer = await findCustomerById(userId, customerId);
  if (!customer) return null;

  // Lazy require: dashboardRepository is not needed by the rest of this module.
  const { normalizePaging, pageResult, planRowToSummary } = require('../dashboard/repository');
  const paging = normalizePaging(options);
  const where = { user_id: userId, customer_id: customerId };
  const [plans, total] = await Promise.all([
    Plan.findAll({
      where,
      attributes: [
        'id', 'customer_id', 'name', 'created_at', 'updated_at', 'goal',
        'calories', 'protein_g', 'carbs_g', 'fat_g', 'start_date', 'duration_weeks',
      ],
      order: [['updated_at', 'DESC'], ['id', 'DESC']],
      limit: paging.pageSize,
      offset: paging.offset,
    }),
    Plan.count({ where }),
  ]);

  const page = pageResult(plans.map((plan) => planRowToSummary(plan.toJSON())), total, paging);

  return { customer, plans: page.items, pagination: { ...page, items: undefined } };
}

async function deleteCustomer(userId, customerId) {
  return sequelize.transaction(async (transaction) => {
    const customer = await findCustomerById(userId, customerId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!customer) return false;

    await Plan.update(
      { customer_id: null, is_active: false, updated_at: new Date() },
      { where: { user_id: userId, customer_id: customerId }, transaction },
    );
    await customer.destroy({ transaction });
    return true;
  });
}

module.exports = {
  PROFILE_FIELD_MAP,
  normalizeCustomerName,
  cleanCustomerName,
  customerProfileFromInput,
  profileUpdatesFromTouched,
  findCustomerById,
  resolveCustomerForPlan,
  createCustomer,
  getCustomer,
  updateCustomer,
  listCustomers,
  getCustomerPlans,
  deleteCustomer,
};
