const { Plan, Folder } = require('../models');

function stripMeta(plan) {
  const { Folder: _f, plan_data, ...rest } = plan.toJSON();
  return rest;
}

async function createPlan(userId, folderId, name, planData) {
  if (folderId !== null && folderId !== undefined) {
    const folder = await Folder.findOne({ where: { id: folderId, user_id: userId } });
    if (!folder) throw Object.assign(new Error('Folder not found.'), { status: 404 });
  }

  const plan = await Plan.create({
    user_id: userId,
    folder_id: folderId || null,
    name: name.trim(),
    plan_data: planData,
  });
  const { plan_data: _, ...rest } = plan.toJSON();
  return rest;
}

async function getPlansByFolder(folderId) {
  return Plan.findAll({
    where: { folder_id: folderId },
    attributes: ['id', 'folder_id', 'name', 'created_at', 'updated_at'],
    order: [['created_at', 'DESC']],
  });
}

async function getPlanById(planId, userId) {
  const plan = await Plan.findOne({
    where: { id: planId, user_id: userId },
  });
  if (!plan) return null;
  return plan.toJSON();
}

async function updatePlan(planId, userId, { name, planData }) {
  const plan = await Plan.findOne({
    where: { id: planId, user_id: userId },
  });
  if (!plan) return null;

  const updates = { updated_at: new Date() };
  if (name !== undefined) updates.name = name.trim();
  if (planData !== undefined) updates.plan_data = planData;

  await plan.update(updates);
  return stripMeta(plan);
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
    name: (newName || source.name).trim(),
    plan_data: source.plan_data,
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
