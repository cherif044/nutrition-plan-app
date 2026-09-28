const { QueryTypes } = require('sequelize');
const sequelize = require('../config/database');
const { INPUT_LIMITS } = require('../config/inputLimits');

const Q = INPUT_LIMITS.account;

function quotaError(message) {
  return Object.assign(new Error(message), { status: 409, code: 'account-quota-exceeded' });
}

async function scalar(sql, replacements, transaction) {
  const [row] = await sequelize.query(sql, { replacements, transaction, type: QueryTypes.SELECT });
  return Number(Object.values(row || {})[0] || 0);
}

// Serializes quota checks per account for the rest of the transaction, so two
// simultaneous inserts cannot both pass a check that only one of them fits.
async function lockAccount(userId, transaction) {
  await sequelize.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('account-quota:' || :userId, 0))",
    { replacements: { userId: String(userId) }, transaction },
  );
}

async function assertCanAddPlan(userId, planData, transaction) {
  await lockAccount(userId, transaction);
  const count = await scalar('SELECT count(*) FROM plans WHERE user_id = :userId', { userId }, transaction);
  if (count >= Q.plans) throw quotaError(`An account can hold at most ${Q.plans} plans. Delete some plans first.`);

  const addedBytes = Buffer.byteLength(JSON.stringify(planData ?? null), 'utf8');
  // pg_column_size reads the stored (compressed) size without detoasting.
  const usedBytes = await scalar(
    'SELECT COALESCE(sum(pg_column_size(plan_data)), 0) FROM plans WHERE user_id = :userId',
    { userId },
    transaction,
  );
  if (usedBytes + addedBytes > Q.planDataBytes) {
    throw quotaError('This account has reached its storage limit. Delete some plans first.');
  }
}

async function assertCanAddCustomer(userId, transaction) {
  await lockAccount(userId, transaction);
  const count = await scalar('SELECT count(*) FROM customers WHERE user_id = :userId', { userId }, transaction);
  if (count >= Q.customers) throw quotaError(`An account can hold at most ${Q.customers} customers.`);
}

// Depth of a folder counted from the root (a root folder has depth 1).
async function folderDepth(folderId, userId, transaction) {
  return scalar(`
    WITH RECURSIVE chain AS (
      SELECT id, parent_id, 1 AS depth FROM folders WHERE id = :folderId AND user_id = :userId
      UNION ALL
      SELECT f.id, f.parent_id, c.depth + 1
      FROM folders f JOIN chain c ON f.id = c.parent_id
      WHERE f.user_id = :userId AND c.depth <= :maxDepth
    )
    SELECT max(depth) FROM chain
  `, { folderId, userId, maxDepth: Q.folderDepth + 1 }, transaction);
}

async function assertCanAddFolder(userId, parentId, transaction) {
  await lockAccount(userId, transaction);
  const count = await scalar('SELECT count(*) FROM folders WHERE user_id = :userId', { userId }, transaction);
  if (count >= Q.folders) throw quotaError(`An account can hold at most ${Q.folders} folders.`);
  if (parentId !== null && parentId !== undefined) {
    const depth = await folderDepth(parentId, userId, transaction);
    if (depth + 1 > Q.folderDepth) {
      throw quotaError(`Folders can be nested at most ${Q.folderDepth} levels deep.`);
    }
  }
}

module.exports = {
  assertCanAddCustomer,
  assertCanAddFolder,
  assertCanAddPlan,
};
