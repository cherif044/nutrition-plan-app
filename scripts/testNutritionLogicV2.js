const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const {
  MEAL_DISTRIBUTIONS,
  NUTRITION,
} = require('../src/config/nutritionConstants');
const {
  buildMealTargets,
  buildScaledMealMacroWindows,
  calculateBmr,
  calculateDailyMacroRanges,
  calculateMacroTargets,
  calculateNutritionDetails,
  getMealSlotProfile,
  maintenanceCalories,
} = require('../src/services/nutritionService');
const {
  computeDailyPlanBounds,
  computeMealBounds,
  dailyTotalsWithinPlanBounds,
  mealRankTuple,
  normalizeInput,
  requiredCarbWindowForCandidate,
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
  return 'Mifflin-St Jeor and the four documented activity factors match v9.';
});

check('1b Goal calorie adjustment', () => {
  const maintain = calculateNutritionDetails(normalizeInput(baseRaw({ goal: 'maintain' })));
  close(maintain.targetCalories, maintain.maintenanceCalories);
  assert.equal(maintain.calorieFloorApplied, false);

  const loss = calculateNutritionDetails(normalizeInput(baseRaw({
    weightKg: 100,
    goal: 'lose_weight',
    weeklyWeightLossPercent: 0.5,
  })));
  close(loss.requestedDailyDeficitCalories, 100 * 0.5 / 100 * 7700 / 7);
  close(loss.targetCalories, loss.maintenanceCalories - loss.requestedDailyDeficitCalories);
  close(loss.adjustmentCalories, loss.targetCalories - loss.maintenanceCalories);
  assert.equal(loss.calorieFloorApplied, false);

  const gain = calculateNutritionDetails(normalizeInput(baseRaw({
    goal: 'gain_weight',
    gainSurplusCalories: 300,
  })));
  close(gain.targetCalories, gain.maintenanceCalories + 300);
  close(gain.adjustmentCalories, 300);
  assert.equal(gain.calorieFloorApplied, false);

  const lowMaleLossInput = normalizeInput(baseRaw({
    weightKg: 85,
    heightCm: 181,
    age: 25,
    sex: 'male',
    activityLevel: 'sedentary',
    goal: 'lose_weight',
    weeklyWeightLossPercent: 1,
  }));
  const lowMaleLoss = calculateNutritionDetails(lowMaleLossInput);
  assert(lowMaleLoss.calculatedGoalCalories < NUTRITION.calorieFloorBySex.male);
  close(lowMaleLoss.targetCalories, NUTRITION.calorieFloorBySex.male);
  close(lowMaleLoss.adjustmentCalories, lowMaleLoss.targetCalories - lowMaleLoss.maintenanceCalories);
  assert.equal(lowMaleLoss.calorieFloorApplied, true);
  close(lowMaleLoss.targets.proteinG, lowMaleLossInput.weightKg * lowMaleLossInput.proteinPerKg);
  close(lowMaleLoss.targets.fatG, lowMaleLossInput.weightKg * lowMaleLossInput.fatPerKg);
  close(
    lowMaleLoss.targets.carbG,
    (
      NUTRITION.calorieFloorBySex.male -
      lowMaleLoss.targets.proteinG * NUTRITION.proteinKcalPerGram -
      lowMaleLoss.targets.fatG * NUTRITION.fatKcalPerGram
    ) / NUTRITION.carbKcalPerGram,
  );

  const lowFemaleLossInput = normalizeInput(baseRaw({
    weightKg: 55,
    heightCm: 160,
    age: 45,
    sex: 'female',
    activityLevel: 'sedentary',
    goal: 'lose_weight',
    weeklyWeightLossPercent: 1,
  }));
  const lowFemaleLoss = calculateNutritionDetails(lowFemaleLossInput);
  assert(lowFemaleLoss.calculatedGoalCalories < NUTRITION.calorieFloorBySex.female);
  close(lowFemaleLoss.targetCalories, NUTRITION.calorieFloorBySex.female);
  close(lowFemaleLoss.adjustmentCalories, lowFemaleLoss.targetCalories - lowFemaleLoss.maintenanceCalories);
  assert.equal(lowFemaleLoss.calorieFloorApplied, true);
  close(lowFemaleLoss.targets.proteinG, lowFemaleLossInput.weightKg * lowFemaleLossInput.proteinPerKg);
  close(lowFemaleLoss.targets.fatG, lowFemaleLossInput.weightKg * lowFemaleLossInput.fatPerKg);
  close(
    lowFemaleLoss.targets.carbG,
    (
      NUTRITION.calorieFloorBySex.female -
      lowFemaleLoss.targets.proteinG * NUTRITION.proteinKcalPerGram -
      lowFemaleLoss.targets.fatG * NUTRITION.fatKcalPerGram
    ) / NUTRITION.carbKcalPerGram,
  );

  return 'Maintain/loss/gain use their normal formulas, then sex calorie floors are applied before macros; protein/fat stay g/kg and carbs absorb the floor calories.';
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
  return 'Ranges are non-inverted at 40kg, 100kg, and 180kg; default targets are 2.0g/kg protein and 0.7g/kg fat.';
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

      const dailyCalories = 2400;
      const calorieMins = profiles.reduce((sum, profile) => (
        sum + dailyCalories * profile.idealCaloriePercent * 0.95
      ), 0);
      const calorieMaxes = profiles.reduce((sum, profile) => (
        sum + dailyCalories * profile.idealCaloriePercent * 1.05
      ), 0);
      close(calorieMins, dailyCalories * 0.95);
      close(calorieMaxes, dailyCalories * 1.05);
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
  assert(getMealSlotProfile(3, 'breakfast_heavy')[0].idealCaloriePercent > getMealSlotProfile(3, 'balanced')[0].idealCaloriePercent);
  assert(getMealSlotProfile(3, 'lunch_heavy')[1].idealCaloriePercent > getMealSlotProfile(3, 'balanced')[1].idealCaloriePercent);
  assert(getMealSlotProfile(3, 'dinner_heavy')[2].idealCaloriePercent > getMealSlotProfile(3, 'balanced')[2].idealCaloriePercent);
  return 'Every pattern x meal-count sums to 100%; heavy boosts hit only the intended non-snack slot and meal windows sum to daily +/-5%.';
});

