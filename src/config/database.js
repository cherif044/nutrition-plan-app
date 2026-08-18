const { Sequelize } = require('sequelize');
const pg = require('pg');

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
    min: envNumber('DB_POOL_MIN', 0),
    acquire: envNumber('DB_POOL_ACQUIRE_MS', 30000),
    idle: envNumber('DB_POOL_IDLE_MS', 10000),
  },
  logging: false,
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false,
    },
  },
});

module.exports = sequelize;
