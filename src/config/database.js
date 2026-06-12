const { Sequelize } = require('sequelize');

const sequelize = new Sequelize({
  dialect: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'nutrition_plan',
  username: process.env.DB_USER || 'cherif',
  password: process.env.DB_PASSWORD,
  pool: { max: 10, idle: 30000 },
  logging: false,
});

module.exports = sequelize;
