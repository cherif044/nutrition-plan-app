const fs = require('fs');
const path = require('path');
const { generatePlan } = require('../src/services/planGenerator');
const { loadTemplates } = require('../src/repositories/templateRepository');
const { loadSwapSystem } = require('../src/repositories/swapSystemRepository');
const { NUTRITION, macrosForFoodPortion, sumTargets } = require('../src/services/nutritionService');

const templateFoodIds = new Set(loadTemplates().flatMap((t) => t.components.map((c) => c.foodId)));
const swapSystemFoodIds = new Set(
  Object.values(loadSwapSystem().swapGroups).flatMap((group) => group.foods),
);
const avoidSets = [
  [],
  ['chicken'],
  ['dairy'],
  ['nuts'],
  ['chicken', 'dairy'],
  ['dairy', 'nuts'],
  ['chicken', 'dairy', 'nuts'],
];

const fixedCases = [
  named('default standard', {}, { hardErrorAllowed: false }),
  named('four meals standard', { numberOfMeals: 4, numberOfSnacks: 1 }, { hardErrorAllowed: false }),
  named('default vegetarian', { dietType: 'vegetarian' }, { hardErrorAllowed: false }),
  named('default vegan', { dietType: 'vegan' }, { hardErrorAllowed: true }),
  named('avoid chicken dairy nuts', { avoidFoods: ['chicken', 'dairy', 'nuts'] }, { hardErrorAllowed: true }),
  named('zero snacks', { numberOfSnacks: 0 }, { hardErrorAllowed: false }),
  named('known mild warning standard', {
    weightKg: 70,
    heightCm: 173,
    bodyFatPercentage: 27,
    activityLevel: 'light',
    goal: 'lose_weight',
    dietType: 'standard',
    numberOfMeals: 6,
    numberOfSnacks: 2,
    avoidFoods: ['nuts'],
  }, { hardErrorAllowed: false }),
  named('two meals', { numberOfMeals: 2, numberOfSnacks: 0 }, { hardErrorAllowed: true }),
  named('six meals three snacks', { numberOfMeals: 6, numberOfSnacks: 3 }, { hardErrorAllowed: true }),
  named('ramadan split', { ramadanMode: true }, { hardErrorAllowed: true }),
  named('impossible-ish vegan nut dairy', {
    dietType: 'vegan',
    avoidFoods: ['nuts', 'dairy'],
    weightKg: 110,
    activityLevel: 'athlete',
    goal: 'gain_weight',
  }, { hardErrorAllowed: true }),
];

const matrixCases = [];
const goals = ['maintain', 'lose_weight', 'lose_weight_aggressive', 'gain_weight'];
const diets = ['standard', 'vegetarian', 'vegan'];
const mealCounts = [2, 3, 4, 5, 6];
const snackCounts = [0, 1, 2, 3];
const activityLevels = ['sedentary', 'light', 'moderate', 'very_active', 'athlete'];
const weights = [55, 70, 80, 100];

for (let i = 0; i < 96; i += 1) {
  const meals = mealCounts[i % mealCounts.length];
  const snacks = snackCounts[(i * 2) % snackCounts.length];
  matrixCases.push(named(`matrix ${i + 1}`, {
    weightKg: weights[(i * 3) % weights.length],
    heightCm: 170 + (i % 12),
    bodyFatPercentage: 18 + (i % 10),
    activityLevel: activityLevels[(i * 5 + 1) % activityLevels.length],
    goal: goals[(i * 7) % goals.length],
    dietType: diets[(i * 11) % diets.length],
    numberOfMeals: meals,
    numberOfSnacks: meals === 6 ? Math.min(3, snacks) : snacks,
    avoidFoods: avoidSets[(i * 13) % avoidSets.length],
  }, { hardErrorAllowed: true }));
}

const summary = {
  total: 0,
  passed: 0,
  warning: 0,
  hardError: 0,
  failed: 0,
  usableWorst: { calories: 0, proteinG: 0, carbG: 0, fatG: 0 },
  warningReasons: new Map(),
  hardErrorReasons: new Map(),
  warningExamples: [],
  hardErrorExamples: [],
  failures: [],
};

