const {
  AMBIGUOUS_MEAL_SLOT_POLICY,
  MEAL_DISTRIBUTIONS,
  NUTRITION,
  RAMADAN_DISTRIBUTION,
  STANDARD_MEAL_SLOT_POLICY,
} = require('../config/nutritionConstants');
const { getDatabaseMealMacroProfiles } = require('./mealMacroProfileService');

const MATRIX_EPSILON = 1e-9;
const DEFAULT_MAIN_PROFILE_TAG = 'lunch';

function calculateBmr(input) {
  const sexConstant = input.sex === 'male'
    ? NUTRITION.mifflinStJeor.maleConstant
    : NUTRITION.mifflinStJeor.femaleConstant;
  return (
    NUTRITION.mifflinStJeor.weightCoefficient * input.weightKg +
    NUTRITION.mifflinStJeor.heightCoefficient * input.heightCm -
    NUTRITION.mifflinStJeor.ageCoefficient * input.age +
    sexConstant
  );
}

function maintenanceCalories(input) {
  const multiplier = NUTRITION.activityMultipliers[input.activityLevel];
  if (!Number.isFinite(multiplier)) {
    throw new Error('Choose a valid activity level.');
  }
  return calculateBmr(input) * multiplier;
}

function calculateGoalCalories(input, maintenance) {
  const floorCalories = NUTRITION.calorieFloorBySex[input.sex] ?? 0;

  function withCalorieFloor(goalCalories, extras = {}) {
    const targetCalories = Math.max(goalCalories, floorCalories);
    return {
      ...extras,
      targetCalories,
      calculatedGoalCalories: goalCalories,
      calorieFloor: floorCalories,
      calorieFloorApplied: targetCalories > goalCalories,
      adjustmentCalories: targetCalories - maintenance,
    };
  }

  if (input.goal === 'maintain') {
    return withCalorieFloor(maintenance);
  }

  if (input.goal === 'gain_weight') {
    const surplus = input.gainSurplusCalories ?? NUTRITION.weightGain.defaultSurplusCalories;
    return withCalorieFloor(maintenance + surplus);
  }

  const weeklyPercent =
    input.weeklyWeightLossPercent ?? NUTRITION.weightLoss.defaultWeeklyPercent;
  const weeklyLossKg = input.weightKg * weeklyPercent / 100;
  const dailyDeficit = weeklyLossKg * NUTRITION.weightLoss.kcalPerKg / 7;
  const targetCalories = maintenance - dailyDeficit;

  return withCalorieFloor(targetCalories, {
    requestedDailyDeficitCalories: dailyDeficit,
    weeklyWeightLossPercent: weeklyPercent,
  });
}

function calculateMacroTargets(input, targetCalories) {
  const proteinFactor = input.proteinPerKg ?? NUTRITION.proteinPerKg.default;
  const fatFactor = input.fatPerKg ?? NUTRITION.fatPerKg.default;
  const proteinG = input.weightKg * proteinFactor;
  const fatG = input.weightKg * fatFactor;
  const remainingCalories =
    targetCalories -
    proteinG * NUTRITION.proteinKcalPerGram -
    fatG * NUTRITION.fatKcalPerGram;
  return {
    calories: targetCalories,
    proteinG,
    carbG: remainingCalories / NUTRITION.carbKcalPerGram,
    fatG,
    macroRanges: calculateDailyMacroRanges(input.weightKg, targetCalories),
  };
}

function calculateDailyMacroRanges(weightKg, targetCalories) {
  const protein = {
    min: weightKg * NUTRITION.proteinPerKg.minimum,
    max: weightKg * NUTRITION.proteinPerKg.maximum,
  };
  const fat = {
    min: weightKg * NUTRITION.fatPerKg.minimum,
    max: weightKg * NUTRITION.fatPerKg.maximum,
  };
  return {
    proteinG: protein,
    fatG: fat,
    carbG: {
      min: (
        targetCalories -
        protein.max * NUTRITION.proteinKcalPerGram -
        fat.max * NUTRITION.fatKcalPerGram
      ) / NUTRITION.carbKcalPerGram,
      max: (
        targetCalories -
        protein.min * NUTRITION.proteinKcalPerGram -
        fat.min * NUTRITION.fatKcalPerGram
      ) / NUTRITION.carbKcalPerGram,
    },
  };
}

