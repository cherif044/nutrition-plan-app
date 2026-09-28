const sequelize = require('../config/database');
const { Plan, Folder, Customer } = require('../models');
const { resolveCustomerForPlan } = require('./customerRepository');

function stripMeta(plan) {
  const { Folder: _f, plan_data, client_request_id: _key, ...rest } = plan.toJSON();
  return rest;
}

// Copied into their own columns on every write so list pages never have to
// read (and decompress) the large plan_data document.
function planSummaryColumns(planData) {
  const calories = Number(
    planData?.dailyActuals?.calories
    ?? planData?.dailyTargets?.calories
    ?? planData?.nutritionCalculation?.targetCalories,
  );
  return {
    goal: planData?.input?.goal || null,
    diet_type: planData?.input?.dietType || null,
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
async function createPlan(userId, folderId, name, planData, options = {}) {
  const clientRequestId = normalizeClientRequestId(options.clientRequestId);
  if (clientRequestId) {
    const existing = await findPlanByClientRequestId(userId, clientRequestId);
    if (existing) return existing;
  }

  try {
    return await insertPlan(userId, folderId, name, planData, { ...options, clientRequestId });
  } catch (error) {
    if (clientRequestId && error.name === 'SequelizeUniqueConstraintError') {
      const existing = await findPlanByClientRequestId(userId, clientRequestId);
      if (existing) return existing;
    }
    throw error;
  }
}

async function insertPlan(userId, folderId, name, planData, options) {
  return sequelize.transaction(async (transaction) => {
    if (folderId !== null && folderId !== undefined) {
      const folder = await Folder.findOne({ where: { id: folderId, user_id: userId }, transaction });
      if (!folder) throw Object.assign(new Error('Folder not found.'), { status: 404 });
    }

    const { customer, matchedExisting } = await resolveCustomerForPlan(
      userId,
      options.customer || null,
      planData?.input || {},
      { transaction },
    );
    const customerId = customer?.id || null;

    const plan = await Plan.create({
      user_id: userId,
      folder_id: folderId || null,
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

async function getPlansByFolder(folderId) {
  return Plan.findAll({
    where: { folder_id: folderId },
    attributes: ['id', 'folder_id', 'customer_id', 'name', 'last_opened_at', 'created_at', 'updated_at'],
    order: [['created_at', 'DESC']],
  });
}

async function getPlanById(planId, userId, { markOpened = false } = {}) {
  const plan = await Plan.findOne({
    where: { id: planId, user_id: userId },
    include: [{
      model: Customer,
      attributes: ['id', 'name', 'age', 'sex', 'weight', 'height', 'activity_level'],
      required: false,
    }],
  });
  if (!plan) return null;
  const { client_request_id: _key, ...data } = plan.toJSON();
  if (markOpened) {
    data.last_opened_at = new Date();
    Plan.update(
      { last_opened_at: data.last_opened_at },
      { where: { id: planId, user_id: userId } },
    ).catch(() => {});
  }
  return data;
}

function versionConflict(currentVersion) {
  return Object.assign(
    new Error('This plan was changed in another tab or device. Reload to get the latest version.'),
    { status: 409, code: 'plan-version-conflict', currentVersion },
  );
}

async function updatePlan(planId, userId, {
  name, planData, folderId, customer, expectedVersion,
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
    if (folderId !== undefined) {
      if (folderId !== null) {
        const folder = await Folder.findOne({ where: { id: folderId, user_id: userId }, transaction });
        if (!folder) throw Object.assign(new Error('Folder not found.'), { status: 404 });
      }
      updates.folder_id = folderId || null;
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

async function duplicatePlan(planId, userId, targetFolderId, newName) {
  const source = await getPlanById(planId, userId);
  if (!source) throw Object.assign(new Error('Plan not found.'), { status: 404 });

  if (targetFolderId !== null && targetFolderId !== undefined) {
    const targetFolder = await Folder.findOne({ where: { id: targetFolderId, user_id: userId } });
    if (!targetFolder) throw Object.assign(new Error('Target folder not found.'), { status: 404 });
  }

  const plan = await Plan.create({
    user_id: userId,
    folder_id: targetFolderId || null,
    customer_id: source.customer_id || null,
    name: (newName || source.name).trim(),
    plan_data: source.plan_data,
    ...planSummaryColumns(source.plan_data),
    is_active: false,
    last_opened_at: null,
  });
  return stripMeta(plan);
}

module.exports = {
  createPlan,
  getPlansByFolder,
  getPlanById,
  updatePlan,
  deletePlan,
  duplicatePlan,
};
