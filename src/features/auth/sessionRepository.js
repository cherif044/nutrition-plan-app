const { Op } = require('sequelize');
const { Session } = require('../../models');
const { SESSION_ABSOLUTE_MS } = require('../../config/session');

// Expired and revoked rows are deleted opportunistically instead of by a
// scheduled job, which serverless deployments do not have.
const CLEANUP_PROBABILITY = 0.01;
const RETAIN_REVOKED_MS = 7 * 24 * 60 * 60 * 1000;

async function createSessionRecord(userId, { userAgent = null, ipHash = null, transaction } = {}) {
  const now = new Date();
  const session = await Session.create({
    user_id: userId,
    created_at: now,
    last_seen_at: now,
    firebase_checked_at: now,
    expires_at: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
    user_agent: userAgent ? String(userAgent).slice(0, 200) : null,
    ip_hash: ipHash,
  }, { transaction });
  if (Math.random() < CLEANUP_PROBABILITY) deleteStaleSessions();
  return session;
}

async function findSessionById(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
  return Session.findByPk(id);
}

// Fire-and-forget: a failed timestamp write must never fail the request.
function touchSession(id, now = new Date()) {
  Session.update({ last_seen_at: now }, { where: { id, revoked_at: null } }).catch(() => {});
}

async function markFirebaseChecked(id, now = new Date()) {
  await Session.update({ firebase_checked_at: now }, { where: { id } });
}

async function revokeSession(id, { transaction } = {}) {
  const [count] = await Session.update(
    { revoked_at: new Date() },
    { where: { id, revoked_at: null }, transaction },
  );
  return count > 0;
}

async function revokeAllSessionsForUser(userId, { transaction } = {}) {
  const [count] = await Session.update(
    { revoked_at: new Date() },
    { where: { user_id: userId, revoked_at: null }, transaction },
  );
  return count;
}

function deleteStaleSessions() {
  const cutoff = new Date(Date.now() - RETAIN_REVOKED_MS);
  Session.destroy({
    where: {
      [Op.or]: [
        { expires_at: { [Op.lt]: new Date() } },
        { revoked_at: { [Op.lt]: cutoff } },
      ],
    },
  }).catch(() => {});
}

module.exports = {
  createSessionRecord,
  findSessionById,
  markFirebaseChecked,
  revokeAllSessionsForUser,
  revokeSession,
  touchSession,
};