check('1e / Section 7 Fixed macro-ratio range table', () => {
  assert.deepEqual(NUTRITION.mealMacroRatioRanges, {
    breakfast: {
      protein: { min: 0.16, max: 0.30 },
      fat: { min: 0.25, max: 0.54 },
      carb: { min: 0.22, max: 0.54 },
    },
    lunch: {
      protein: { min: 0.18, max: 0.33 },
      fat: { min: 0.21, max: 0.49 },
      carb: { min: 0.25, max: 0.54 },
    },
    dinner: {
      protein: { min: 0.18, max: 0.33 },
      fat: { min: 0.21, max: 0.49 },
      carb: { min: 0.25, max: 0.54 },
    },
    snack: {
      protein: { min: 0.13, max: 0.30 },
      fat: { min: 0.22, max: 0.54 },
      carb: { min: 0.20, max: 0.54 },
    },
  });
  for (const ranges of Object.values(NUTRITION.mealMacroRatioRanges)) {
    for (const range of Object.values(ranges)) assert(range.min < range.max);
  }
  const before = JSON.stringify(NUTRITION.mealMacroRatioRanges);
  const lightClient = buildMealTargets(calculateNutritionDetails(normalizeInput(baseRaw({ weightKg: 55 }))).targets, normalizeInput(baseRaw({ weightKg: 55 })));
  const heavyClient = buildMealTargets(calculateNutritionDetails(normalizeInput(baseRaw({ weightKg: 140 }))).targets, normalizeInput(baseRaw({ weightKg: 140 })));
  assert.equal(JSON.stringify(NUTRITION.mealMacroRatioRanges), before);
  for (const meals of [lightClient, heavyClient]) {
    for (const meal of meals) {
      assert(meal.slotProfile.macroCalorieRatio.protein.min >= NUTRITION.minimumMealProteinCalorieRatio);
    }
  }
  return 'The raw table is fixed/client-independent and the 20% protein floor is applied when slot profiles are built.';
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
    close(sums.proteinG.min, dailyTargets.macroRanges.proteinG.min, 1e-6);
    close(sums.proteinG.max, dailyTargets.macroRanges.proteinG.max, 1e-6);
    close(sums.fatG.min, dailyTargets.macroRanges.fatG.min, 1e-6);
    close(sums.fatG.max, dailyTargets.macroRanges.fatG.max, 1e-6);
    close(sums.calories.min, dailyTargets.calories * 0.95, 1e-6);
    close(sums.calories.max, dailyTargets.calories * 1.05, 1e-6);

    for (const meal of meals) {
      const windows = meal.targets.macroWindows;
      assert(!Object.hasOwn(windows, 'carbG'), 'Section 8 must not store a static carb range');
      assert(windows.proteinG.min > 0);
      assert(windows.proteinG.min < windows.proteinG.max);
      assert(windows.fatG.min > 0);
      assert(windows.fatG.min < windows.fatG.max);
      assert.notEqual(windows.scaling.protein.minScale, windows.scaling.protein.maxScale);
      assert.notEqual(windows.scaling.fat.minScale, windows.scaling.fat.maxScale);
      close(windows.proteinG.min, windows.scaling.protein.raw.min * windows.scaling.protein.minScale, 1e-6);
      close(windows.proteinG.max, windows.scaling.protein.raw.max * windows.scaling.protein.maxScale, 1e-6);
      close(windows.fatG.min, windows.scaling.fat.raw.min * windows.scaling.fat.minScale, 1e-6);
      close(windows.fatG.max, windows.scaling.fat.raw.max * windows.scaling.fat.maxScale, 1e-6);
    }
  }

  assert.throws(() => buildScaledMealMacroWindows({
    calories: 1000,
    proteinG: 350,
    carbG: 0,
    fatG: 110,
    macroRanges: {
      proteinG: { min: 300, max: 400 },
      fatG: { min: 100, max: 120 },
    },
  }, [{
    name: 'Impossible Meal',
    tag: 'lunch',
    idealCaloriePercent: 1,
    macroCalorieRatio: {
      protein: { min: 0.20, max: 0.28 },
      fat: { min: 0.29, max: 0.41 },
    },
  }]), /INFEASIBLE/);
  return 'Protein/fat min and max sides are scaled separately to exact daily ranges; calories sum to +/-5%; infeasible windows throw before generation.';
});

