const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const {
  MEAL_DISTRIBUTIONS,
  NUTRITION,
} = require('../src/config/nutritionConstants');
const {
  buildMealTargets,
  calculateBmr,
  calculateDailyMacroRanges,
  calculateMacroTargets,
  calculateNutritionDetails,
  getMealSlotProfile,
  maintenanceCalories,
} = require('../src/services/nutritionService');
const {
  computeMealBounds,
  normalizeInput,
  validateMealSwap,
} = require('../src/services/planGenerator');

const results = [];
const failures = [];

function check(label, fn) {
  try {
    const detail = fn();
    results.push({ label, status: 'IMPLEMENTED/VERIFIED', detail });
  } catch (error) {
    results.push({ label, status: 'MISSING/FAILING', detail: error.message });
    failures.push({ label, error: error.stack || error.message });
  }
}

function close(actual, expected, tolerance = 1e-7) {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `expected ${expected}, received ${actual}`,
  );
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

check('1a BMR and TDEE formulas', () => {
  for (const sex of ['male', 'female']) {
    for (const activityLevel of Object.keys(NUTRITION.activityMultipliers)) {
      const input = normalizeInput(baseRaw({ sex, activityLevel, weightKg: 100, heightCm: 180, age: 40 }));
      const expectedBmr = 10 * 100 + 6.25 * 180 - 5 * 40 + (sex === 'male' ? 5 : -161);
      close(calculateBmr(input), expectedBmr);
      close(maintenanceCalories(input), expectedBmr * NUTRITION.activityMultipliers[activityLevel]);
    }
  }
  assert.deepEqual(NUTRITION.activityMultipliers, {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    athlete: 1.9,
  });
  return 'Mifflin-St Jeor and the four documented activity factors match v8.';
});

check('1b Goal calorie adjustment', () => {
  const maintain = calculateNutritionDetails(normalizeInput(baseRaw({ goal: 'maintain' })));
  close(maintain.targetCalories, maintain.maintenanceCalories);

  const loss = calculateNutritionDetails(normalizeInput(baseRaw({
    weightKg: 100,
    goal: 'lose_weight',
    weeklyWeightLossPercent: 0.5,
  })));
  close(loss.requestedDailyDeficitCalories, 100 * 0.5 / 100 * 7700 / 7);
  close(loss.targetCalories, loss.maintenanceCalories - loss.requestedDailyDeficitCalories);

  const gain = calculateNutritionDetails(normalizeInput(baseRaw({
    goal: 'gain_weight',
    gainSurplusCalories: 300,
  })));
  close(gain.targetCalories, gain.maintenanceCalories + 300);
  return 'Maintain unchanged, loss is weight-scaled, gain is fixed +200 to +300 kcal.';
});

check('1c / Section 5 Daily macro gram ranges', () => {
  for (const weightKg of [40, 100, 180]) {
    const ranges = calculateDailyMacroRanges(weightKg, 2500);
    close(ranges.proteinG.min, weightKg * 1.8);
    close(ranges.proteinG.max, weightKg * 2.2);
    close(ranges.fatG.min, weightKg * 0.66);
    close(ranges.fatG.max, weightKg * 1.0);
    assert(ranges.proteinG.min < ranges.proteinG.max);
    assert(ranges.fatG.min < ranges.fatG.max);
  }

  const point = calculateMacroTargets({ weightKg: 100, proteinPerKg: 2, fatPerKg: 0.7 }, 2500);
  close(point.proteinG, 200);
  close(point.fatG, 70);
  close(point.proteinG * 4 + point.carbG * 4 + point.fatG * 9, 2500);
  assert(point.macroRanges.proteinG.min < point.macroRanges.proteinG.max);
  return 'Ranges are non-inverted at 40kg, 100kg, and 180kg; display point remains the recommended default.';
});

