const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const {
  MEAL_DISTRIBUTIONS,
  NUTRITION,
} = require('../src/config/nutritionConstants');
const { loadFoods } = require('../src/repositories/foodRepository');
const { loadReadyMealBundles } = require('../src/repositories/readyMealRepository');
const {
  deriveMealMacroProfiles,
  getDatabaseMealMacroProfiles,
} = require('../src/services/mealMacroProfileService');
const {
  buildMealTargets,
  calculateBmr,
  calculateMacroTargets,
  calculateNutritionDetails,
  getMealSlotProfile,
  maintenanceCalories,
  sumTargets,
} = require('../src/services/nutritionService');
const {
  computeMealBounds,
  generatePlan,
  normalizeInput,
  rebalanceMeal,
  validateDailySwap,
} = require('../src/services/planGenerator');

const results = new Map();
const failures = [];

function test(moduleName, caseName, fn) {
  const result = results.get(moduleName) || { run: 0, passed: 0, failed: 0 };
  result.run += 1;
  try {
    fn();
    result.passed += 1;
  } catch (error) {
    result.failed += 1;
    failures.push({ module: moduleName, test: caseName, error: error.message });
  }
  results.set(moduleName, result);
}

function close(actual, expected, tolerance = 1e-7) {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `expected ${expected}, received ${actual}`,
  );
}

function expectThrow(fn, pattern) {
  assert.throws(fn, pattern);
}

function baseRaw(overrides = {}) {
  return {
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
  };
}

// 1. Client & goal
for (const goal of ['lose_weight', 'maintain', 'gain_weight']) {
  for (const sex of ['male', 'female']) {
    for (const numberOfMeals of [2, 3, 4, 5]) {
      for (const mealDistribution of Object.keys(MEAL_DISTRIBUTIONS)) {
        test('1. Client and goal', `${goal}/${sex}/${numberOfMeals}/${mealDistribution}`, () => {
          const input = normalizeInput(baseRaw({ goal, sex, numberOfMeals, mealDistribution }));
          assert.equal(input.goal, goal);
          assert.equal(input.sex, sex);
          assert.equal(input.numberOfMeals, numberOfMeals);
          assert.equal(input.mealDistribution, mealDistribution);
        });
      }
    }
  }
}

const invalidInputs = [
  [{ weightKg: 0 }, /weight/],
  [{ weightKg: 'x' }, /weight/],
  [{ heightCm: 0 }, /height/],
  [{ heightCm: 'x' }, /height/],
  [{ age: 0 }, /Age/],
  [{ age: 121 }, /Age/],
  [{ age: 'x' }, /Age/],
  [{ sex: '' }, /male or female/],
  [{ sex: 'other' }, /male or female/],
  [{ activityLevel: 'unknown' }, /activity/],
  [{ goal: 'recompose' }, /goal/],
  [{ numberOfMeals: 1 }, /between 2 and 5/],
  [{ numberOfMeals: 6 }, /between 2 and 5/],
  [{ mealDistribution: 'unknown' }, /distribution/],
  [{ weeklyWeightLossPercent: 0.49 }, /0.5%/],
  [{ weeklyWeightLossPercent: 1.01 }, /0.5%/],
  [{ gainSurplusCalories: 199 }, /200 and 300/],
  [{ gainSurplusCalories: 301 }, /200 and 300/],
  [{ proteinPerKg: 1.79 }, /1.8 and 2.2/],
  [{ proteinPerKg: 2.21 }, /1.8 and 2.2/],
  [{ fatPerKg: 0.65 }, /0.66 and 1.0/],
  [{ fatPerKg: 1.01 }, /0.66 and 1.0/],
  [{ bodyFatPercentage: 0 }, /Body fat/],
  [{ bodyFatPercentage: 70 }, /Body fat/],
];
for (const [override, pattern] of invalidInputs) {
  test('1. Client and goal', `reject ${JSON.stringify(override)}`, () => {
    expectThrow(() => normalizeInput(baseRaw(override)), pattern);
  });
}
test('1. Client and goal', 'legacy aggressive loss maps to 1% loss', () => {
  const input = normalizeInput(baseRaw({
    goal: 'lose_weight_aggressive',
    weeklyWeightLossPercent: undefined,
  }));
  assert.equal(input.goal, 'lose_weight');
  assert.equal(input.weeklyWeightLossPercent, 1);
});

