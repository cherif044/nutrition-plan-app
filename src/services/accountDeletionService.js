const { Op } = require('sequelize');
const sequelize = require('../config/database');
const { User } = require('../models');
const { revokeAllSessionsForUser } = require('../features/auth/sessionRepository');
const { firebaseCall } = require('../utils/firebaseCall');
const { logger } = require('../utils/logger');

// Deleting an account touches two systems that cannot share a transaction,
// so the steps are ordered to fail safe:
//   1. revoke every session and mark the user (deletion_pending_at), which
//      blocks all access from here on;
//   2. delete the Firebase account;
//   3. delete the user's rows in one database transaction.
// If step 2 or 3 fails, the marked row stays blocked and
// finishPendingDeletions() completes it later.

const RETRY_AFTER_MS = 10 * 60 * 1000;

async function deleteFirebaseUser(firebaseUid) {
  if (!firebaseUid) return;
  const { getFirebaseAdmin } = require('../config/firebaseAdmin');
  await firebaseCall('delete_user', () => (
    getFirebaseAdmin().auth().deleteUser(firebaseUid).catch((err) => {
      if (err.code !== 'auth/user-not-found') throw err;
    })
  ));
}

// Children are deleted explicitly instead of relying on ON DELETE CASCADE,
// because the early migrations that created these tables are not in the
// repository and their foreign-key actions cannot be assumed.
async function deleteUserRows(userId) {
  await sequelize.transaction(async (transaction) => {
    const q = (sql) => sequelize.query(sql, { replacements: { userId }, transaction });
    await q('DELETE FROM plans WHERE user_id = :userId');
    await q('DELETE FROM customers WHERE user_id = :userId');
    await q('UPDATE folders SET parent_id = NULL WHERE user_id = :userId');
    await q('DELETE FROM folders WHERE user_id = :userId');
    await q('DELETE FROM sessions WHERE user_id = :userId');
    await q('DELETE FROM users WHERE id = :userId');
  });
}

async function deleteAccount(userId, firebaseUid, { requestId } = {}) {
  await sequelize.transaction(async (transaction) => {
    await revokeAllSessionsForUser(userId, { transaction });
    await User.update(
      { deletion_pending_at: new Date(), token_version: sequelize.literal('token_version + 1') },
      { where: { id: userId }, transaction },
    );
  });
  logger.info('Account deletion started', { requestId, userId });

  await deleteFirebaseUser(firebaseUid);
  await deleteUserRows(userId);
  logger.info('Account deleted', { requestId, userId });
}

// Completes deletions that stopped part-way (e.g. Firebase was unreachable).
async function finishPendingDeletions({ limit = 20 } = {}) {
  const pending = await User.findAll({
    where: { deletion_pending_at: { [Op.lt]: new Date(Date.now() - RETRY_AFTER_MS) } },
    attributes: ['id', 'firebase_uid'],
    limit,
  });
  let finished = 0;
  for (const user of pending) {
    try {
      await deleteFirebaseUser(user.firebase_uid);
      await deleteUserRows(user.id);
      finished += 1;
    } catch (error) {
      logger.error('Pending account deletion failed', { userId: user.id, error });
    }
  }
  if (pending.length) logger.info('Pending account deletions processed', { pending: pending.length, finished });
  return { pending: pending.length, finished };
}

module.exports = { deleteAccount, finishPendingDeletions };
