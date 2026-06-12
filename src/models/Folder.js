const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Folder = sequelize.define('Folder', {
  id:        { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
  user_id:   { type: DataTypes.BIGINT, allowNull: false },
  parent_id: { type: DataTypes.BIGINT, allowNull: true },
  name:      { type: DataTypes.STRING, allowNull: false },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  tableName: 'folders',
  timestamps: false,
});

module.exports = Folder;
