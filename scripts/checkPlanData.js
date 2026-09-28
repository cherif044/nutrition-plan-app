#!/usr/bin/env node
/**
 * Checks every saved plan against the stored-plan schema (security
 * remediation P1.3) before the stricter validation ships.
 *
 * Usage:
 *   node scripts/checkPlanData.js            # report only (read-only)
 *   node scripts/checkPlanData.js --repair   # also rewrite repairable rows
 *
 * Report mode lists every plan that the new schema would reject, with the
 * first problem found. Nothing is written.
 *
 * Repair mode rewrites plan_data only for plans that pass once normalised:
 * catalog foods are replaced by the server's catalog entry and unknown fields
 * on custom foods and the planner input are dropped. updated_at and version
 * are left unchanged, so open planner tabs do not see a conflict. Plans that
 * still fail are only reported and must be fixed by hand.
 */
require('dotenv').config();
const { isDeepStrictEqual } = require('util');
const { Op } = require('sequelize');
const sequelize = require('../src/config/database');
const { Plan } = require('../src/models');
const { planData: planDataSchema } = require('../src/validation/schemas');

const BATCH_SIZE = 100;
const repair = process.argv.includes('--repair');

function describeIssue(error) {
  const issue = error.issues[0];
  return issue ? `${issue.path.join('.') || '(root)'}: ${issue.message}` : 'invalid';
}

async function main() {
  let lastId = 0;
  const totals = { checked: 0, valid: 0, invalid: 0, repaired: 0 };

  for (;;) {
    const plans = await Plan.findAll({
      where: { id: { [Op.gt]: lastId } },
      attributes: ['id', 'user_id', 'plan_data'],
      order: [['id', 'ASC']],
      limit: BATCH_SIZE,
    });
    if (!plans.length) break;

    for (const plan of plans) {
      lastId = plan.id;
      totals.checked += 1;
      const result = planDataSchema.safeParse(plan.plan_data);
      if (!result.success) {
        totals.invalid += 1;
        console.log(`INVALID plan ${plan.id} (user ${plan.user_id}): ${describeIssue(result.error)}`);
        continue;
      }
      totals.valid += 1;
      if (repair && !isDeepStrictEqual(result.data, plan.plan_data)) {
        await Plan.update({ plan_data: result.data }, { where: { id: plan.id } });
        totals.repaired += 1;
      }
    }
  }

  console.log(JSON.stringify({ mode: repair ? 'repair' : 'report', ...totals }));
  await sequelize.close();
  if (totals.invalid > 0) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
