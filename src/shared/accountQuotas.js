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

module.exports = {
  assertCanAddCustomer,
  assertCanAddPlan,
};
