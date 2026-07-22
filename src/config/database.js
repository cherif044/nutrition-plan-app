const { Sequelize } = require('sequelize');

const databaseUrl = process.env.DATABASE_URL;
const dbSsl = process.env.DB_SSL;

function isLocalDatabaseUrl(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch (_err) {
    return false;
  }
}

function shouldUseSsl() {
  if (dbSsl) {
    return ['1', 'true', 'yes', 'require'].includes(dbSsl.toLowerCase());
  }

  return Boolean(databaseUrl && !isLocalDatabaseUrl(databaseUrl));
}

const commonOptions = {
  dialect: 'postgres',
  pool: { max: 10, idle: 30000 },
  logging: false,
};

if (shouldUseSsl()) {
  commonOptions.dialectOptions = {
    ssl: {
      require: true,
      rejectUnauthorized: false,
    },
  };
}

const sequelize = databaseUrl ? new Sequelize(databaseUrl, commonOptions) : new Sequelize({
  ...commonOptions,
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'nutrition_plan',
  username: process.env.DB_USER || 'cherif',
  password: process.env.DB_PASSWORD,
});

module.exports = sequelize;
