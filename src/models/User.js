const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
  id:            { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
  username:      { type: DataTypes.STRING(30), unique: true, allowNull: false },
  password_hash: { type: DataTypes.STRING, allowNull: false },
  firstname:     { type: DataTypes.STRING(50), allowNull: false },
  lastname:      { type: DataTypes.STRING(50), allowNull: false },
  token_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  created_at:    { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  last_login:    { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'users',
  timestamps: false,
});

module.exports = User;
