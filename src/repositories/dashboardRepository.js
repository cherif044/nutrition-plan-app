const { Op } = require('sequelize');
const { Folder, Plan, Customer } = require('../models');
const { listCustomersWithPlanSummary } = require('./customerRepository');

function folderPathFor(folderId, foldersById) {
  if (!folderId) return [];

  const path = [];
  const seen = new Set();
  let current = foldersById.get(String(folderId));

  while (current && !seen.has(String(current.id))) {
    seen.add(String(current.id));
    path.unshift({ id: current.id, name: current.name });
    current = current.parent_id ? foldersById.get(String(current.parent_id)) : null;
  }

  return path;
}

async function getDashboardSummary(userId) {
  const [totalPlans, totalCustomers, activePlans, folders, recentPlans, customers] = await Promise.all([
    Plan.count({ where: { user_id: userId } }),
    Customer.count({ where: { user_id: userId } }),
    Plan.count({ where: { user_id: userId, is_active: true } }),
    Folder.findAll({
      where: { user_id: userId },
      attributes: ['id', 'name', 'parent_id'],
    }),
    Plan.findAll({
      where: { user_id: userId, last_opened_at: { [Op.ne]: null } },
      attributes: ['id', 'folder_id', 'customer_id', 'name', 'plan_data', 'is_active', 'last_opened_at', 'created_at', 'updated_at'],
      order: [['last_opened_at', 'DESC']],
      limit: 3,
    }),
    listCustomersWithPlanSummary(userId),
  ]);

  const foldersById = new Map(folders.map((folder) => [String(folder.id), folder.toJSON()]));
  const plans = recentPlans.map((plan) => {
    const data = plan.toJSON();
    const folderPath = folderPathFor(data.folder_id, foldersById);
    const planData = data.plan_data || {};

    return {
      id: data.id,
      folder_id: data.folder_id,
      customer_id: data.customer_id,
      name: data.name,
      is_active: data.is_active,
      last_opened_at: data.last_opened_at,
      created_at: data.created_at,
      updated_at: data.updated_at,
      folderPath,
      status: planData.status || planData.diagnostics?.status || null,
      goal: planData.input?.goal || null,
      dietType: planData.input?.dietType || null,
    };
  });

  return {
    stats: {
      totalPlans,
      customers: totalCustomers,
      activePlans,
    },
    recentPlans: plans,
    customers,
  };
}

module.exports = { getDashboardSummary };
