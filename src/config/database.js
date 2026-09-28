const { Sequelize } = require('sequelize');
const pg = require('pg');
const { attachDatabaseMetrics } = require('../utils/metrics');

const rawDatabaseUrl = process.env.DATABASE_URL;

if (!rawDatabaseUrl) {
  throw new Error('DATABASE_URL is required for the remote PostgreSQL database.');
}

const sslDisabled = process.env.DB_SSL === 'false';
if (sslDisabled && process.env.NODE_ENV === 'production') {
  throw new Error('DB_SSL=false is not allowed in production.');
}

// TLS settings come only from the ssl object below. SSL parameters in the
// connection string are removed so they can never silently weaken it (for
// example sslmode=require without certificate checks, or sslmode=disable).
const URL_SSL_PARAMS = ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat'];

function parseDatabaseUrl(value) {
  const url = new URL(value);
  for (const param of URL_SSL_PARAMS) url.searchParams.delete(param);
  return url;
}

const databaseUrl = parseDatabaseUrl(rawDatabaseUrl);

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const sequelize = new Sequelize(databaseUrl.toString(), {
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
    // DB_SSL=false is only for a local Postgres; every hosted database keeps
    // TLS on with full certificate and hostname checks. Neon's certificates
    // are publicly trusted, so Node's built-in CA store verifies them.
    ssl: sslDisabled ? false : {
      rejectUnauthorized: true,
      servername: databaseUrl.hostname,
    },
  },
});

attachDatabaseMetrics(sequelize);

module.exports = sequelize;
