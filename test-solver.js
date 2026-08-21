// Sanity check for the current deterministic ready-meal generation path.
// Run with: node test-solver.js
const { generatePlan } = require('./src/services/planGenerator');

let pass = 0;
let fail = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  PASS  ${msg}`);
    pass += 1;
  } else {
    console.error(`  FAIL  ${msg}`);
    fail += 1;
  }
}

const input = {
  weightKg: 78,
  heightCm: 178,
  age: 29,
  sex: 'male',
  bodyFatPercentage: '',
  activityLevel: 'moderate',
  goal: 'lose_weight',
  dietType: 'standard',
  numberOfMeals: 4,
  mealDistribution: 'balanced',
  allergies: [],
  dislikes: [],
  avoidFoods: [],
};

console.log('\nPlan generation smoke test');
const plan = generatePlan(input);

assert(plan.status !== 'error', 'plan generation does not return an impossible-plan error');
assert(Array.isArray(plan.meals) && plan.meals.length === 4, 'four meal slots are generated');

for (const meal of plan.meals || []) {
  assert(Array.isArray(meal.items) && meal.items.length > 0, `${meal.name} has food items`);
  assert(meal.target?.macroWindows, `${meal.name} has backend-provided macro windows`);
  assert(
    meal.totals.calories >= meal.target.macroWindows.calories.min &&
      meal.totals.calories <= meal.target.macroWindows.calories.max,
    `${meal.name} calories fit the meal window`,
  );
  assert(
    meal.totals.proteinG >= meal.target.macroWindows.proteinG.min &&
      meal.totals.proteinG <= meal.target.macroWindows.proteinG.max,
    `${meal.name} protein fits the meal window`,
  );
  assert(
    meal.totals.fatG >= meal.target.macroWindows.fatG.min &&
      meal.totals.fatG <= meal.target.macroWindows.fatG.max,
    `${meal.name} fat fits the meal window`,
  );
}

console.log(`\n${'-'.repeat(50)}`);
console.log(`Results: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
