const { QueryTypes } = require('sequelize');
const sequelize = require('../config/database');
const { logger } = require('../utils/logger');

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function deleteExpiredSessions() {
  const retainRevokedDays = envNumber('SESSION_REVOKED_RETENTION_DAYS', 7);
  const [row] = await sequelize.query(`
    WITH deleted AS (
      DELETE FROM sessions
      WHERE expires_at < now()
         OR revoked_at < now() - make_interval(days => :retainRevokedDays)
      RETURNING 1
    )
    SELECT COUNT(*)::int AS count FROM deleted
  `, {
    replacements: { retainRevokedDays },
    type: QueryTypes.SELECT,
  });
  return Number(row?.count || 0);
}

async function deleteOldRateLimitRows() {
  const retainHours = envNumber('RATE_LIMIT_ROW_RETENTION_HOURS', 24);
  const [row] = await sequelize.query(`
    WITH deleted AS (
      DELETE FROM rate_limits
      WHERE window_start < now() - make_interval(hours => :retainHours)
      RETURNING 1
    )
    SELECT COUNT(*)::int AS count FROM deleted
  `, {
    replacements: { retainHours },
    type: QueryTypes.SELECT,
  });
  return Number(row?.count || 0);
}

async function cleanupOperationalTables() {
  const startedAt = process.hrtime.bigint();
  const result = {
    sessionsDeleted: await deleteExpiredSessions(),
    rateLimitRowsDeleted: await deleteOldRateLimitRows(),
  };
  result.durationMs = Number(Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(1);
  logger.info('Operational cleanup completed', result);
  return result;
}

module.exports = {
  cleanupOperationalTables,
};
