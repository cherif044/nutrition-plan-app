const { pool } = require('../config/db');

async function insertUser({ username, passwordHash, firstname, lastname }) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (username, password_hash, firstname, lastname)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, firstname, lastname, created_at`,
      [username, passwordHash, firstname, lastname],
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw new Error('Username is already taken.');
    throw err;
  }
}

async function findUserByUsername(username) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE username = $1',
    [String(username).trim()],
  );
  return rows[0] || null;
}

async function findUserById(id) {
  const { rows } = await pool.query(
    'SELECT id, username, firstname, lastname, token_version, created_at, last_login FROM users WHERE id = $1',
    [id],
  );
  return rows[0] || null;
}

async function updateLastLogin(id) {
  await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [id]);
}

async function incrementTokenVersion(id) {
  const { rows } = await pool.query(
    'UPDATE users SET token_version = token_version + 1 WHERE id = $1 RETURNING token_version',
    [id],
  );
  return rows[0]?.token_version;
}

module.exports = {
  insertUser,
  findUserByUsername,
  findUserById,
  updateLastLogin,
  incrementTokenVersion,
};
