const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Foods a coach adds by hand for manual-mode plans (migrations/013).
const CustomFood = sequelize.define('CustomFood', {
  id:                 { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
  user_id:            { type: DataTypes.BIGINT, allowNull: false },
  name:               { type: DataTypes.STRING(60), allowNull: false },
  protein_g_per_100g: { type: DataTypes.DECIMAL(4, 1), allowNull: false },
  carb_g_per_100g:    { type: DataTypes.DECIMAL(4, 1), allowNull: false },
  fat_g_per_100g:     { type: DataTypes.DECIMAL(4, 1), allowNull: false },
  created_at:         { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
  tableName: 'custom_foods',
  timestamps: false,
});

module.exports = CustomFood;