// 2. Mifflin-St Jeor BMR
for (const weightKg of [40, 55, 70, 85, 100, 125, 150, 200]) {
  for (const heightCm of [145, 160, 175, 190, 205]) {
    for (const age of [18, 30, 45, 60, 75]) {
      for (const sex of ['male', 'female']) {
        test('2. Mifflin-St Jeor BMR', `${sex} ${weightKg}kg ${heightCm}cm age ${age}`, () => {
          const expected =
            10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161);
          close(calculateBmr({ weightKg, heightCm, age, sex }), expected);
        });
      }
    }
  }
}
for (const weightKg of [50, 80, 110, 140]) {
  for (const heightCm of [150, 180, 210]) {
    for (const age of [20, 50, 80]) {
      test('2. Mifflin-St Jeor BMR', `sex constant difference ${weightKg}/${heightCm}/${age}`, () => {
        const male = calculateBmr({ weightKg, heightCm, age, sex: 'male' });
        const female = calculateBmr({ weightKg, heightCm, age, sex: 'female' });
        close(male - female, 166);
      });
    }
  }
}

// 3. Activity -> TDEE
for (const sex of ['male', 'female']) {
  for (const activityLevel of Object.keys(NUTRITION.activityMultipliers)) {
    for (const age of [20, 35, 50, 65, 80]) {
      test('3. Activity and TDEE', `${sex}/${activityLevel}/age${age}`, () => {
        const input = normalizeInput(baseRaw({ sex, activityLevel, age }));
        close(
          maintenanceCalories(input),
          calculateBmr(input) * NUTRITION.activityMultipliers[activityLevel],
        );
      });
    }
  }
}
test('3. Activity and TDEE', 'physical job and athlete are separate tiers', () => {
  assert(NUTRITION.activityMultipliers.physical_job < NUTRITION.activityMultipliers.athlete);
  assert(NUTRITION.activityMultipliers.physical_job >= 1.6);
  assert.equal(NUTRITION.activityMultipliers.athlete, 1.9);
});

// 4. Maintenance, loss, gain, and safety floor
for (const weightKg of [40, 60, 80, 100, 120, 150, 180, 220]) {
  for (const sex of ['male', 'female']) {
    for (const activityLevel of ['sedentary', 'light', 'moderate', 'physical_job', 'athlete']) {
      test('4. Goal calorie adjustment', `maintain ${weightKg}/${sex}/${activityLevel}`, () => {
        const input = normalizeInput(baseRaw({ weightKg, sex, activityLevel, goal: 'maintain' }));
        const details = calculateNutritionDetails(input);
        close(details.targetCalories, details.maintenanceCalories);
      });
      for (const gainSurplusCalories of [200, 250, 300]) {
        test('4. Goal calorie adjustment', `gain ${weightKg}/${sex}/${activityLevel}/+${gainSurplusCalories}`, () => {
          const input = normalizeInput(baseRaw({
            weightKg,
            sex,
            activityLevel,
            goal: 'gain_weight',
            gainSurplusCalories,
          }));
          const details = calculateNutritionDetails(input);
          close(details.targetCalories, details.maintenanceCalories + gainSurplusCalories);
        });
      }
      for (const weeklyWeightLossPercent of [0.5, 0.75, 1]) {
        test('4. Goal calorie adjustment', `loss ${weightKg}/${sex}/${activityLevel}/${weeklyWeightLossPercent}%`, () => {
          const input = normalizeInput(baseRaw({
            weightKg,
            sex,
            activityLevel,
            goal: 'lose_weight',
            weeklyWeightLossPercent,
          }));
          const details = calculateNutritionDetails(input);
          const deficit = weightKg * weeklyWeightLossPercent / 100 * 7700 / 7;
          const absoluteFloor = sex === 'male' ? 1500 : 1200;
          const floor = Math.max(details.bmr * 1.2, absoluteFloor);
          close(details.requestedDailyDeficitCalories, deficit);
          close(details.safetyFloorCalories, floor);
          close(details.targetCalories, Math.max(details.maintenanceCalories - deficit, floor));
        });
      }
    }
  }
}

