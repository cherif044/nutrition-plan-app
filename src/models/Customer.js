const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Customer = sequelize.define('Customer', {
  id:             { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
  user_id:        { type: DataTypes.BIGINT, allowNull: false },
  name:           { type: DataTypes.STRING(200), allowNull: false },
  age:            { type: DataTypes.INTEGER, allowNull: true },
  sex:            { type: DataTypes.STRING(20), allowNull: true },
  weight:         { type: DataTypes.DECIMAL, allowNull: true },
  height:         { type: DataTypes.DECIMAL, allowNull: true },
  activity_level: { type: DataTypes.STRING(50), allowNull: true },
  goal:           { type: DataTypes.STRING(50), allowNull: true },
  created_at:     { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  updated_at:     { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
  tableName: 'customers',
  timestamps: false,
});

module.exports = Customer;