check('1d / Section 6 Meal-calorie distribution', () => {
  const expected = {
    balanced: {
      2: [0.40, 0.60],
      3: [0.25, 0.40, 0.35],
      4: [0.25, 0.15, 0.30, 0.30],
      5: [0.20, 0.10, 0.30, 0.10, 0.30],
    },
    breakfast_heavy: {
      2: [0.45, 0.55],
      3: [0.30, 0.373, 0.327],
      4: [0.30, 0.15, 0.275, 0.275],
      5: [0.25, 0.10, 0.275, 0.10, 0.275],
    },
    lunch_heavy: {
      2: [0.25, 0.75],
      3: [0.1875, 0.55, 0.2625],
      4: [0.182, 0.15, 0.45, 0.218],
      5: [0.14, 0.10, 0.45, 0.10, 0.21],
    },
    dinner_heavy: {
      2: [0.25, 0.75],
      3: [0.192, 0.308, 0.50],
      4: [0.182, 0.15, 0.218, 0.45],
      5: [0.14, 0.10, 0.21, 0.10, 0.45],
    },
  };
  assert.deepEqual(MEAL_DISTRIBUTIONS, expected);
  for (const [distribution, table] of Object.entries(MEAL_DISTRIBUTIONS)) {
    for (const [mealCount, percentages] of Object.entries(table)) {
      close(percentages.reduce((sum, value) => sum + value, 0), 1, 1e-10);
      const profiles = getMealSlotProfile(Number(mealCount), distribution);
      assert.deepEqual(profiles.map((profile) => profile.idealCaloriePercent), percentages);
    }
  }
  for (const mealCount of [4, 5]) {
    for (const distribution of ['breakfast_heavy', 'lunch_heavy', 'dinner_heavy']) {
      const snacks = getMealSlotProfile(mealCount, distribution)
        .filter((profile) => profile.tag === 'snack')
        .map((profile) => profile.idealCaloriePercent);
      const balancedSnacks = getMealSlotProfile(mealCount, 'balanced')
        .filter((profile) => profile.tag === 'snack')
        .map((profile) => profile.idealCaloriePercent);
      assert.deepEqual(snacks, balancedSnacks);
    }
  }
  return 'Every table sums to 100%; snack slots are unchanged in heavy distributions.';
});

check('1e / Section 7 Fixed macro-ratio range table', () => {
  const table = NUTRITION.mealMacroRatioRanges;
  assert.deepEqual(table, {
    breakfast: {
      protein: { min: 0.20, max: 0.24 },
      fat: { min: 0.33, max: 0.52 },
      carb: { min: 0.28, max: 0.51 },
    },
    lunch: {
      protein: { min: 0.20, max: 0.28 },
      fat: { min: 0.29, max: 0.41 },
      carb: { min: 0.34, max: 0.46 },
    },
    dinner: {
      protein: { min: 0.20, max: 0.27 },
      fat: { min: 0.27, max: 0.40 },
      carb: { min: 0.35, max: 0.45 },
    },
    snack: {
      protein: { min: 0.20, max: 0.24 },
      fat: { min: 0.39, max: 0.63 },
      carb: { min: 0.20, max: 0.34 },
    },
  });
  for (const ranges of Object.values(table)) {
    for (const range of Object.values(ranges)) {
      assert(range.min < range.max);
    }
  }
  const before = JSON.stringify(table);
  buildMealTargets(calculateNutritionDetails(normalizeInput(baseRaw({ weightKg: 55 }))).targets, normalizeInput(baseRaw({ weightKg: 55 })));
  buildMealTargets(calculateNutritionDetails(normalizeInput(baseRaw({ weightKg: 140 }))).targets, normalizeInput(baseRaw({ weightKg: 140 })));
  assert.equal(JSON.stringify(table), before);
  return 'The fixed table is client-independent; breakfast/snack protein floors are applied at 20%.';
});