check('1f.1 / Low-calorie floor scenarios still build meal windows', () => {
  const lowCalorieClients = [
    baseRaw({
      weightKg: 85,
      heightCm: 181,
      age: 25,
      sex: 'male',
      activityLevel: 'sedentary',
      goal: 'lose_weight',
      weeklyWeightLossPercent: 1,
    }),
    baseRaw({
      weightKg: 70,
      heightCm: 168,
      age: 50,
      sex: 'male',
      activityLevel: 'sedentary',
      goal: 'lose_weight',
      weeklyWeightLossPercent: 1,
    }),
    baseRaw({
      weightKg: 55,
      heightCm: 160,
      age: 45,
      sex: 'female',
      activityLevel: 'sedentary',
      goal: 'lose_weight',
      weeklyWeightLossPercent: 1,
    }),
    baseRaw({
      weightKg: 45,
      heightCm: 152,
      age: 60,
      sex: 'female',
      activityLevel: 'sedentary',
      goal: 'lose_weight',
      weeklyWeightLossPercent: 1,
    }),
  ];

  let combinations = 0;
  for (const raw of lowCalorieClients) {
    for (const numberOfMeals of [2, 3, 4, 5]) {
      for (const mealDistribution of Object.keys(MEAL_DISTRIBUTIONS)) {
        const input = normalizeInput({ ...raw, numberOfMeals, mealDistribution });
        const details = calculateNutritionDetails(input);
        close(details.targetCalories, NUTRITION.calorieFloorBySex[input.sex]);
        assert.equal(details.calorieFloorApplied, true);
        const meals = buildMealTargets(details.targets, input);
        assert.equal(meals.length, numberOfMeals);
        const sums = sumMealWindowBounds(meals);
        close(sums.calories.min, details.targetCalories * 0.95, 1e-6);
        close(sums.calories.max, details.targetCalories * 1.05, 1e-6);
        close(sums.proteinG.min, details.targets.macroRanges.proteinG.min, 1e-6);
        close(sums.proteinG.max, details.targets.macroRanges.proteinG.max, 1e-6);
        close(sums.fatG.min, details.targets.macroRanges.fatG.min, 1e-6);
        close(sums.fatG.max, details.targets.macroRanges.fatG.max, 1e-6);
        combinations += 1;
      }
    }
  }

  return `${combinations} floored low-calorie client x meal-distribution combinations build exact daily calorie/protein/fat windows.`;
});