function calculateNutritionDetails(input) {
  const bmr = calculateBmr(input);
  const maintenance = maintenanceCalories(input);
  const goal = calculateGoalCalories(input, maintenance);
  const targets = calculateMacroTargets(input, goal.targetCalories);
  return {
    bmr,
    maintenanceCalories: maintenance,
    targetCalories: goal.targetCalories,
    calculatedGoalCalories: goal.calculatedGoalCalories,
    calorieFloor: goal.calorieFloor,
    calorieFloorApplied: goal.calorieFloorApplied,
    adjustmentCalories: goal.adjustmentCalories,
    requestedDailyDeficitCalories: goal.requestedDailyDeficitCalories ?? null,
    weeklyWeightLossPercent: goal.weeklyWeightLossPercent ?? null,
    proteinPerKg: targets.proteinG / input.weightKg,
    fatPerKg: targets.fatG / input.weightKg,
    targets,
  };
}

function calculateDailyTargets(input) {
  return calculateNutritionDetails(input).targets;
}

function splitMeals(dailyTargets, input) {
  return buildMealTargets(dailyTargets, input);
}

function buildMealTargets(dailyTargets, input, databaseProfiles = getDatabaseMealMacroProfiles()) {
  const profiles = getMealSlotProfile(
    input.numberOfMeals,
    input.mealDistribution,
    input.ramadanMode,
    databaseProfiles,
  );
  const macroTargets = distributeMacrosAcrossMeals(dailyTargets, profiles);
  const macroWindows = buildScaledMealMacroWindows(dailyTargets, profiles);
  return profiles.map((profile, index) => ({
    name: profile.name,
    tag: profile.tag,
    targets: {
      ...macroTargets[index],
      macroWindows: macroWindows[index],
    },
    slotProfile: profile,
  }));
}

function getMealSlotProfile(
  numberOfMeals,
  distribution = 'balanced',
  ramadanSplit = false,
  databaseProfiles = getDatabaseMealMacroProfiles(),
) {
  if (ramadanSplit) {
    return RAMADAN_DISTRIBUTION.slots.map((slot, index) => buildSlotProfile({
      ...slot,
      idealCaloriePercent: RAMADAN_DISTRIBUTION.factors[index],
      databaseProfile: databaseProfiles[slot.profileTag],
    }));
  }

  const factors = MEAL_DISTRIBUTIONS[distribution]?.[numberOfMeals];
  if (!factors) {
    throw new Error('Choose a valid meal count and distribution.');
  }
  const slots = numberOfMeals === 2
    ? AMBIGUOUS_MEAL_SLOT_POLICY[distribution]
    : numberOfMeals === 5
      ? AMBIGUOUS_MEAL_SLOT_POLICY[`${distribution}_5`]
      : STANDARD_MEAL_SLOT_POLICY[numberOfMeals];
  if (!slots || slots.length !== factors.length) {
    throw new Error('Meal-slot policy is incomplete.');
  }

  return slots.map((slot, index) => buildSlotProfile({
    ...slot,
    profileTag: slot.profileTag ?? slot.tag,
    idealCaloriePercent: factors[index],
    databaseProfile: databaseProfiles[slot.profileTag ?? slot.tag],
  }));
}

function buildSlotProfile({
  name,
  tag,
  profileTag = tag,
  idealCaloriePercent,
  databaseProfile,
}) {
  if (!databaseProfile) {
    throw new Error(`No database macro profile is available for ${profileTag}.`);
  }
  const window = NUTRITION.mealSwapDailyCalorieWindowPercent;
  return {
    name,
    tag,
    profileTag,
    idealCaloriePercent,
    minCaloriePercent: Math.max(0, idealCaloriePercent - window),
    maxCaloriePercent: Math.min(1, idealCaloriePercent + window),
    hardMaxCaloriePercent: Math.min(1, idealCaloriePercent + window),
    macroCalorieRatio: fixedMacroRatioRangeFor(profileTag),
    macroProfileSource: databaseProfile.source,
    macroProfileSampleSize: databaseProfile.sourceCount,
  };
}

