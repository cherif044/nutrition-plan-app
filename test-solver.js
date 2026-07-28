// Sanity checks for solvePortionsLeastSquares — run with: node test-solver.js
const {
  findBestPortionGridFit,
  rebalanceMeal,
  solvePortionsLeastSquares,
} = require('./src/services/planGenerator');

const PROTEIN_TOL = 10;
const CARB_TOL    = 15;
const FAT_TOL     = 10;

function makeFood(id, p, c, f, min = 20, max = 500) {
  return {
    id, name: id, nameAr: id,
    proteinGPer100g: p, carbGPer100g: c, fatGPer100g: f,
    caloriesPer100g: 4 * p + 4 * c + 9 * f,
    minServingG: min, maxServingG: max, defaultServingG: 100,
    macroRole: 'protein', mealTags: [], allergens: [], categories: [],
    isVegan: true, isVegetarian: true,
  };
}

function macros(items) {
  return items.reduce(
    (s, i) => ({
      kcal: s.kcal + (i.quantityG * i.food.caloriesPer100g) / 100,
      P: s.P + (i.quantityG * i.food.proteinGPer100g) / 100,
      C: s.C + (i.quantityG * i.food.carbGPer100g)    / 100,
      F: s.F + (i.quantityG * i.food.fatGPer100g)     / 100,
    }),
    { kcal: 0, P: 0, C: 0, F: 0 },
  );
}

