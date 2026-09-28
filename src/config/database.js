const { Sequelize } = require('sequelize');
const pg = require('pg');
const { attachDatabaseMetrics } = require('../utils/metrics');

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for the remote PostgreSQL database.');
}

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const sequelize = new Sequelize(databaseUrl, {
  dialect: 'postgres',
  dialectModule: pg,
  pool: {
    max: envNumber('DB_POOL_MAX', 5),
    min: envNumber('DB_POOL_MIN', 1),
    acquire: envNumber('DB_POOL_ACQUIRE_MS', 30000),
    idle: envNumber('DB_POOL_IDLE_MS', 600000),
  },
  logging: false,
  dialectOptions: {
    // Fail fast instead of hanging when the database cannot be reached.
    // Query, lock, and idle-transaction limits are set on the database role
    // (migrations/007) so they also apply through Neon's pooler.
    connectionTimeoutMillis: envNumber('DB_CONNECT_TIMEOUT_MS', 10000),
    // DB_SSL=false is only for a local Postgres; every hosted database
    // (Neon included) keeps SSL on, which is the default.
    ssl: process.env.DB_SSL === 'false' ? false : {
      require: true,
      rejectUnauthorized: false,
    },
  },
});

attachDatabaseMetrics(sequelize);

module.exports = sequelize;
