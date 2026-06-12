const { Plan, Folder } = require('../models');

function stripMeta(plan) {
  const { Folder: _f, plan_data, ...rest } = plan.toJSON();
  return rest;
}

async function createPlan(folderId, name, planData) {
  const plan = await Plan.create({ folder_id: folderId, name: name.trim(), plan_data: planData });
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
    where: { id: planId },
    include: [{ model: Folder, where: { user_id: userId }, required: true, attributes: [] }],
  });
  if (!plan) return null;
  const { Folder: _f, ...rest } = plan.toJSON();
  return rest;
}

async function updatePlan(planId, userId, { name, planData }) {
  const plan = await Plan.findOne({
    where: { id: planId },
    include: [{ model: Folder, where: { user_id: userId }, required: true, attributes: [] }],
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
    where: { id: planId },
    include: [{ model: Folder, where: { user_id: userId }, required: true, attributes: [] }],
  });
  if (!plan) return false;
  await plan.destroy();
  return true;
}

async function duplicatePlan(planId, userId, targetFolderId, newName) {
  const source = await getPlanById(planId, userId);
  if (!source) throw Object.assign(new Error('Plan not found.'), { status: 404 });

  const targetFolder = await Folder.findOne({ where: { id: targetFolderId, user_id: userId } });
  if (!targetFolder) throw Object.assign(new Error('Target folder not found.'), { status: 404 });

  const plan = await Plan.create({
    folder_id: targetFolderId,
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