let pass = 0;
let fail = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  PASS  ${msg}`);
    pass++;
  } else {
    console.error(`  FAIL  ${msg}`);
    fail++;
  }
}

// ─── Test 1: 3 foods with distinct macro ratios, solvable target ───────────
// Exact solution: chicken=96g, rice=200g, oil=20g
//   protein: 0.25*96 + 0.03*200 + 0*20  = 24 + 6       = 30g
//   carbs:   0*96    + 0.28*200 + 0*20  = 0 + 56        = 56g
//   fat:     0.03*96 + 0.01*200 + 1*20  = 2.88+2+20     = 24.88g
console.log('\nTest 1: 3 foods with distinct macro ratios — solvable target');
const chicken = makeFood('chicken', 25, 0,   3,  50, 300);
const rice    = makeFood('rice',     3, 28,  1,  50, 400);
const oil     = makeFood('oil',      0,  0, 100,  5,  50);
const target1 = { proteinG: 30, carbG: 56, fatG: 24.88 };
const items1  = [
  { food: chicken, quantityG: 100 },
  { food: rice,    quantityG: 100 },
  { food: oil,     quantityG: 10  },
];
const r1 = solvePortionsLeastSquares(items1, target1);
const m1 = macros(r1);
assert(Math.abs(m1.P - target1.proteinG) <= PROTEIN_TOL,
  `protein within ±${PROTEIN_TOL}g  (diff=${Math.abs(m1.P - target1.proteinG).toFixed(1)}g)`);
assert(Math.abs(m1.C - target1.carbG) <= CARB_TOL,
  `carbs within ±${CARB_TOL}g  (diff=${Math.abs(m1.C - target1.carbG).toFixed(1)}g)`);
assert(Math.abs(m1.F - target1.fatG) <= FAT_TOL,
  `fat within ±${FAT_TOL}g  (diff=${Math.abs(m1.F - target1.fatG).toFixed(1)}g)`);
r1.forEach((item) => {
  const { minServingG: lo, maxServingG: hi, id } = item.food;
  assert(item.quantityG >= lo && item.quantityG <= hi,
    `${id} grams in [${lo}, ${hi}]  (got ${item.quantityG}g)`);
});

// ─── Test 2: 2 foods, over-constrained (fat target unreachable) ────────────
// With only chicken and rice, best achievable fat ≈ 4.88g; target is 25g → infeasible.
console.log('\nTest 2: 2 foods, over-constrained — fat target unreachable');
const target2 = { proteinG: 30, carbG: 56, fatG: 25 };
const items2  = [
  { food: chicken, quantityG: 100 },
  { food: rice,    quantityG: 100 },
];
let threw = false;
let r2;
try {
  r2 = solvePortionsLeastSquares(items2, target2);
} catch {
  threw = true;
}
assert(!threw, 'solver does not throw on over-constrained input');
if (r2) {
  const m2 = macros(r2);
  const fatResidual = Math.abs(m2.F - target2.fatG);
  assert(fatResidual > FAT_TOL,
    `rebalance should treat this as infeasible (fat residual=${fatResidual.toFixed(1)}g > tol=${FAT_TOL}g)`);
  r2.forEach((item) => {
    const { minServingG: lo, maxServingG: hi, id } = item.food;
    assert(item.quantityG >= lo && item.quantityG <= hi,
      `${id} grams in [${lo}, ${hi}]  (got ${item.quantityG}g)`);
  });
}

// ─── Test 3: bounds never exceeded (summary) ──────────────────────────────
console.log('\nTest 3: bounds (already verified per item in Tests 1 & 2 above)');

// ─── Test 4: rebalance must not false-negative when a valid grid fit exists ──
console.log('\nTest 4: rebalance false-negative regression — brown bread swap');
const dinnerTarget = { calories: 761, proteinG: 53, carbG: 81, fatG: 25 };
const brownBreadSwapItems = [
  { foodId: 'bread_brown_whole_grain', quantityG: 30 },
  { foodId: 'chicken_breast_skinless_boneless_grilled', quantityG: 85 },
  { foodId: 'cheese_cheddar', quantityG: 40 },
  { foodId: 'nuts_almond_butter_without_salt', quantityG: 15 },
];
const rebalance = rebalanceMeal({
  mealTarget: dinnerTarget,
  items: brownBreadSwapItems,
});
assert(rebalance.success === true, 'rebalance finds a valid in-range solution from a bad swap starting point');
if (rebalance.success) {
  assert(Math.abs(rebalance.totals.proteinG - dinnerTarget.proteinG) <= dinnerTarget.proteinG * 0.10,
    `protein within meal bounds (got ${rebalance.totals.proteinG.toFixed(1)}g)`);
  assert(Math.abs(rebalance.totals.carbG - dinnerTarget.carbG) <= dinnerTarget.carbG * 0.10,
    `carbs within meal bounds (got ${rebalance.totals.carbG.toFixed(1)}g)`);
  assert(Math.abs(rebalance.totals.fatG - dinnerTarget.fatG) <= dinnerTarget.fatG * 0.10,
    `fat within meal bounds (got ${rebalance.totals.fatG.toFixed(1)}g)`);
  assert(Math.abs(rebalance.totals.calories - dinnerTarget.calories) <= 2500 * 0.05,
    `calories within ±5% of daily calories (got ${rebalance.totals.calories.toFixed(0)} kcal)`);
}

// ─── Test 5: exact 1g grid search finds a tight valid combination ─────────
console.log('\nTest 5: exact grid search — finds valid 1g gram distribution');
const exactProtein = makeFood('exact-protein', 10, 0, 0, 0, 150);
const exactCarb = makeFood('exact-carb', 0, 10, 0, 0, 150);
const exactFat = makeFood('exact-fat', 0, 0, 10, 0, 150);
const exactItems = [
  { food: exactProtein, quantityG: 10 },
  { food: exactCarb, quantityG: 10 },
  { food: exactFat, quantityG: 10 },
];
const exactTarget = {
  calories: 132.6,
  proteinG: 12.3,
  carbG: 8.7,
  fatG: 5.4,
};
const exactBounds = {
  calories: { min: 132.55, max: 132.65 },
  proteinG: { min: 12.25, max: 12.35 },
  carbG: { min: 8.65, max: 8.75 },
  fatG: { min: 5.35, max: 5.45 },
};
const exactFit = findBestPortionGridFit(exactItems, exactTarget, exactBounds, exactItems, {
  step: 1,
  maxVisits: 500000,
  maxMs: 1000,
});
assert(Boolean(exactFit), 'exact grid search returns a valid fit');
if (exactFit) {
  const exactMacros = macros(exactFit.items);
  assert(exactFit.exhaustive === true, 'small exact search completes exhaustively');
  assert(Math.abs(exactMacros.kcal - exactTarget.calories) <= 0.05,
    `calories exact within 1g grid (got ${exactMacros.kcal.toFixed(2)} kcal)`);
  assert(Math.abs(exactMacros.P - exactTarget.proteinG) <= 0.05,
    `protein exact within 1g grid (got ${exactMacros.P.toFixed(2)}g)`);
  assert(Math.abs(exactMacros.C - exactTarget.carbG) <= 0.05,
    `carbs exact within 1g grid (got ${exactMacros.C.toFixed(2)}g)`);
  assert(Math.abs(exactMacros.F - exactTarget.fatG) <= 0.05,
    `fat exact within 1g grid (got ${exactMacros.F.toFixed(2)}g)`);
}

// ─── Test 6: exact grid search rejects truly infeasible bounds ─────────────
console.log('\nTest 6: exact grid search — rejects infeasible bounds');
const infeasibleFit = findBestPortionGridFit(exactItems, {
  calories: 1000,
  proteinG: 200,
  carbG: 200,
  fatG: 200,
}, {
  calories: { min: 995, max: 1005 },
  proteinG: { min: 195, max: 205 },
  carbG: { min: 195, max: 205 },
  fatG: { min: 195, max: 205 },
}, exactItems, {
  step: 1,
  maxVisits: 500000,
  maxMs: 1000,
});
assert(infeasibleFit === null, 'exact grid search returns null when no gram combination can satisfy bounds');

// ─── Results ──────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