// 5. Daily macronutrients and edge handling
for (const weightKg of [40, 55, 70, 85, 100, 125, 150, 180, 220]) {
  for (const proteinPerKg of [1.8, 1.9, 2, 2.1, 2.2]) {
    for (const fatPerKg of [0.66, 0.7, 0.8, 0.9, 1]) {
      test('5. Daily macronutrients', `${weightKg}kg P${proteinPerKg} F${fatPerKg}`, () => {
        const targetCalories = weightKg * 45;
        const targets = calculateMacroTargets(
          { weightKg, proteinPerKg, fatPerKg },
          targetCalories,
        );
        close(targets.proteinG, weightKg * proteinPerKg);
        close(targets.fatG, weightKg * fatPerKg);
        assert(targets.carbG >= 0);
        close(
          targets.proteinG * 4 + targets.carbG * 4 + targets.fatG * 9,
          targetCalories,
        );
      });
    }
  }
}
for (const weightKg of [40, 60, 80, 100, 150, 220]) {
  test('5. Daily macronutrients', `fat trims before protein at ${weightKg}kg`, () => {
    const minimumMacroCalories = weightKg * 1.8 * 4 + weightKg * 0.66 * 9;
    const targets = calculateMacroTargets(
      { weightKg, proteinPerKg: 2, fatPerKg: 1 },
      minimumMacroCalories + weightKg * 0.2 * 4,
    );
    assert(targets.fatG >= weightKg * 0.66 - 1e-7);
    assert(targets.fatG < weightKg);
    assert(targets.proteinG >= weightKg * 1.8 - 1e-7);
    assert(targets.carbG >= 0);
  });
  test('5. Daily macronutrients', `reject impossible minimums at ${weightKg}kg`, () => {
    const minimumMacroCalories = weightKg * 1.8 * 4 + weightKg * 0.66 * 9;
    expectThrow(
      () => calculateMacroTargets(
        { weightKg, proteinPerKg: 2.2, fatPerKg: 1 },
        minimumMacroCalories - 1,
      ),
      /too low/,
    );
  });
}

// 6. Exact meal-calorie tables and labels
for (const [distribution, table] of Object.entries(MEAL_DISTRIBUTIONS)) {
  for (const numberOfMeals of [2, 3, 4, 5]) {
    test('6. Meal calorie distribution', `${distribution}/${numberOfMeals} exact table`, () => {
      const profiles = getMealSlotProfile(numberOfMeals, distribution);
      assert.deepEqual(
        profiles.map((profile) => profile.idealCaloriePercent),
        table[numberOfMeals],
      );
      close(profiles.reduce((total, profile) => total + profile.idealCaloriePercent, 0), 1);
      assert.equal(profiles.length, numberOfMeals);
    });
    test('6. Meal calorie distribution', `${distribution}/${numberOfMeals} snack policy`, () => {
      const tags = getMealSlotProfile(numberOfMeals, distribution).map((profile) => profile.tag);
      assert.equal(tags.filter((tag) => tag === 'snack').length, numberOfMeals === 4 ? 1 : (numberOfMeals === 5 ? 2 : 0));
    });
  }
}
test('6. Meal calorie distribution', 'two-meal labels are explicit for every pattern', () => {
  for (const distribution of Object.keys(MEAL_DISTRIBUTIONS)) {
    const profiles = getMealSlotProfile(2, distribution);
    assert(profiles.every((profile) => profile.name && profile.tag));
  }
});