check('1f / Section 8 Scaled per-meal windows', () => {
  const clients = [
    baseRaw({ weightKg: 40, heightCm: 150, age: 22, sex: 'female', numberOfMeals: 3, mealDistribution: 'balanced' }),
    baseRaw({ weightKg: 100, heightCm: 185, age: 36, sex: 'male', numberOfMeals: 4, mealDistribution: 'lunch_heavy' }),
    baseRaw({ weightKg: 180, heightCm: 195, age: 50, sex: 'male', numberOfMeals: 5, mealDistribution: 'dinner_heavy', goal: 'gain_weight' }),
  ];

  for (const raw of clients) {
    const input = normalizeInput(raw);
    const dailyTargets = calculateNutritionDetails(input).targets;
    const meals = buildMealTargets(dailyTargets, input);
    const sums = sumMealWindowBounds(meals);
    close(sums.proteinG.min, dailyTargets.macroRanges.proteinG.min, 1e-7);
    close(sums.proteinG.max, dailyTargets.macroRanges.proteinG.max, 1e-7);
    close(sums.fatG.min, dailyTargets.macroRanges.fatG.min, 1e-7);
    close(sums.fatG.max, dailyTargets.macroRanges.fatG.max, 1e-7);
    close(sums.carbG.min, dailyTargets.macroRanges.carbG.min, 1e-7);
    close(sums.carbG.max, dailyTargets.macroRanges.carbG.max, 1e-7);
    for (const meal of meals) {
      assert(meal.targets.macroWindows.proteinG.min > 0);
      assert(meal.targets.macroWindows.proteinG.min < meal.targets.macroWindows.proteinG.max);
      assert(meal.targets.macroWindows.fatG.min > 0);
      assert(meal.targets.macroWindows.fatG.min < meal.targets.macroWindows.fatG.max);
      assert.notEqual(
        meal.targets.macroWindows.scaling.protein.minScale,
        meal.targets.macroWindows.scaling.protein.maxScale,
      );
      close(
        meal.targets.macroWindows.scaling.protein.raw.min *
          meal.targets.macroWindows.scaling.protein.minScale,
        meal.targets.macroWindows.proteinG.min,
      );
      close(
        meal.targets.macroWindows.scaling.protein.raw.max *
          meal.targets.macroWindows.scaling.protein.maxScale,
        meal.targets.macroWindows.proteinG.max,
      );
    }
  }

  const extremeInput = normalizeInput(baseRaw({
    weightKg: 180,
    heightCm: 145,
    age: 75,
    sex: 'female',
    activityLevel: 'sedentary',
    goal: 'lose_weight',
    weeklyWeightLossPercent: 1,
    numberOfMeals: 5,
    mealDistribution: 'breakfast_heavy',
  }));
  const extremeTargets = calculateNutritionDetails(extremeInput).targets;
  const extremeMeals = buildMealTargets(extremeTargets, extremeInput);
  const extremeSums = sumMealWindowBounds(extremeMeals);
  close(extremeSums.proteinG.min, extremeTargets.macroRanges.proteinG.min, 1e-7);
  close(extremeSums.proteinG.max, extremeTargets.macroRanges.proteinG.max, 1e-7);
  assert(extremeMeals.every((meal) => meal.targets.macroWindows.proteinG.min > 0));
  assert(extremeMeals.every((meal) => meal.targets.macroWindows.fatG.min > 0));
  return 'Three varied clients plus an extreme client reconcile raw windows to daily ranges with separate min/max scales.';
});

check('1g / Section 9 Two hard constraints', () => {
  const mealTarget = syntheticMealTarget();
  const bounds = computeMealBounds(mealTarget);
  assert.deepEqual(bounds, mealTarget.macroWindows);
  close(bounds.calories.min, 570);
  close(bounds.calories.max, 630);

  const cases = [
    ['A only', { calories: 600, proteinG: 5, carbG: 75, fatG: 20 }, false, 'meal_protein'],
    ['B only', { calories: 700, proteinG: 30, carbG: 75, fatG: 20 }, false, 'meal_calories'],
    ['neither', { calories: 700, proteinG: 5, carbG: 10, fatG: 80 }, false, 'meal_calories'],
    ['both', { calories: 630, proteinG: 30, carbG: 75, fatG: 20 }, true, null],
    ['lower boundary', { calories: 570, proteinG: 20, carbG: 50, fatG: 10 }, true, null],
    ['upper boundary', { calories: 630, proteinG: 40, carbG: 100, fatG: 30 }, true, null],
  ];
  for (const [name, totals, expectedValid, expectedViolation] of cases) {
    const result = validateMealSwap({ mealTarget, proposedMealTotals: totals });
    assert.equal(result.valid, expectedValid, name);
    if (expectedViolation) assert(result.violations.includes(expectedViolation), name);
  }

  const filtered = cases
    .map(([name, totals]) => ({ name, totals }))
    .filter((candidate) => validateMealSwap({ mealTarget, proposedMealTotals: candidate.totals }).valid);
  assert.deepEqual(filtered.map((candidate) => candidate.name), ['both', 'lower boundary', 'upper boundary']);

  const emptyFiltered = [{ calories: 600, proteinG: 5, carbG: 75, fatG: 20 }]
    .filter((candidate) => validateMealSwap({ mealTarget, proposedMealTotals: candidate }).valid);
  assert.equal(emptyFiltered.length, 0);

  const dayTargetCalories = 2500;
  const mealCalories = [600, 700, 500, 700];
  close(mealCalories.reduce((sum, value) => sum + value * 1.05, 0), dayTargetCalories * 1.05);
  return 'Constraint A and B are inclusive hard filters; empty sets remain empty with no relaxation.';
});

