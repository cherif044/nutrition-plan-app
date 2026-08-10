const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Plan = sequelize.define('Plan', {
  id:         { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
  user_id:    { type: DataTypes.BIGINT, allowNull: false },
  folder_id:  { type: DataTypes.BIGINT, allowNull: true },
  customer_id: { type: DataTypes.BIGINT, allowNull: true },
  name:       { type: DataTypes.STRING, allowNull: false },
  plan_data:  { type: DataTypes.JSONB, allowNull: false },
  is_active:  { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  last_opened_at: { type: DataTypes.DATE, allowNull: true },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  tableName: 'plans',
  timestamps: false,
});

module.exports = Plan;