// 7. Database-derived macro ratios, protein floors, and exact daily reconciliation
const databaseProfiles = getDatabaseMealMacroProfiles();
const expectedSourceCounts = { breakfast: 54, lunch: 70, dinner: 53, snack: 46 };
for (const tag of Object.keys(expectedSourceCounts)) {
  test('7. Database meal macro ratios', `${tag} source and sample count`, () => {
    assert.equal(databaseProfiles[tag].source, 'ready_meal_database');
    assert.equal(databaseProfiles[tag].sourceCount, expectedSourceCounts[tag]);
  });
  test('7. Database meal macro ratios', `${tag} ratio sums to one`, () => {
    close(
      databaseProfiles[tag].protein +
      databaseProfiles[tag].carb +
      databaseProfiles[tag].fat,
      1,
    );
    assert(databaseProfiles[tag].protein > 0);
    assert(databaseProfiles[tag].carb > 0);
    assert(databaseProfiles[tag].fat > 0);
  });
}
test('7. Database meal macro ratios', 'profiles are derived from all 223 ready meals', () => {
  assert.equal(
    Object.values(databaseProfiles).reduce((total, profile) => total + profile.sourceCount, 0),
    loadReadyMealBundles().length,
  );
});
test('7. Database meal macro ratios', 'derivation responds to fixture nutrition data', () => {
  const foods = [
    foodFixture('protein', 25, 0, 0),
    foodFixture('carb', 0, 25, 0),
    foodFixture('fat', 0, 0, 25),
  ];
  const readyMeals = ['breakfast', 'lunch', 'dinner', 'snack'].map((mealTag) => ({
    id: mealTag,
    mealTag,
    components: [{ lookupName: mealTag === 'breakfast' ? 'protein' : 'carb' }],
  }));
  const profiles = deriveMealMacroProfiles({ readyMeals, foods });
  close(profiles.breakfast.protein, 1);
  close(profiles.lunch.carb, 1);
});

for (const distribution of Object.keys(MEAL_DISTRIBUTIONS)) {
  for (const numberOfMeals of [2, 3, 4, 5]) {
    for (const setup of [
      { weightKg: 60, calories: 1900, proteinG: 120, fatG: 42 },
      { weightKg: 80, calories: 2400, proteinG: 160, fatG: 56 },
      { weightKg: 120, calories: 3400, proteinG: 240, fatG: 84 },
    ]) {
      test('7. Database meal macro ratios', `${distribution}/${numberOfMeals}/${setup.weightKg}kg reconciliation`, () => {
        const dailyTargets = {
          calories: setup.calories,
          proteinG: setup.proteinG,
          fatG: setup.fatG,
          carbG: (setup.calories - setup.proteinG * 4 - setup.fatG * 9) / 4,
        };
        const input = normalizeInput(baseRaw({
          weightKg: setup.weightKg,
          numberOfMeals,
          mealDistribution: distribution,
        }));
        const meals = buildMealTargets(dailyTargets, input);
        const totals = sumTargets(meals.map((meal) => meal.targets));
        for (const key of ['calories', 'proteinG', 'carbG', 'fatG']) {
          close(totals[key], dailyTargets[key], 1e-5);
        }
        for (const meal of meals) {
          const minimumProteinCalories =
            dailyTargets.proteinG * 4 *
            meal.slotProfile.idealCaloriePercent *
            NUTRITION.databaseProteinFloorFraction;
          assert(meal.targets.proteinG * 4 >= minimumProteinCalories - 1e-5);
          close(
            meal.targets.proteinG * 4 +
            meal.targets.carbG * 4 +
            meal.targets.fatG * 9,
            meal.targets.calories,
            1e-5,
          );
          assert.equal(meal.slotProfile.macroProfileSource, 'ready_meal_database');
        }
      });
    }
  }
}

