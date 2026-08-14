const assert = require('assert/strict');

const {
  MEAL_DISTRIBUTIONS,
  NUTRITION,
} = require('../src/config/nutritionConstants');
const {
  buildMealTargets,
  calculateNutritionDetails,
} = require('../src/services/nutritionService');
const {
  normalizeInput,
  requiredCarbWindowForCandidate,
  validateMealSwap,
} = require('../src/services/planGenerator');

const weights = [40, 55, 80, 100, 140, 180];
const heights = [150, 170, 190];
const ages = [18, 35, 65];
const sexes = ['male', 'female'];
const activities = ['sedentary', 'light', 'moderate', 'athlete'];
const goals = [
  { goal: 'maintain' },
  { goal: 'lose_weight', weeklyWeightLossPercent: 0.5 },
  { goal: 'lose_weight', weeklyWeightLossPercent: 1.0 },
  { goal: 'gain_weight', gainSurplusCalories: 200 },
  { goal: 'gain_weight', gainSurplusCalories: 300 },
];

let feasible = 0;
let infeasible = 0;
let checkedSlots = 0;
let boundaryCandidates = 0;
let calorieFloorCases = 0;

for (const weightKg of weights) {
  for (const heightCm of heights) {
    for (const age of ages) {
      for (const sex of sexes) {
        for (const activityLevel of activities) {
          for (const goalConfig of goals) {
            for (const numberOfMeals of [2, 3, 4, 5]) {
              for (const mealDistribution of Object.keys(MEAL_DISTRIBUTIONS)) {
                const input = normalizeInput({
                  weightKg,
                  heightCm,
                  age,
                  sex,
                  bodyFatPercentage: 20,
                  activityLevel,
                  numberOfMeals,
                  mealDistribution,
                  dietType: 'standard',
                  avoidFoods: [],
                  proteinPerKg: 2,
                  fatPerKg: 0.7,
                  ...goalConfig,
                });
                const nutritionDetails = calculateNutritionDetails(input);
                const dailyTargets = nutritionDetails.targets;
                const sexFloor = NUTRITION.calorieFloorBySex[input.sex];
                assert(
                  dailyTargets.calories >= sexFloor,
                  `${input.sex} target calories must not fall below ${sexFloor}`,
                );
                assert.equal(nutritionDetails.calorieFloorApplied, nutritionDetails.calculatedGoalCalories < sexFloor);
                if (nutritionDetails.calorieFloorApplied) {
                  calorieFloorCases += 1;
                  assertClose(dailyTargets.calories, sexFloor, 1e-7);
                  assertClose(dailyTargets.proteinG, input.weightKg * input.proteinPerKg, 1e-7);
                  assertClose(dailyTargets.fatG, input.weightKg * input.fatPerKg, 1e-7);
                  assertClose(
                    dailyTargets.carbG,
                    (
                      sexFloor -
                      dailyTargets.proteinG * NUTRITION.proteinKcalPerGram -
                      dailyTargets.fatG * NUTRITION.fatKcalPerGram
                    ) / NUTRITION.carbKcalPerGram,
                    1e-7,
                  );
                }
                try {
                  const meals = buildMealTargets(dailyTargets, input);
                  feasible += 1;
                  assert.equal(meals.length, numberOfMeals);
                  assertClose(sum(meals.map((meal) => meal.slotProfile.idealCaloriePercent)), 1);

                  const totals = {
                    calories: { min: 0, max: 0 },
                    proteinG: { min: 0, max: 0 },
                    fatG: { min: 0, max: 0 },
                  };
                  for (const meal of meals) {
                    checkedSlots += 1;
                    const windows = meal.targets.macroWindows;
                    assert(!Object.hasOwn(windows, 'carbG'));
                    totals.calories.min += windows.calories.min;
                    totals.calories.max += windows.calories.max;
                    totals.proteinG.min += windows.proteinG.min;
                    totals.proteinG.max += windows.proteinG.max;
                    totals.fatG.min += windows.fatG.min;
                    totals.fatG.max += windows.fatG.max;
                    assert(
                      windows.proteinG.max * NUTRITION.proteinKcalPerGram +
                        windows.fatG.max * NUTRITION.fatKcalPerGram <=
                        windows.calories.max + 1e-7,
                      'protein/fat ceilings must leave non-negative carb room',
                    );

                    for (const edge of ['min', 'max']) {
                      const candidate = candidateAtEdge(windows, edge);
                      const carbWindow = requiredCarbWindowForCandidate(candidate, windows);
                      assertClose(candidate.carbG, edge === 'min' ? carbWindow.min : carbWindow.max, 1e-7);
                      assert.equal(
                        validateMealSwap({ mealTarget: meal.targets, proposedMealTotals: candidate }).valid,
                        true,
                      );
                      boundaryCandidates += 1;
                    }
                  }
                  assertClose(totals.calories.min, dailyTargets.calories * 0.95, 1e-6);
                  assertClose(totals.calories.max, dailyTargets.calories * 1.05, 1e-6);
                  assertClose(totals.proteinG.min, dailyTargets.macroRanges.proteinG.min, 1e-6);
                  assertClose(totals.proteinG.max, dailyTargets.macroRanges.proteinG.max, 1e-6);
                  assertClose(totals.fatG.min, dailyTargets.macroRanges.fatG.min, 1e-6);
                  assertClose(totals.fatG.max, dailyTargets.macroRanges.fatG.max, 1e-6);
                } catch (error) {
                  assert.match(error.message, /INFEASIBLE/);
                  infeasible += 1;
                }
              }
            }
          }
        }
      }
    }
  }
}

console.log(JSON.stringify({
  status: 'passed',
  feasibleClientPlans: feasible,
  infeasibleClientPlans: infeasible,
  checkedMealSlots: checkedSlots,
  acceptedBoundaryCandidates: boundaryCandidates,
  calorieFloorCases,
}, null, 2));

function candidateAtEdge(windows, edge) {
  const calories = windows.calories[edge];
  const proteinG = windows.proteinG[edge];
  const fatG = windows.fatG[edge];
  return {
    calories,
    proteinG,
    fatG,
    carbG: (calories - proteinG * NUTRITION.proteinKcalPerGram - fatG * NUTRITION.fatKcalPerGram) /
      NUTRITION.carbKcalPerGram,
  };
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function assertClose(actual, expected, tolerance = 1e-9) {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `expected ${expected}, received ${actual}`,
  );
}
