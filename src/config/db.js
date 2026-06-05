const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'nutrition_plan',
  user: process.env.DB_USER || 'cherif',
  password: process.env.DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err.message);
});

async function initDb() {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";

    CREATE TABLE IF NOT EXISTS users (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username    VARCHAR(50) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      firstname   VARCHAR(50) NOT NULL,
      lastname    VARCHAR(50) NOT NULL,
      token_version INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login  TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS customers (
      customer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      coach_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username    VARCHAR(100) NOT NULL,
      first_name  VARCHAR(100) NOT NULL,
      last_name   VARCHAR(100) NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(coach_id, username)
    );

    CREATE TABLE IF NOT EXISTS plans (
      plan_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id UUID NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
      plan_name   VARCHAR(150) NOT NULL,
      plan_data   JSONB NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(customer_id, plan_name)
    );
  `);
  console.log('[db] Schema ready');
}

module.exports = { pool, initDb };