// 8. ±5% daily-calorie swap window and daily range checks
for (let dailyCalories = 1200; dailyCalories <= 5000; dailyCalories += 100) {
  test('8. Meal swap flexibility', `absolute meal window at ${dailyCalories} kcal`, () => {
    const target = { calories: dailyCalories * 0.3, proteinG: 45, carbG: 60, fatG: 20 };
    const bounds = computeMealBounds(target, { dailyCalories });
    close(bounds.calories.min, target.calories - dailyCalories * 0.05);
    close(bounds.calories.max, target.calories + dailyCalories * 0.05);
  });
}

const swapBase = {
  dailyTargets: { calories: 2000, proteinG: 160, carbG: 250, fatG: 56 },
  weightKg: 80,
  currentDailyTotals: { calories: 2000, proteinG: 160, carbG: 250, fatG: 56 },
  currentMealTotals: { calories: 500, proteinG: 40, carbG: 60, fatG: 15 },
};
for (let delta = -140; delta <= 140; delta += 5) {
  test('8. Meal swap flexibility', `projected daily calorie delta ${delta}`, () => {
    const validation = validateDailySwap({
      ...swapBase,
      proposedMealTotals: {
        ...swapBase.currentMealTotals,
        calories: swapBase.currentMealTotals.calories + delta,
      },
    });
    assert.equal(validation.valid, Math.abs(delta) <= 100);
  });
}
for (let delta = -24; delta <= 24; delta += 1) {
  test('8. Meal swap flexibility', `projected protein delta ${delta}`, () => {
    const validation = validateDailySwap({
      ...swapBase,
      proposedMealTotals: {
        ...swapBase.currentMealTotals,
        proteinG: swapBase.currentMealTotals.proteinG + delta,
      },
    });
    assert.equal(validation.valid, 160 + delta >= 144 && 160 + delta <= 176);
  });
}
for (let delta = -10; delta <= 30; delta += 1) {
  test('8. Meal swap flexibility', `projected fat delta ${delta}`, () => {
    const validation = validateDailySwap({
      ...swapBase,
      proposedMealTotals: {
        ...swapBase.currentMealTotals,
        fatG: swapBase.currentMealTotals.fatG + delta,
      },
    });
    assert.equal(validation.valid, 56 + delta >= 52.8 && 56 + delta <= 80);
  });
}
test('8. Meal swap flexibility', 'missing daily context is rejected', () => {
  const validation = validateDailySwap({});
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.violations, ['daily_context']);
});
test('8. Meal swap flexibility', 'negative daily carbohydrates are rejected', () => {
  const validation = validateDailySwap({
    ...swapBase,
    proposedMealTotals: { calories: 500, proteinG: 40, carbG: -300, fatG: 15 },
  });
  assert(validation.violations.includes('daily_carbs'));
});
test('8. Meal swap flexibility', 'deterministic rebalance enforces projected daily ranges', () => {
  const mealTarget = { calories: 761, proteinG: 53, carbG: 81, fatG: 25 };
  const result = rebalanceMeal({
    mealTarget,
    items: [
      { foodId: 'bread_brown_whole_grain', quantityG: 30 },
      { foodId: 'chicken_breast_skinless_boneless_grilled', quantityG: 85 },
      { foodId: 'cheese_cheddar', quantityG: 40 },
      { foodId: 'nuts_almond_butter_without_salt', quantityG: 15 },
    ],
    dailyContext: {
      dailyTargets: { calories: 2500, proteinG: 160, carbG: 300, fatG: 70 },
      weightKg: 80,
      currentDailyTotals: { calories: 2500, proteinG: 160, carbG: 300, fatG: 70 },
      currentMealTotals: mealTarget,
    },
  });
  assert.equal(result.success, true);
  assert.equal(result.dailyValidation.valid, true);
  assert(Math.abs(result.totals.calories - mealTarget.calories) <= 125);
});
test('8. Meal swap flexibility', 'otherwise-valid meal is blocked when daily protein is out of range', () => {
  const validation = validateDailySwap({
    ...swapBase,
    currentDailyTotals: { ...swapBase.currentDailyTotals, proteinG: 140 },
    proposedMealTotals: swapBase.currentMealTotals,
  });
  assert.equal(validation.valid, false);
  assert(validation.violations.includes('daily_protein'));
});

