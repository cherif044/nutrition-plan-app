const { pool } = require('../config/db');

async function createCustomer(coachId, { username, firstName, lastName }) {
  const { rows } = await pool.query(
    `INSERT INTO customers (coach_id, username, first_name, last_name)
     VALUES ($1, $2, $3, $4)
     RETURNING customer_id, username, first_name, last_name, created_at`,
    [coachId, username.trim(), firstName.trim(), (lastName || '').trim()],
  );
  return rows[0];
}

async function getCustomersByCoach(coachId) {
  const { rows } = await pool.query(
    `SELECT customer_id, username, first_name, last_name, created_at
     FROM customers WHERE coach_id = $1 ORDER BY created_at DESC`,
    [coachId],
  );
  return rows;
}

async function getCustomerById(customerId, coachId) {
  const { rows } = await pool.query(
    `SELECT customer_id, username, first_name, last_name, created_at
     FROM customers WHERE customer_id = $1 AND coach_id = $2`,
    [customerId, coachId],
  );
  return rows[0] || null;
}

async function deleteCustomer(customerId, coachId) {
  const { rowCount } = await pool.query(
    'DELETE FROM customers WHERE customer_id = $1 AND coach_id = $2',
    [customerId, coachId],
  );
  return rowCount > 0;
}

module.exports = { createCustomer, getCustomersByCoach, getCustomerById, deleteCustomer };