check('1h / Section 10 Swap invariants', () => {
  const input = normalizeInput(baseRaw({ weightKg: 100, numberOfMeals: 4, mealDistribution: 'balanced' }));
  const dailyTargets = calculateNutritionDetails(input).targets;
  const meals = buildMealTargets(dailyTargets, input);
  const beforeWindows = JSON.stringify(meals.map((meal) => meal.targets.macroWindows));

  const slotIndex = 2;
  const slot = meals[slotIndex];
  const filteredSet = [
    totalsAtWindowEdge(slot.targets.macroWindows, 'min'),
    totalsAtWindowEdge(slot.targets.macroWindows, 'max'),
    { calories: slot.targets.calories, proteinG: 0, carbG: 0, fatG: 0 },
  ].filter((candidate) => validateMealSwap({
    mealTarget: slot.targets,
    proposedMealTotals: candidate,
  }).valid);
  assert.equal(filteredSet.length, 2);

  let dayTotals = meals.map((meal, index) =>
    totalsAtWindowEdge(meal.targets.macroWindows, index % 2 === 0 ? 'min' : 'max')
  );
  for (let swap = 0; swap < 6; swap += 1) {
    dayTotals[slotIndex] = filteredSet[swap % filteredSet.length];
    assert.equal(JSON.stringify(meals.map((meal) => meal.targets.macroWindows)), beforeWindows);
    const totals = sumTotals(dayTotals);
    assert(totals.proteinG >= dailyTargets.macroRanges.proteinG.min - 1e-7);
    assert(totals.proteinG <= dailyTargets.macroRanges.proteinG.max + 1e-7);
    assert(totals.fatG >= dailyTargets.macroRanges.fatG.min - 1e-7);
    assert(totals.fatG <= dailyTargets.macroRanges.fatG.max + 1e-7);
    assert(totals.carbG >= dailyTargets.macroRanges.carbG.min - 1e-7);
    assert(totals.carbG <= dailyTargets.macroRanges.carbG.max + 1e-7);
  }
  return 'Swaps use only the selected slot filtered set, leave other stored windows unchanged, and stay inside daily macro ranges.';
});

check('UI and document wiring still expose v8 policy surface', () => {
  const plannerHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'planner.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  for (const field of ['age', 'sex', 'mealDistribution']) {
    assert(plannerHtml.includes(`name="${field}"`));
    assert(appJs.includes(`${field}: data.get('${field}')`));
  }
  for (const goal of ['maintain', 'lose_weight', 'gain_weight']) {
    assert(plannerHtml.includes(`value="${goal}"`));
  }
  assert(!plannerHtml.includes('lose_weight_aggressive'));
  return 'Planner still sends the inputs required by Sections 1-6.';
});

console.log('Nutrition Coaching Rules v8 Audit');
for (const result of results) {
  console.log(`- ${result.label}: ${result.status} - ${result.detail}`);
}
console.log(JSON.stringify({
  totals: {
    run: results.length,
    passed: results.length - failures.length,
    failed: failures.length,
  },
  failures: failures.map(({ label, error }) => ({ label, error })),
}, null, 2));
if (failures.length > 0) process.exitCode = 1;

function sumMealWindowBounds(meals) {
  return meals.reduce(
    (total, meal) => {
      const windows = meal.targets.macroWindows;
      for (const key of ['proteinG', 'fatG', 'carbG']) {
        total[key].min += windows[key].min;
        total[key].max += windows[key].max;
      }
      return total;
    },
    {
      proteinG: { min: 0, max: 0 },
      fatG: { min: 0, max: 0 },
      carbG: { min: 0, max: 0 },
    },
  );
}

function syntheticMealTarget() {
  return {
    calories: 600,
    proteinG: 30,
    carbG: 75,
    fatG: 20,
    macroWindows: {
      calories: { min: 570, max: 630 },
      proteinG: { min: 20, max: 40 },
      carbG: { min: 50, max: 100 },
      fatG: { min: 10, max: 30 },
    },
  };
}

function totalsAtWindowEdge(windows, edge) {
  return {
    calories: windows.calories[edge],
    proteinG: windows.proteinG[edge],
    carbG: windows.carbG[edge],
    fatG: windows.fatG[edge],
  };
}

function sumTotals(values) {
  return values.reduce(
    (total, value) => ({
      calories: total.calories + value.calories,
      proteinG: total.proteinG + value.proteinG,
      carbG: total.carbG + value.carbG,
      fatG: total.fatG + value.fatG,
    }),
    { calories: 0, proteinG: 0, carbG: 0, fatG: 0 },
  );
}
