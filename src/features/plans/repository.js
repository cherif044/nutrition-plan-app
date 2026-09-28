const sequelize = require('../../config/database');
const { Plan, Customer } = require('../../models');
const { resolveCustomerForPlan } = require('../customers/repository');
const { assertCanAddPlan } = require('../../shared/accountQuotas');

function stripMeta(plan) {
  const data = plan.toJSON();
  delete data.plan_data;
  delete data.client_request_id;
  return data;
}

// Copied into their own columns on every write so list pages never have to
// read (and decompress) the large plan_data document.
const SUMMARY_GOALS = new Set(['maintain', 'lose_weight', 'gain_weight']);

function planSummaryColumns(planData) {
  const calories = Number(
    planData?.dailyActuals?.calories
    ?? planData?.dailyTargets?.calories
    ?? planData?.nutritionCalculation?.targetCalories,
  );
  const goal = planData?.input?.goal;
  return {
    // Only known values reach the dashboard filter columns.
    goal: SUMMARY_GOALS.has(goal) ? goal : null,
    calories: Number.isFinite(calories) && calories > 0 ? calories : null,
  };
}

// Accept only opaque, UUID-like keys; anything else is ignored rather than
// rejected so an unusual client still saves normally, just without dedupe.
function normalizeClientRequestId(value) {
  const key = String(value || '').trim();
  return /^[A-Za-z0-9_-]{8,128}$/.test(key) ? key : null;
}

async function findPlanByClientRequestId(userId, clientRequestId) {
  const plan = await Plan.findOne({
    where: { user_id: userId, client_request_id: clientRequestId },
  });
  return plan ? { ...stripMeta(plan), idempotentReplay: true } : null;
}

// A retried or double-submitted save carries the same clientRequestId, so it
// resolves to the plan the first request created instead of a duplicate. The
// unique index on (user_id, client_request_id) settles simultaneous requests.
async function createPlan(userId, name, planData, options = {}) {
  const clientRequestId = normalizeClientRequestId(options.clientRequestId);
  if (clientRequestId) {
    const existing = await findPlanByClientRequestId(userId, clientRequestId);
    if (existing) return existing;
  }

  try {
    return await insertPlan(userId, name, planData, { ...options, clientRequestId });
  } catch (error) {
    if (clientRequestId && error.name === 'SequelizeUniqueConstraintError') {
      const existing = await findPlanByClientRequestId(userId, clientRequestId);
      if (existing) return existing;
    }
    throw error;
  }
}

async function insertPlan(userId, name, planData, options) {
  return sequelize.transaction(async (transaction) => {
    await assertCanAddPlan(userId, planData, transaction);

    const { customer, matchedExisting } = await resolveCustomerForPlan(
      userId,
      options.customer || null,
      planData?.input || {},
      { transaction },
    );
    const customerId = customer?.id || null;

    const plan = await Plan.create({
      user_id: userId,
      customer_id: customerId,
      name: name.trim(),
      plan_data: planData,
      ...planSummaryColumns(planData),
      is_active: false,
      client_request_id: options.clientRequestId,
    }, { transaction });
    return {
      ...stripMeta(plan),
      customerMatchedExisting: matchedExisting,
    };
  });
}

async function markPlanOpened(planId, userId) {
  const [count] = await Plan.update(
    { last_opened_at: new Date() },
    { where: { id: planId, user_id: userId } },
  );
  return count > 0;
}

async function getPlanById(planId, userId) {
  const plan = await Plan.findOne({
    where: { id: planId, user_id: userId },
    // The customer must belong to the same user, so even a plan that somehow
    // pointed at another account's customer could never expose it.
    include: [{
      model: Customer,
      where: { user_id: userId },
      attributes: ['id', 'name', 'age', 'sex', 'weight', 'height', 'activity_level'],
      required: false,
    }],
  });
  if (!plan) return null;
  const data = plan.toJSON();
  delete data.client_request_id;
  return data;
}

function versionConflict(currentVersion) {
  return Object.assign(
    new Error('This plan was changed in another tab or device. Reload to get the latest version.'),
    { status: 409, code: 'plan-version-conflict', currentVersion },
  );
}

async function updatePlan(planId, userId, {
  name, planData, customer, expectedVersion,
}) {
  return sequelize.transaction(async (transaction) => {
    const plan = await Plan.findOne({
      where: { id: planId, user_id: userId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!plan) return null;

    // Optimistic concurrency: the row lock above serializes writers, and the
    // version check rejects a writer that started from an older copy. Clients
    // that send no version (older cached scripts) keep last-write-wins.
    const currentVersion = Number(plan.version || 1);
    if (expectedVersion !== undefined && expectedVersion !== null
      && Number(expectedVersion) !== currentVersion) {
      throw versionConflict(currentVersion);
    }

    const updates = { updated_at: new Date(), version: currentVersion + 1 };
    if (name !== undefined) updates.name = name.trim();
    if (planData !== undefined) {
      updates.plan_data = planData;
      Object.assign(updates, planSummaryColumns(planData));
    }
    if (customer !== undefined) {
      const { customer: resolvedCustomer } = await resolveCustomerForPlan(
        userId,
        customer,
        (planData || plan.plan_data)?.input || {},
        { transaction },
      );
      updates.customer_id = resolvedCustomer?.id || null;
      updates.is_active = false;
    }

    await plan.update(updates, { transaction });
    return stripMeta(plan);
  });
}

async function deletePlan(planId, userId) {
  const plan = await Plan.findOne({
    where: { id: planId, user_id: userId },
  });
  if (!plan) return false;
  await plan.destroy();
  return true;
}

module.exports = {
  createPlan,
  getPlanById,
  markPlanOpened,
  updatePlan,
  deletePlan,
};