function fixedMacroRatioRangeFor(profileTag) {
  const tag = NUTRITION.mealMacroRatioRanges[profileTag]
    ? profileTag
    : DEFAULT_MAIN_PROFILE_TAG;
  const range = NUTRITION.mealMacroRatioRanges[tag];
  return {
    ...range,
    protein: {
      min: Math.max(range.protein.min, NUTRITION.minimumMealProteinCalorieRatio),
      max: Math.max(range.protein.max, NUTRITION.minimumMealProteinCalorieRatio),
    },
  };
}

function buildScaledMealMacroWindows(dailyTargets, profiles) {
  const dailyRanges = dailyTargets.macroRanges ?? calculateDailyMacroRangesFromTargets(dailyTargets);
  const rawProtein = profiles.map((profile) => rawMacroWindowFor(profile, dailyTargets.calories, 'protein'));
  const rawFat = profiles.map((profile) => rawMacroWindowFor(profile, dailyTargets.calories, 'fat'));
  const protein = scaleRawWindows(rawProtein, dailyRanges.proteinG);
  const fat = scaleRawWindows(rawFat, dailyRanges.fatG);

  return profiles.map((profile, index) => {
    const calories = dailyTargets.calories * profile.idealCaloriePercent;
    const calorieWindow = {
      min: calories * (1 - NUTRITION.mealSwapDailyCalorieWindowPercent),
      max: calories * (1 + NUTRITION.mealSwapDailyCalorieWindowPercent),
    };
    const proteinG = protein.windows[index];
    const fatG = fat.windows[index];
    const maximumProteinFatCalories =
      proteinG.max * NUTRITION.proteinKcalPerGram +
      fatG.max * NUTRITION.fatKcalPerGram;
    const minimumCarbCalories =
      NUTRITION.minimumAcceptableCarbsG * NUTRITION.carbKcalPerGram;
    if (maximumProteinFatCalories > calorieWindow.max - minimumCarbCalories) {
      throw new Error(
        `INFEASIBLE meal macro window for ${profile.name}: protein and fat ceilings leave no acceptable carb room.`,
      );
    }
    return {
      calories: calorieWindow,
      proteinG,
      fatG,
      infeasibility: {
        maximumProteinFatCalories,
        minimumAcceptableCarbsG: NUTRITION.minimumAcceptableCarbsG,
      },
      scaling: {
        protein: {
          raw: rawProtein[index],
          minScale: protein.minScale,
          maxScale: protein.maxScale,
        },
        fat: {
          raw: rawFat[index],
          minScale: fat.minScale,
          maxScale: fat.maxScale,
        },
      },
    };
  });
}

function rawMacroWindowFor(profile, dailyCalories, macro) {
  const ratioRange = profile.macroCalorieRatio[macro];
  const mealCalories = dailyCalories * profile.idealCaloriePercent;
  const kcalPerGram = macro === 'fat'
    ? NUTRITION.fatKcalPerGram
    : NUTRITION.proteinKcalPerGram;
  return {
    min: mealCalories * ratioRange.min / kcalPerGram,
    max: mealCalories * ratioRange.max / kcalPerGram,
  };
}

function scaleRawWindows(rawWindows, dailyRange) {
  const rawMinSum = sum(rawWindows.map((window) => window.min));
  const rawMaxSum = sum(rawWindows.map((window) => window.max));
  const minScale = dailyRange.min / rawMinSum;
  const maxScale = dailyRange.max / rawMaxSum;
  return {
    minScale,
    maxScale,
    windows: rawWindows.map((window) => ({
      min: window.min * minScale,
      max: window.max * maxScale,
    })),
  };
}

function calculateDailyMacroRangesFromTargets(dailyTargets) {
  return {
    proteinG: { min: dailyTargets.proteinG, max: dailyTargets.proteinG },
    fatG: { min: dailyTargets.fatG, max: dailyTargets.fatG },
    carbG: { min: dailyTargets.carbG, max: dailyTargets.carbG },
  };
}

