const { pool } = require('../config/db');

async function createPlan(folderId, name, planData) {
  const { rows } = await pool.query(
    `INSERT INTO plans (folder_id, name, plan_data)
     VALUES ($1, $2, $3)
     RETURNING id, folder_id, name, created_at, updated_at`,
    [folderId, name.trim(), JSON.stringify(planData)],
  );
  return rows[0];
}

async function getPlansByFolder(folderId) {
  const { rows } = await pool.query(
    `SELECT id, folder_id, name, created_at, updated_at
     FROM plans WHERE folder_id = $1 ORDER BY created_at DESC`,
    [folderId],
  );
  return rows;
}

async function getPlanById(planId, userId) {
  const { rows } = await pool.query(
    `SELECT p.id, p.folder_id, p.name, p.plan_data, p.created_at, p.updated_at
     FROM plans p
     JOIN folders f ON f.id = p.folder_id
     WHERE p.id = $1 AND f.user_id = $2`,
    [planId, userId],
  );
  return rows[0] || null;
}

async function updatePlan(planId, userId, { name, planData }) {
  const fields = [];
  const values = [];
  let idx = 1;

  if (name !== undefined) {
    fields.push(`name = $${idx++}`);
    values.push(name.trim());
  }
  if (planData !== undefined) {
    fields.push(`plan_data = $${idx++}`);
    values.push(JSON.stringify(planData));
  }
  fields.push(`updated_at = NOW()`);

  if (fields.length === 1) return getPlanById(planId, userId);

  values.push(planId, userId);
  const { rows } = await pool.query(
    `UPDATE plans SET ${fields.join(', ')}
     FROM folders f
     WHERE plans.id = $${idx++} AND plans.folder_id = f.id AND f.user_id = $${idx++}
     RETURNING plans.id, plans.folder_id, plans.name, plans.created_at, plans.updated_at`,
    values,
  );
  return rows[0] || null;
}

async function deletePlan(planId, userId) {
  const { rowCount } = await pool.query(
    `DELETE FROM plans USING folders f
     WHERE plans.id = $1 AND plans.folder_id = f.id AND f.user_id = $2`,
    [planId, userId],
  );
  return rowCount > 0;
}

async function duplicatePlan(planId, userId, targetFolderId, newName) {
  const source = await getPlanById(planId, userId);
  if (!source) throw Object.assign(new Error('Plan not found.'), { status: 404 });

  const { rows: folderRows } = await pool.query(
    `SELECT id FROM folders WHERE id = $1 AND user_id = $2`,
    [targetFolderId, userId],
  );
  if (!folderRows.length) throw Object.assign(new Error('Target folder not found.'), { status: 404 });

  const { rows } = await pool.query(
    `INSERT INTO plans (folder_id, name, plan_data)
     VALUES ($1, $2, $3)
     RETURNING id, folder_id, name, created_at, updated_at`,
    [targetFolderId, (newName || source.name).trim(), JSON.stringify(source.plan_data)],
  );
  return rows[0];
}

module.exports = {
  createPlan,
  getPlansByFolder,
  getPlanById,
  updatePlan,
  deletePlan,
  duplicatePlan,
};