for (const testCase of [...fixedCases, ...matrixCases]) {
  summary.total += 1;
  try {
    const plan = generatePlan(testCase.input);
    const result = validatePlan(testCase, plan);
    const status = plan.diagnostics?.status ?? (plan.errors?.length ? 'error' : (plan.warnings?.length ? 'warning' : 'pass'));

    if (result.failures.length > 0) {
      recordFailure(testCase, result.failures, plan);
      continue;
    }

    if (status === 'error') {
      if (!testCase.expect.hardErrorAllowed) {
        recordFailure(testCase, ['unexpected hard error for feasible scenario'], plan);
        continue;
      }
      summary.hardError += 1;
      for (const error of plan.errors ?? plan.diagnostics?.errors ?? []) {
        summary.hardErrorReasons.set(error, (summary.hardErrorReasons.get(error) ?? 0) + 1);
      }
      if (summary.hardErrorExamples.length < 3) summary.hardErrorExamples.push(exampleFor(testCase, plan, result));
      continue;
    }

    for (const key of Object.keys(summary.usableWorst)) {
      if (result.residualPct[key] !== null) {
        summary.usableWorst[key] = Math.max(summary.usableWorst[key], result.residualPct[key]);
      }
    }

    if (status === 'warning') {
      summary.warning += 1;
      for (const warning of plan.warnings ?? []) {
        summary.warningReasons.set(warning, (summary.warningReasons.get(warning) ?? 0) + 1);
      }
      if (summary.warningExamples.length < 3) summary.warningExamples.push(exampleFor(testCase, plan, result));
    } else {
      summary.passed += 1;
    }
  } catch (error) {
    recordFailure(testCase, [`unexpected crash: ${error.message}`], null);
  }
}

regressionAssertTemplateBranchDoesNotAdjust();

console.log(`total cases run: ${summary.total}`);
console.log(`passed cases: ${summary.passed}`);
console.log(`warning cases: ${summary.warning}`);
console.log(`expected hard-error/impossible cases: ${summary.hardError}`);
console.log(`unexpected failed cases: ${summary.failed}`);
console.log(`worst calorie residual among usable plans: ${summary.usableWorst.calories.toFixed(1)}%`);
console.log(`worst protein residual among usable plans: ${summary.usableWorst.proteinG.toFixed(1)}%`);
console.log(`worst carb residual among usable plans: ${summary.usableWorst.carbG.toFixed(1)}%`);
console.log(`worst fat residual among usable plans: ${summary.usableWorst.fatG.toFixed(1)}%`);
printReasons('top warning reasons', summary.warningReasons);
printReasons('top hard-error reasons', summary.hardErrorReasons);
printExamples('mild warning examples', summary.warningExamples);
printExamples('hard error examples', summary.hardErrorExamples);

if (summary.failures.length > 0) {
  console.error(JSON.stringify(summary.failures.slice(0, 12), null, 2));
  process.exitCode = 1;
}

function named(name, overrides, expect = {}) {
  return {
    name,
    input: {
      weightKg: 80,
      heightCm: 175,
      bodyFatPercentage: 20,
      activityLevel: 'light',
      goal: 'maintain',
      numberOfMeals: 3,
      numberOfSnacks: 1,
      dietType: 'standard',
      milkType: 'skimmed',
      coffeesPerDay: 1,
      avoidFoods: [],
      ...overrides,
    },
    expect: { hardErrorAllowed: false, ...expect },
  };
}

function validatePlan(testCase, plan) {
  const failures = [];
  const warnings = plan.warnings ?? [];
  const errors = plan.errors ?? [];
  const status = plan.diagnostics?.status ?? (errors.length ? 'error' : (warnings.length ? 'warning' : 'pass'));
  const totals = totalsForPlan(plan);
  const residualPct = calculateResidualPercent(totals, plan.dailyTargets);

  for (const [key, pct] of Object.entries(residualPct)) {
    if (pct !== null && (!Number.isFinite(pct) || pct > 1000)) {
      failures.push(`${key} residual percent is not sane: ${pct}`);
    }
  }

  if (status === 'error') {
    if (errors.length === 0) failures.push('hard error status without error messages');
    if (plan.diagnostics?.missingSlots?.length && !errors.some((e) => plan.diagnostics.missingSlots.some((slot) => e.includes(slot)))) {
      failures.push('missing slots were not named in hard-error diagnostics');
    }
  } else {
    const withinTolerance =
      Math.abs(totals.calories - plan.dailyTargets.calories) <= plan.dailyTargets.calories * NUTRITION.calorieTolerancePercent &&
      Math.abs(totals.proteinG - plan.dailyTargets.proteinG) <= NUTRITION.proteinToleranceG &&
      Math.abs(totals.carbG - plan.dailyTargets.carbG) <= NUTRITION.carbToleranceG &&
      Math.abs(totals.fatG - plan.dailyTargets.fatG) <= NUTRITION.fatToleranceG;
    if (!withinTolerance && warnings.length === 0) {
      failures.push('usable plan outside tolerance without warning');
    }
  }

  const expectedMealCount = testCase.input.ramadanMode
    ? 3
    : testCase.input.numberOfMeals + testCase.input.numberOfSnacks;
  if (plan.meals.length !== expectedMealCount) {
    failures.push(`meal count ${plan.meals.length} did not match expected ${expectedMealCount}`);
  }

  for (const meal of plan.meals) {
    if (meal.items.length === 0) {
      if (status !== 'error' && !meal.unavailableReason) failures.push(`${meal.name} has no items without warning/error`);
      continue;
    }
    if (status !== 'error') {
      for (const key of ['calories', 'proteinG', 'carbG', 'fatG']) {
        if (Math.abs((meal.target?.[key] ?? NaN) - (meal.totals?.[key] ?? NaN)) > 0.01) {
          failures.push(`${meal.name} display target ${key} does not match accepted actual total`);
        }
      }
      if (!meal.seedTarget) {
        failures.push(`${meal.name} missing seedTarget`);
      }
    }
    if (meal.slotProfile && ['breakfast', 'snack'].includes(meal.tag)) {
      const hardMax = meal.slotProfile.hardMaxCaloriePercent * plan.dailyTargets.calories;
      if (meal.totals.calories > hardMax + 1) failures.push(`${meal.name} exceeds hard max calories`);
    }
    for (const item of meal.items) {
      if (!item.food || !item.food.id) failures.push(`${meal.name} contains invalid food`);
      if (!templateFoodIds.has(item.food.id) && !swapSystemFoodIds.has(item.food.id)) {
        failures.push(`${item.food.id} is outside mealTemplates.json and meal_swap_system.production.json`);
      }
      if (!Number.isFinite(item.quantityG) || item.quantityG <= 0) failures.push(`${meal.name} has invalid grams`);
      if (item.quantityG < item.food.minServingG - 0.01 || item.quantityG > item.food.maxServingG + 0.01) {
        failures.push(`${item.food.id} outside min/max serving`);
      }
      if (testCase.input.dietType === 'vegan' && !item.food.isVegan) failures.push(`${item.food.id} violates vegan filter`);
      if (testCase.input.dietType === 'vegetarian' && !item.food.isVegetarian) failures.push(`${item.food.id} violates vegetarian filter`);
      for (const term of testCase.input.avoidFoods ?? []) {
        if (foodMatchesAvoidTerm(item.food, term)) failures.push(`${item.food.id} violates avoid term ${term}`);
      }
      const displayed = macrosForFoodPortion(item.food, item.quantityG);
      if (Object.values(displayed).some((value) => !Number.isFinite(value))) failures.push(`${item.food.id} has NaN macro`);
    }
  }

  return { failures, totals, residualPct };
}