function distributeMacrosAcrossMeals(dailyTargets, profiles) {
  const rowTotals = profiles.map((profile) =>
    dailyTargets.calories * profile.idealCaloriePercent
  );
  const columnTotals = {
    protein: dailyTargets.proteinG * NUTRITION.proteinKcalPerGram,
    carb: dailyTargets.carbG * NUTRITION.carbKcalPerGram,
    fat: dailyTargets.fatG * NUTRITION.fatKcalPerGram,
  };
  if (Object.values(columnTotals).some((value) => value < 0)) {
    return rowTotals.map((calories, index) => {
      const factor = profiles[index].idealCaloriePercent;
      return {
        calories,
        proteinG: dailyTargets.proteinG * factor,
        carbG: dailyTargets.carbG * factor,
        fatG: dailyTargets.fatG * factor,
      };
    });
  }

  const prior = profiles.map((profile, index) => {
    const rowCalories = rowTotals[index];
    return [
      Math.max(MATRIX_EPSILON, rowCalories * ratioMidpoint(profile.macroCalorieRatio.protein)),
      Math.max(MATRIX_EPSILON, rowCalories * ratioMidpoint(profile.macroCalorieRatio.carb)),
      Math.max(MATRIX_EPSILON, rowCalories * ratioMidpoint(profile.macroCalorieRatio.fat)),
    ];
  });
  const matrix = balanceMacroMatrix(
    prior,
    rowTotals,
    [columnTotals.protein, columnTotals.carb, columnTotals.fat],
  );

  return matrix.map((row, index) => {
    return {
      calories: rowTotals[index],
      proteinG: row[0] / NUTRITION.proteinKcalPerGram,
      carbG: row[1] / NUTRITION.carbKcalPerGram,
      fatG: row[2] / NUTRITION.fatKcalPerGram,
    };
  });
}

function balanceMacroMatrix(prior, rowTotals, columnTotals) {
  const matrix = prior.map((row) => [...row]);
  for (let iteration = 0; iteration < 500; iteration += 1) {
    for (let column = 0; column < columnTotals.length; column += 1) {
      const current = sum(matrix.map((row) => row[column]));
      const scale = columnTotals[column] / Math.max(MATRIX_EPSILON, current);
      for (const row of matrix) row[column] *= scale;
    }
    for (let rowIndex = 0; rowIndex < rowTotals.length; rowIndex += 1) {
      const current = sum(matrix[rowIndex]);
      const scale = rowTotals[rowIndex] / Math.max(MATRIX_EPSILON, current);
      matrix[rowIndex] = matrix[rowIndex].map((value) => value * scale);
    }

    const rowError = Math.max(...matrix.map((row, index) =>
      Math.abs(sum(row) - rowTotals[index])
    ));
    const columnError = Math.max(...columnTotals.map((target, column) =>
      Math.abs(sum(matrix.map((row) => row[column])) - target)
    ));
    if (rowError < 1e-7 && columnError < 1e-7) break;
  }
  return matrix;
}

function scaleTargets(targets, factor) {
  return {
    calories: targets.calories * factor,
    proteinG: targets.proteinG * factor,
    carbG: targets.carbG * factor,
    fatG: targets.fatG * factor,
  };
}

function ratioMidpoint(rangeOrValue) {
  if (Number.isFinite(rangeOrValue)) return rangeOrValue;
  return (rangeOrValue.min + rangeOrValue.max) / 2;
}

function macrosForFoodPortion(food, quantityG) {
  const multiplier = quantityG / 100;
  return {
    calories: food.caloriesPer100g * multiplier,
    proteinG: food.proteinGPer100g * multiplier,
    carbG: food.carbGPer100g * multiplier,
    fatG: food.fatGPer100g * multiplier,
  };
}

function sumTargets(values) {
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

function roundToNearest(value, step) {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

module.exports = {
  NUTRITION,
  balanceMacroMatrix,
  buildMealTargets,
  calculateBmr,
  calculateDailyTargets,
  calculateDailyMacroRanges,
  calculateGoalCalories,
  calculateMacroTargets,
  calculateNutritionDetails,
  buildScaledMealMacroWindows,
  distributeMacrosAcrossMeals,
  getMealSlotProfile,
  macrosForFoodPortion,
  maintenanceCalories,
  roundToNearest,
  scaleTargets,
  splitMeals,
  sumTargets,
  clamp,
};
