const { pool } = require('../config/db');

async function createPlan(customerId, planName, planData) {
  const { rows } = await pool.query(
    `INSERT INTO plans (customer_id, plan_name, plan_data)
     VALUES ($1, $2, $3)
     RETURNING plan_id, plan_name, created_at`,
    [customerId, planName.trim(), JSON.stringify(planData)],
  );
  return rows[0];
}

async function getPlansByCustomer(customerId) {
  const { rows } = await pool.query(
    `SELECT plan_id, plan_name, created_at
     FROM plans WHERE customer_id = $1 ORDER BY created_at DESC`,
    [customerId],
  );
  return rows;
}

async function getPlanById(planId, customerId) {
  const { rows } = await pool.query(
    `SELECT plan_id, plan_name, plan_data, created_at
     FROM plans WHERE plan_id = $1 AND customer_id = $2`,
    [planId, customerId],
  );
  return rows[0] || null;
}

async function deletePlan(planId, customerId) {
  const { rowCount } = await pool.query(
    'DELETE FROM plans WHERE plan_id = $1 AND customer_id = $2',
    [planId, customerId],
  );
  return rowCount > 0;
}

module.exports = { createPlan, getPlansByCustomer, getPlanById, deletePlan };