function recordFailure(testCase, failures, plan) {
  summary.failed += 1;
  summary.failures.push({ name: testCase.name, failures, warnings: plan?.warnings ?? [], errors: plan?.errors ?? [] });
}

function totalsForPlan(plan) {
  return sumTargets(
    plan.meals.flatMap((meal) =>
      meal.items.map((item) => macrosForFoodPortion(item.food, item.quantityG)),
    ),
  );
}

function calculateResidualPercent(totals, target) {
  return Object.fromEntries(
    Object.keys(totals).map((key) => {
      if (Math.abs(target[key]) < NUTRITION.residualPercentNearZeroTarget) return [key, null];
      return [key, Math.abs(totals[key] - target[key]) / Math.abs(target[key]) * 100];
    }),
  );
}

function foodMatchesAvoidTerm(food, term) {
  const normalized = String(term).toLowerCase();
  const haystack = [
    food.id,
    food.name,
    food.macroRole,
    food.subCategory,
    ...food.categories,
    ...food.allergens,
  ].filter(Boolean).join(' ').toLowerCase();

  const aliases = {
    dairy: ['dairy', 'milk', 'cheese', 'yogurt', 'whey', 'butter'],
    chicken: ['chicken', 'poultry'],
    nuts: ['nuts', 'nut', 'almond', 'walnut', 'peanut'],
  }[normalized] ?? [normalized];

  return aliases.some((alias) => haystack.includes(alias));
}

function regressionAssertTemplateBranchDoesNotAdjust() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'planGenerator.js'), 'utf8');
  const templateBranch = source.match(/if \(useTemplates && input\) \{[\s\S]*?\n  \}/);
  if (!templateBranch || templateBranch[0].includes('adjustPortions(')) {
    recordFailure({ name: 'template adjustPortions regression' }, ['solved templates must not be passed through adjustPortions'], null);
  }
}

function printReasons(label, reasons) {
  console.log(`${label}:`);
  if (reasons.size === 0) {
    console.log('- none');
    return;
  }
  for (const [reason, count] of [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`- ${count}x ${reason}`);
  }
}

function printExamples(label, examples) {
  console.log(`${label}:`);
  if (examples.length === 0) {
    console.log('- none');
    return;
  }
  examples.forEach((example, index) => {
    console.log(`${index + 1}. ${JSON.stringify(example)}`);
  });
}

function exampleFor(testCase, plan, result) {
  return {
    name: testCase.name,
    status: plan.diagnostics?.status,
    warnings: plan.warnings ?? [],
    errors: plan.errors ?? [],
    residualPct: Object.fromEntries(
      Object.entries(result.residualPct).map(([key, value]) => [key, value === null ? 'N/A' : Number(value.toFixed(1))]),
    ),
  };
}