// End-to-end generation and UI wiring
for (const distribution of Object.keys(MEAL_DISTRIBUTIONS)) {
  for (const numberOfMeals of [2, 3, 4, 5]) {
    test('9. End-to-end integration', `${distribution}/${numberOfMeals} generated plan`, () => {
      const plan = generatePlan(baseRaw({ distribution, mealDistribution: distribution, numberOfMeals }));
      assert.notEqual(plan.status, 'error', JSON.stringify(plan.errors || []));
      assert.equal(plan.meals.length, numberOfMeals);
      assert(plan.meals.every((meal) => meal.slotProfile?.macroProfileSource === 'ready_meal_database'));
      close(plan.nutritionCalculation.bmr, 1748.75);
      const targetSum = sumTargets(plan.meals.map((meal) => meal.target));
      for (const key of ['calories', 'proteinG', 'carbG', 'fatG']) {
        close(targetSum[key], plan.dailyTargets[key], 1e-5);
      }
    });
  }
}
for (const sex of ['male', 'female']) {
  for (const activityLevel of ['sedentary', 'light', 'moderate', 'physical_job', 'athlete']) {
    for (const goal of ['maintain', 'lose_weight', 'gain_weight']) {
      test('9. End-to-end integration', `${sex}/${activityLevel}/${goal}`, () => {
        const plan = generatePlan(baseRaw({ sex, activityLevel, goal }));
        assert.equal(plan.meals.length, 3);
        assert(plan.dailyTargets.calories > 0);
        assert(plan.dailyTargets.proteinG / plan.input.weightKg >= 1.8 - 1e-7);
        assert(plan.dailyTargets.proteinG / plan.input.weightKg <= 2.2 + 1e-7);
        assert(plan.dailyTargets.fatG / plan.input.weightKg >= 0.66 - 1e-7);
        assert(plan.dailyTargets.fatG / plan.input.weightKg <= 1 + 1e-7);
      });
    }
  }
}

const plannerHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'planner.html'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
for (const field of [
  'age',
  'sex',
  'mealDistribution',
]) {
  test('9. End-to-end integration', `UI exposes ${field}`, () => {
    assert(plannerHtml.includes(`name="${field}"`));
    assert(appJs.includes(`${field}: data.get('${field}')`));
  });
}
for (const internalField of [
  'weeklyWeightLossPercent',
  'gainSurplusCalories',
  'proteinPerKg',
  'fatPerKg',
]) {
  test('9. End-to-end integration', `UI hides internal policy ${internalField}`, () => {
    assert(!plannerHtml.includes(`name="${internalField}"`));
    assert(!appJs.includes(`${internalField}: data.get('${internalField}')`));
  });
}
test('9. End-to-end integration', 'UI uses only the three document goals', () => {
  assert(!plannerHtml.includes('lose_weight_aggressive'));
  for (const goal of ['maintain', 'lose_weight', 'gain_weight']) {
    assert(plannerHtml.includes(`value="${goal}"`));
  }
});
test('9. End-to-end integration', 'UI sends daily swap context', () => {
  assert(appJs.includes('dailyContext:'));
  assert(appJs.includes('currentDailyTotals: currentDailyTotals()'));
  assert(appJs.includes('currentMealTotals: computeTotals(state.items)'));
});

const summary = Object.fromEntries(results);
const totals = Object.values(summary).reduce(
  (total, result) => ({
    run: total.run + result.run,
    passed: total.passed + result.passed,
    failed: total.failed + result.failed,
  }),
  { run: 0, passed: 0, failed: 0 },
);

console.log(JSON.stringify({ modules: summary, totals, failures: failures.slice(0, 50) }, null, 2));
if (totals.failed > 0) process.exitCode = 1;

function foodFixture(name, proteinGPer100g, carbGPer100g, fatGPer100g) {
  return {
    name,
    defaultServingG: 100,
    proteinGPer100g,
    carbGPer100g,
    fatGPer100g,
  };
}
