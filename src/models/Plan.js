const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Plan = sequelize.define('Plan', {
  id:         { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
  user_id:    { type: DataTypes.BIGINT, allowNull: false },
  customer_id: { type: DataTypes.BIGINT, allowNull: true },
  name:       { type: DataTypes.STRING, allowNull: false },
  plan_data:  { type: DataTypes.JSONB, allowNull: false },
  is_active:  { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  last_opened_at: { type: DataTypes.DATE, allowNull: true },
  version:    { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  client_request_id: { type: DataTypes.TEXT, allowNull: true },
  goal:       { type: DataTypes.TEXT, allowNull: true },
  calories:   { type: DataTypes.DECIMAL, allowNull: true },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  tableName: 'plans',
  timestamps: false,
});

module.exports = Plan;
