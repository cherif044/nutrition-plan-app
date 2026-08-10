const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const sequelize = require('../src/config/database');
const { User, Customer, Plan, Folder } = require('../src/models');
const {
  findCustomerByNormalizedName,
  resolveCustomerForPlan,
} = require('../src/repositories/customerRepository');
const {
  createPlan,
  getPlanById,
  updatePlan,
  setPlanActive,
} = require('../src/repositories/planRepository');
const { getDashboardSummary } = require('../src/repositories/dashboardRepository');

const migrationSql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '003_customers.sql'), 'utf8');
const openedMigrationSql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '004_plan_last_opened.sql'), 'utf8');
const plannerHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'planner.html'), 'utf8');
const plannerJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
const dashboardHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');
const dashboardJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'dashboard.js'), 'utf8');
const customerJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'customer.js'), 'utf8');

function planData(input = {}) {
  return {
    input: {
      age: 30,
      sex: 'female',
      weightKg: 62,
      heightCm: 170,
      activityLevel: 'moderate',
      goal: 'maintain',
      ...input,
    },
    dailyTargets: { calories: 2000, proteinG: 120, carbG: 220, fatG: 65 },
    meals: [],
  };
}

function num(value) {
  return value === null || value === undefined ? null : Number(value);
}

(async () => {
  assert(plannerHtml.includes('name="planName"'), 'planner asks for plan name before generation');
  assert(plannerHtml.includes('id="pre-generation-customer-picker"'), 'planner asks for customer before generation');
  assert(plannerHtml.includes('name="makeActive"'), 'planner asks for active-plan choice before generation');
  assert(plannerJs.includes('validatePreGenerationSaveDetails'), 'generation validates save details before calling planner API');
  assert(dashboardHtml.includes('Total plans'), 'dashboard shows total plans stat');
  assert(dashboardHtml.includes('Total customers'), 'dashboard shows total customers stat');
  assert(dashboardHtml.includes('Current active plans'), 'dashboard shows active plans stat');
  assert(!dashboardHtml.includes('class="dashboard-stat-card" href'), 'dashboard stat cards are not clickable links');
  assert(dashboardHtml.includes('id="customer-search"'), 'dashboard customers list is searchable');
  assert(dashboardHtml.includes('General plans'), 'dashboard exposes general plans section');
  assert(dashboardHtml.includes('id="general-plan-search"'), 'dashboard general plans list is searchable');
  assert(!dashboardHtml.includes('Updated today'), 'dashboard first row does not include updated-today stat');
  assert(!dashboardHtml.includes('<span>Folders</span>'), 'dashboard first row does not include folders stat');
  assert(dashboardHtml.includes('class="dashboard-action-tile" href="/planner"'), 'new-plan action card is clickable');
  assert(!dashboardHtml.includes('Browse folders'), 'dashboard does not expose browse-folders action');
  assert(!dashboardHtml.includes('href="/explorer"'), 'dashboard does not expose explorer links');
  assert(dashboardJs.includes('loadCustomerPlans(customer'), 'customer rows load their plans on click');
  assert(dashboardJs.includes('requestId !== customerPlanRequestId'), 'stale customer plan requests cannot duplicate rows');
  assert(dashboardJs.includes('dashboard-customer-plan-row'), 'customer plans render under selected customer');
  assert(dashboardJs.includes('loadGeneralPlans'), 'dashboard loads general plans on the frontend');
  assert(dashboardJs.includes("fetch('/api/folders')"), 'general plans use existing folder API');
  assert(dashboardJs.includes('card.href = planHref(plan)'), 'general plan cards link to the planner');
  assert(!dashboardJs.includes('Explorer</span>'), 'dashboard nav does not expose Explorer');
  assert(plannerJs.includes('applyCustomerProfileToForm'), 'selecting an existing customer hydrates the generation form');
  assert(!plannerJs.includes("setFormValue('goal', customer.goal)"), 'customer selection leaves plan setup goal unchanged');
  assert(plannerJs.includes('initializeCustomerPickerFromPlan'), 'edit mode loads the current customer into the picker');
  assert(plannerJs.includes('customer: customerPayload?.customer || null'), 'edit save sends customer changes');
  assert(customerJs.includes('class="customer-plan-action" href="${planHref(plan)}"'), 'customer plan edit action is a link');
  assert(customerJs.includes('data-action="duplicate"'), 'customer plan duplicate action exists');
  assert(customerJs.includes('data-action="delete"'), 'customer plan delete action exists');

  await sequelize.query(migrationSql);
  await sequelize.query(openedMigrationSql);

  const suffix = Math.random().toString(36).slice(2, 10);
  const user = await User.create({
    username: `cust_${suffix}`,
    password_hash: 'test',
    firstname: 'Customer',
    lastname: 'Test',
  });

  try {
    const sara = await resolveCustomerForPlan(user.id, { name: ' Sara ' }, planData().input);
    const saraAgain = await resolveCustomerForPlan(user.id, { name: 'sara' }, planData({ weightKg: 70 }).input);
    assert.equal(String(saraAgain.customer.id), String(sara.customer.id), 'case/trim duplicate resolves to existing customer');

    const found = await findCustomerByNormalizedName(user.id, '  SARA  ');
    assert.equal(String(found.id), String(sara.customer.id), 'normalized lookup ignores case and outer whitespace');

    await assert.rejects(
      Customer.create({
        user_id: user.id,
        name: '  SARA  ',
        age: 20,
      }),
      /unique|duplicate/i,
      'database unique index rejects normalized duplicate names',
    );

    const activeOne = await createPlan(user.id, null, 'Active one', planData(), {
      customer: { id: sara.customer.id },
      isActive: true,
    });
    const activeTwo = await createPlan(user.id, null, 'Active two', planData(), {
      customer: { id: sara.customer.id },
      isActive: true,
    });
    const activeOneReloaded = await Plan.findByPk(activeOne.id);
    const activeTwoReloaded = await Plan.findByPk(activeTwo.id);
    assert.equal(activeOneReloaded.is_active, false, 'new active plan unsets previous active plan');
    assert.equal(activeTwoReloaded.is_active, true, 'new active plan becomes active');

    const raceA = await createPlan(user.id, null, 'Race A', planData(), { customer: { id: sara.customer.id } });
    const raceB = await createPlan(user.id, null, 'Race B', planData(), { customer: { id: sara.customer.id } });
    const raceResults = await Promise.allSettled([
      setPlanActive(raceA.id, user.id),
      setPlanActive(raceB.id, user.id),
    ]);
    assert(raceResults.every((result) => result.status === 'fulfilled'), 'concurrent active updates both complete');
    const activeCount = await Plan.count({ where: { user_id: user.id, customer_id: sara.customer.id, is_active: true } });
    assert.equal(activeCount, 1, 'concurrent active updates still leave one active plan');

    const profileCustomer = (await resolveCustomerForPlan(user.id, { name: 'Profile Test' }, planData({
      age: 44,
      sex: 'female',
      weightKg: 62,
      heightCm: 171,
      activityLevel: 'light',
      goal: 'maintain',
    }).input)).customer;

    await createPlan(user.id, null, 'Untouched profile save', planData({
      age: 20,
      sex: 'male',
      weightKg: 80,
      heightCm: 190,
      activityLevel: 'athlete',
      goal: 'gain_weight',
    }), { customer: { id: profileCustomer.id, touchedFields: [] } });
    let profile = await Customer.findByPk(profileCustomer.id);
    assert.equal(profile.age, 44, 'untouched save leaves age unchanged');
    assert.equal(num(profile.weight), 62, 'untouched save leaves weight unchanged');
    assert.equal(profile.activity_level, 'light', 'untouched save leaves activity unchanged');

    await createPlan(user.id, null, 'Touched weight save', planData({ weightKg: 60, goal: 'gain_weight' }), {
      customer: { id: profileCustomer.id, touchedFields: ['weightKg'] },
    });
    profile = await Customer.findByPk(profileCustomer.id);
    assert.equal(num(profile.weight), 60, 'touched weight syncs');
    assert.equal(profile.goal, 'maintain', 'untouched goal does not sync');

    await createPlan(user.id, null, 'Touched all save', planData({
      age: 35,
      sex: 'male',
      weightKg: 75,
      heightCm: 181,
      activityLevel: 'athlete',
      goal: 'gain_weight',
    }), {
      customer: { id: profileCustomer.id, touchedFields: ['age', 'sex', 'weightKg', 'heightCm', 'activityLevel', 'goal'] },
    });
    profile = await Customer.findByPk(profileCustomer.id);
    assert.equal(profile.age, 35, 'touched age syncs');
    assert.equal(profile.sex, 'male', 'touched sex syncs');
    assert.equal(num(profile.weight), 75, 'touched weight syncs in all-fields save');
    assert.equal(num(profile.height), 181, 'touched height syncs');
    assert.equal(profile.activity_level, 'athlete', 'touched activity syncs');
    assert.equal(profile.goal, 'gain_weight', 'touched goal syncs');

    const folder = await Folder.create({ user_id: user.id, name: 'Folder Link Test' });
    const both = await createPlan(user.id, folder.id, 'Folder and customer', planData(), {
      customer: { id: profileCustomer.id },
    });
    let bothReloaded = await Plan.findByPk(both.id);
    assert.equal(String(bothReloaded.folder_id), String(folder.id), 'plan can have a folder');
    assert.equal(String(bothReloaded.customer_id), String(profileCustomer.id), 'plan can also have a customer');

    await updatePlan(both.id, user.id, { customer: null });
    bothReloaded = await Plan.findByPk(both.id);
    assert.equal(String(bothReloaded.folder_id), String(folder.id), 'removing customer leaves folder link intact');
    assert.equal(bothReloaded.customer_id, null, 'customer link removed');

    const bothSecond = await createPlan(user.id, folder.id, 'Remove folder only', planData(), {
      customer: { id: profileCustomer.id },
    });
    await updatePlan(bothSecond.id, user.id, { folderId: null });
    const bothSecondReloaded = await Plan.findByPk(bothSecond.id);
    assert.equal(bothSecondReloaded.folder_id, null, 'folder link removed');
    assert.equal(String(bothSecondReloaded.customer_id), String(profileCustomer.id), 'removing folder leaves customer link intact');

    const unsorted = await createPlan(user.id, null, 'General unsorted', planData());
    const unsortedReloaded = await Plan.findByPk(unsorted.id);
    assert.equal(unsortedReloaded.folder_id, null, 'plain save has no folder');
    assert.equal(unsortedReloaded.customer_id, null, 'plain save has no customer');

    await updatePlan(unsorted.id, user.id, { customer: { name: profileCustomer.name } });
    const transferredReloaded = await Plan.findByPk(unsorted.id);
    assert.equal(String(transferredReloaded.customer_id), String(profileCustomer.id), 'editing a customer name transfers the plan to that customer');

    await Plan.update({ last_opened_at: new Date('2026-01-01T10:00:00Z') }, { where: { id: activeOne.id } });
    await Plan.update({ last_opened_at: new Date('2026-01-01T11:00:00Z') }, { where: { id: raceA.id } });
    await Plan.update({ last_opened_at: new Date('2026-01-01T12:00:00Z') }, { where: { id: bothSecond.id } });
    await Plan.update({ last_opened_at: new Date('2026-01-01T13:00:00Z') }, { where: { id: unsorted.id } });

    const dashboard = await getDashboardSummary(user.id);
    assert.equal(dashboard.stats.totalPlans, 10, 'dashboard counts all user plans');
    assert.equal(dashboard.stats.customers, 2, 'dashboard counts all user customers');
    assert.equal(dashboard.stats.activePlans, 1, 'dashboard counts current active plans');
    assert.equal(dashboard.recentPlans.length, 3, 'dashboard returns only the last 3 opened plans');
    assert.deepEqual(
      dashboard.recentPlans.map((plan) => String(plan.id)),
      [unsorted.id, bothSecond.id, raceA.id].map(String),
      'dashboard orders plans by last opened time',
    );
    assert.equal(dashboard.customers.length, 2, 'dashboard returns the coach customer list');

    const openedPlan = await getPlanById(activeTwo.id, user.id, { markOpened: true });
    assert(openedPlan.last_opened_at, 'opening a plan stamps last_opened_at');

    const cascadeCustomer = (await resolveCustomerForPlan(user.id, { name: 'Cascade Test' }, planData().input)).customer;
    await createPlan(user.id, null, 'Cascade A', planData(), { customer: { id: cascadeCustomer.id }, isActive: true });
    await createPlan(user.id, null, 'Cascade B', planData(), { customer: { id: cascadeCustomer.id } });
    await cascadeCustomer.destroy();
    const orphanCount = await Plan.count({ where: { user_id: user.id, customer_id: cascadeCustomer.id } });
    assert.equal(orphanCount, 0, 'deleting customer cascades all linked plans');

    console.log('Customer management tests passed');
  } finally {
    await User.destroy({ where: { id: user.id } });
    await sequelize.close();
  }
})().catch(async (error) => {
  console.error(error);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