check('1g / Section 9 Three hard constraints and ranking', () => {
  const mealTarget = syntheticMealTarget();
  const bounds = computeMealBounds(mealTarget);
  assert(!Object.hasOwn(bounds, 'carbG'));
  close(bounds.calories.min, 570);
  close(bounds.calories.max, 630);

  const cases = [
    ['A+B but carbs outside C', { calories: 600, proteinG: 30, carbG: 60, fatG: 20 }, false, 'meal_carbs'],
    ['A+C but protein outside B', { calories: 600, proteinG: 10, carbG: 95, fatG: 20 }, false, 'meal_protein'],
    ['B+C but calories outside A', { calories: 650, proteinG: 30, carbG: 75, fatG: 20 }, false, 'meal_calories'],
    ['all three pass', { calories: 600, proteinG: 30, carbG: 75, fatG: 20 }, true, null],
    ['lower boundary inclusive', { calories: 570, proteinG: 20, carbG: 100, fatG: 10 }, true, null],
    ['upper boundary inclusive', { calories: 630, proteinG: 40, carbG: 50, fatG: 30 }, true, null],
  ];
  for (const [name, totals, expectedValid, expectedViolation] of cases) {
    const result = validateMealSwap({ mealTarget, proposedMealTotals: totals });
    assert.equal(result.valid, expectedValid, name);
    if (expectedViolation) assert(result.violations.includes(expectedViolation), name);
  }

  const dynamic = requiredCarbWindowForCandidate({ calories: 600, proteinG: 30, carbG: 75, fatG: 20 }, bounds);
  close(dynamic.min, 67.5);
  close(dynamic.max, 82.5);

  const filtered = cases
    .map(([name, totals]) => ({ name, totals }))
    .filter((candidate) => validateMealSwap({ mealTarget, proposedMealTotals: candidate.totals }).valid);
  assert.deepEqual(filtered.map((candidate) => candidate.name), [
    'all three pass',
    'lower boundary inclusive',
    'upper boundary inclusive',
  ]);

  const rankingCandidates = [
    { id: 'calorie-close-but-not-exact', totals: { calories: 590, proteinG: 20, carbG: 82.5, fatG: 20 } },
    { id: 'exact-calories-poor-protein', totals: { calories: 600, proteinG: 40, carbG: 87.5, fatG: 10 } },
    { id: 'exact-calories-good-protein-poor-fat', totals: { calories: 600, proteinG: 32, carbG: 50.5, fatG: 30 } },
    { id: 'exact-calories-good-protein-good-fat', totals: { calories: 600, proteinG: 32, carbG: 75.25, fatG: 19 } },
  ].filter((candidate) => validateMealSwap({ mealTarget, proposedMealTotals: candidate.totals }).valid);
  rankingCandidates.sort((a, b) => compareTuples(mealRankTuple(a.totals, mealTarget), mealRankTuple(b.totals, mealTarget)));
  assert.deepEqual(rankingCandidates.map((candidate) => candidate.id), [
    'exact-calories-good-protein-good-fat',
    'exact-calories-good-protein-poor-fat',
    'exact-calories-poor-protein',
    'calorie-close-but-not-exact',
  ]);

  const emptyFiltered = [{ calories: 600, proteinG: 30, carbG: 60, fatG: 20 }]
    .filter((candidate) => validateMealSwap({ mealTarget, proposedMealTotals: candidate }).valid);
  assert.equal(emptyFiltered.length, 0);

  const dayCalories = [600, 700, 500, 700];
  close(dayCalories.reduce((sum, value) => sum + value * 1.05, 0), 2500 * 1.05);
  return 'A, B, and dynamic C are inclusive hard filters with no fallback; ranking is calorie, then protein midpoint, then fat midpoint.';
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
    { calories: slot.targets.calories, proteinG: 0, carbG: slot.targets.calories / 4, fatG: 0 },
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
    assert(totals.calories >= dailyTargets.calories * 0.95 - 1e-7);
    assert(totals.calories <= dailyTargets.calories * 1.05 + 1e-7);
    assert(totals.proteinG >= dailyTargets.macroRanges.proteinG.min - 1e-7);
    assert(totals.proteinG <= dailyTargets.macroRanges.proteinG.max + 1e-7);
    assert(totals.fatG >= dailyTargets.macroRanges.fatG.min - 1e-7);
    assert(totals.fatG <= dailyTargets.macroRanges.fatG.max + 1e-7);
  }
  return 'Repeated swaps use only the slot filtered set, leave stored windows unchanged, and keep daily calories/protein/fat in range.';
});

check('UI and document wiring expose the v9 policy surface', () => {
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
  assert(appJs.includes('target.macroWindows.calories.min -'));
  assert(!appJs.includes('target.macroWindows.carbG.min'));
  return 'Planner sends all required inputs and browser-side meal option checks use dynamic carbs.';
});

console.log('Nutrition Coaching Rules v9 Audit');
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
      total.calories.min += windows.calories.min;
      total.calories.max += windows.calories.max;
      total.proteinG.min += windows.proteinG.min;
      total.proteinG.max += windows.proteinG.max;
      total.fatG.min += windows.fatG.min;
      total.fatG.max += windows.fatG.max;
      return total;
    },
    {
      calories: { min: 0, max: 0 },
      proteinG: { min: 0, max: 0 },
      fatG: { min: 0, max: 0 },
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
      fatG: { min: 10, max: 30 },
    },
  };
}

function totalsAtWindowEdge(windows, edge) {
  const proteinG = windows.proteinG[edge];
  const fatG = windows.fatG[edge];
  const calories = windows.calories[edge];
  return {
    calories,
    proteinG,
    fatG,
    carbG: (calories - proteinG * 4 - fatG * 9) / 4,
  };
}

function compareTuples(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
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
