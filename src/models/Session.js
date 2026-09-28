const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Session = sequelize.define('Session', {
  id:                  { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  user_id:             { type: DataTypes.BIGINT, allowNull: false },
  created_at:          { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  last_seen_at:        { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  expires_at:          { type: DataTypes.DATE, allowNull: false },
  revoked_at:          { type: DataTypes.DATE, allowNull: true },
  firebase_checked_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  user_agent:          { type: DataTypes.STRING(200), allowNull: true },
  ip_hash:             { type: DataTypes.TEXT, allowNull: true },
}, {
  tableName: 'sessions',
  timestamps: false,
});

module.exports = Session;
