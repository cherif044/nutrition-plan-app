const assert = require('assert/strict');

const { generatePlan } = require('../src/services/planGenerator');
const { loadReadyMealBundles } = require('../src/repositories/readyMealRepository');
const { NUTRITION, macrosForFoodPortion, sumTargets } = require('../src/services/nutritionService');

const cases = [
  named('default standard', {}),
  named('standard weight loss', { goal: 'lose_weight', weeklyWeightLossPercent: 0.5 }),
  named('standard gain', { goal: 'gain_weight', gainSurplusCalories: 300 }, { mayMiss: true }),
  named('four meals standard', { numberOfMeals: 4 }, { mayMiss: true }),
  named('breakfast-heavy', { mealDistribution: 'breakfast_heavy' }, { mayMiss: true }),
  named('lunch-heavy', { mealDistribution: 'lunch_heavy' }, { mayMiss: true }),
  named('dinner-heavy', { mealDistribution: 'dinner_heavy' }, { mayMiss: true }),
  named('vegetarian constrained', { dietType: 'vegetarian' }, { mayMiss: true }),
  named('vegan constrained', { dietType: 'vegan' }, { mayMiss: true }),
  named('avoid dairy constrained', { avoidFoods: ['dairy'] }, { mayMiss: true }),
  named('ramadan constrained', { ramadanMode: true }, { mayMiss: true }),
];

const readyIds = new Set(loadReadyMealBundles().map((meal) => meal.id));
const summary = { total: 0, fullPlans: 0, constrainedPlans: 0 };

for (const testCase of cases) {
  const plan = generatePlan(testCase.input);
  summary.total += 1;

  assert.equal(plan.meals.length, expectedMealCount(testCase.input), `${testCase.name}: meal count`);
  for (const meal of plan.meals) {
    if (meal.items.length === 0) {
      assert(testCase.expect.mayMiss, `${testCase.name}: unexpected missing ready meal for ${meal.name}`);
      assert.match(meal.unavailableReason || '', /No ready meal matched/, `${testCase.name}: missing meal reason`);
      continue;
    }

    assert(readyIds.has(meal.readyMealId), `${testCase.name}: ${meal.name} should use ready meal id`);
    assert.equal(meal.candidateSource, 'ready_meal_database', `${testCase.name}: source`);
    assert.equal(meal.numberOfSwaps, 0, `${testCase.name}: no swaps`);
    assertWithinTolerance(meal.items, meal.target, `${testCase.name}: ${meal.name}`);
    meal.mealOptions.forEach((option) => {
      assert(readyIds.has(option.readyMealId), `${testCase.name}: alternate should use ready meal id`);
      assertWithinTolerance(option.items, meal.target, `${testCase.name}: ${meal.name} alternate ${option.readyMealId}`);
    });
  }

  if (plan.meals.every((meal) => meal.items.length > 0)) {
    assert.equal(plan.status, undefined, `${testCase.name}: complete ready-meal plan should not be error`);
    summary.fullPlans += 1;
  } else {
    assert.equal(plan.status, 'error', `${testCase.name}: missing ready meals should produce explicit error status`);
    summary.constrainedPlans += 1;
  }
}

console.log(`ready-meal optimizer matrix passed: ${summary.fullPlans}/${summary.total} complete, ${summary.constrainedPlans} explicitly constrained`);

function named(name, overrides, expect = {}) {
  return {
    name,
    input: {
      weightKg: 80,
      heightCm: 175,
      age: 30,
      sex: 'male',
      bodyFatPercentage: 20,
      activityLevel: 'light',
      goal: 'maintain',
      weeklyWeightLossPercent: 0.75,
      gainSurplusCalories: 250,
      proteinPerKg: 2,
      fatPerKg: 0.7,
      numberOfMeals: 3,
      mealDistribution: 'balanced',
      dietType: 'standard',
      avoidFoods: [],
      ...overrides,
    },
    expect,
  };
}

function expectedMealCount(input) {
  return input.ramadanMode ? 3 : Number(input.numberOfMeals);
}

function assertWithinTolerance(items, target, label) {
  const totals = sumTargets(items.map((item) => macrosForFoodPortion(item.food, item.quantityG)));
  if (target.macroWindows) {
    assert(totals.calories >= target.macroWindows.calories.min - 0.01, `${label} calories min`);
    assert(totals.calories <= target.macroWindows.calories.max + 0.01, `${label} calories max`);
    assert(totals.proteinG >= target.macroWindows.proteinG.min - 0.01, `${label} protein min`);
    assert(totals.proteinG <= target.macroWindows.proteinG.max + 0.01, `${label} protein max`);
    assert(totals.fatG >= target.macroWindows.fatG.min - 0.01, `${label} fat min`);
    assert(totals.fatG <= target.macroWindows.fatG.max + 0.01, `${label} fat max`);
    const carbWindow = {
      min: (target.macroWindows.calories.min - totals.proteinG * 4 - totals.fatG * 9) / 4,
      max: (target.macroWindows.calories.max - totals.proteinG * 4 - totals.fatG * 9) / 4,
    };
    assert(totals.carbG >= carbWindow.min - 0.01, `${label} carbs min`);
    assert(totals.carbG <= carbWindow.max + 0.01, `${label} carbs max`);
    return;
  }
  assert(
    Math.abs(totals.calories - target.calories) <= target.calories * NUTRITION.calorieTolerancePercent + 0.01,
    `${label} calories`,
  );
  assert(Math.abs(totals.proteinG - target.proteinG) <= target.proteinG * NUTRITION.mealMacroTolerancePercent + 0.01, `${label} protein`);
  assert(Math.abs(totals.carbG - target.carbG) <= target.carbG * NUTRITION.mealMacroTolerancePercent + 0.01, `${label} carbs`);
  assert(Math.abs(totals.fatG - target.fatG) <= target.fatG * NUTRITION.mealMacroTolerancePercent + 0.01, `${label} fat`);
}
