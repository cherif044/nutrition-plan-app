const sequelize = require('../config/database');
const { Plan, Folder, Customer } = require('../models');
const { resolveCustomerForPlan } = require('./customerRepository');

function stripMeta(plan) {
  const { Folder: _f, plan_data, ...rest } = plan.toJSON();
  return rest;
}

async function createPlan(userId, folderId, name, planData, options = {}) {
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
      is_active: false,
    }, { transaction });
    const { plan_data: _, ...rest } = plan.toJSON();
    return {
      ...rest,
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
  const data = plan.toJSON();
  if (markOpened) {
    data.last_opened_at = new Date();
    Plan.update(
      { last_opened_at: data.last_opened_at },
      { where: { id: planId, user_id: userId } },
    ).catch(() => {});
  }
  return data;
}

async function updatePlan(planId, userId, { name, planData, folderId, customer }) {
  return sequelize.transaction(async (transaction) => {
    const plan = await Plan.findOne({
      where: { id: planId, user_id: userId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!plan) return null;

    const updates = { updated_at: new Date() };
    if (name !== undefined) updates.name = name.trim();
    if (planData !== undefined) updates.plan_data = planData;
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
    is_active: false,
    last_opened_at: null,
  });
  const { plan_data: _, ...rest } = plan.toJSON();
  return rest;
}

module.exports = {
  createPlan,
  getPlansByFolder,
  getPlanById,
  updatePlan,
  deletePlan,
  duplicatePlan,
};
