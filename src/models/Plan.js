const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Plan = sequelize.define('Plan', {
  id:         { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
  folder_id:  { type: DataTypes.BIGINT, allowNull: false },
  name:       { type: DataTypes.STRING, allowNull: false },
  plan_data:  { type: DataTypes.JSONB, allowNull: false },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  tableName: 'plans',
  timestamps: false,
});

module.exports = Plan;
