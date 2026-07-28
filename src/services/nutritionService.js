const {
  MEAL_DISTRIBUTIONS,
  MEAL_SLOT_POLICY,
  NUTRITION,
  RAMADAN_DISTRIBUTION,
  TWO_MEAL_SLOT_POLICY,
} = require('../config/nutritionConstants');
const { getDatabaseMealMacroProfiles } = require('./mealMacroProfileService');

const MATRIX_EPSILON = 1e-9;

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

function calculateGoalCalories(input, maintenance, bmr) {
  if (input.goal === 'maintain') {
    return {
      targetCalories: maintenance,
      adjustmentCalories: 0,
      safetyFloorCalories: null,
    };
  }

  if (input.goal === 'gain_weight') {
    const surplus = input.gainSurplusCalories ?? NUTRITION.weightGain.defaultSurplusCalories;
    return {
      targetCalories: maintenance + surplus,
      adjustmentCalories: surplus,
      safetyFloorCalories: null,
    };
  }

  const weeklyPercent =
    input.weeklyWeightLossPercent ?? NUTRITION.weightLoss.defaultWeeklyPercent;
  const weeklyLossKg = input.weightKg * weeklyPercent / 100;
  const dailyDeficit = weeklyLossKg * NUTRITION.weightLoss.kcalPerKg / 7;
  const absoluteFloor = input.sex === 'male'
    ? NUTRITION.calorieFloor.maleAbsolute
    : NUTRITION.calorieFloor.femaleAbsolute;
  const safetyFloorCalories = Math.max(
    bmr * NUTRITION.calorieFloor.bmrMultiplier,
    absoluteFloor,
  );
  const targetCalories = Math.max(maintenance - dailyDeficit, safetyFloorCalories);

  return {
    targetCalories,
    adjustmentCalories: targetCalories - maintenance,
    requestedDailyDeficitCalories: dailyDeficit,
    safetyFloorCalories,
    weeklyWeightLossPercent: weeklyPercent,
  };
}

function calculateMacroTargets(input, targetCalories) {
  const proteinFactor = input.proteinPerKg ?? NUTRITION.proteinPerKg.default;
  const preferredFatFactor = input.fatPerKg ?? NUTRITION.fatPerKg.default;
  let proteinG = input.weightKg * proteinFactor;
  let fatG = input.weightKg * preferredFatFactor;

  const minimumProteinG = input.weightKg * NUTRITION.proteinPerKg.minimum;
  const minimumFatG = input.weightKg * NUTRITION.fatPerKg.minimum;
  const proteinCalories = () => proteinG * NUTRITION.proteinKcalPerGram;
  const fatCalories = () => fatG * NUTRITION.fatKcalPerGram;

  if (proteinCalories() + fatCalories() > targetCalories) {
    fatG = Math.max(
      minimumFatG,
      (targetCalories - proteinCalories()) / NUTRITION.fatKcalPerGram,
    );
  }

  if (proteinCalories() + fatCalories() > targetCalories) {
    proteinG = Math.max(
      minimumProteinG,
      (targetCalories - fatCalories()) / NUTRITION.proteinKcalPerGram,
    );
  }

  if (proteinCalories() + fatCalories() > targetCalories + 1e-6) {
    throw new Error(
      'The calorie target is too low to satisfy the minimum protein and fat ranges safely.',
    );
  }

  const remainingCalories = targetCalories - proteinCalories() - fatCalories();
  return {
    calories: targetCalories,
    proteinG,
    carbG: Math.max(0, remainingCalories) / NUTRITION.carbKcalPerGram,
    fatG,
  };
}

function calculateNutritionDetails(input) {
  const bmr = calculateBmr(input);
  const maintenance = maintenanceCalories(input);
  const goal = calculateGoalCalories(input, maintenance, bmr);
  const targets = calculateMacroTargets(input, goal.targetCalories);
  return {
    bmr,
    maintenanceCalories: maintenance,
    targetCalories: goal.targetCalories,
    adjustmentCalories: goal.adjustmentCalories,
    safetyFloorCalories: goal.safetyFloorCalories,
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
  return profiles.map((profile, index) => ({
    name: profile.name,
    tag: profile.tag,
    targets: macroTargets[index],
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
    ? TWO_MEAL_SLOT_POLICY[distribution]
    : MEAL_SLOT_POLICY[numberOfMeals];
  if (!slots || slots.length !== factors.length) {
    throw new Error('Meal-slot policy is incomplete.');
  }

  return slots.map((slot, index) => buildSlotProfile({
    ...slot,
    profileTag: slot.tag,
    idealCaloriePercent: factors[index],
    databaseProfile: databaseProfiles[slot.tag],
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
    macroCalorieRatio: {
      protein: databaseProfile.protein,
      carb: databaseProfile.carb,
      fat: databaseProfile.fat,
    },
    macroProfileSource: databaseProfile.source,
    macroProfileSampleSize: databaseProfile.sourceCount,
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
  const proteinFloors = rowTotals.map((rowCalories) =>
    columnTotals.protein *
    (rowCalories / dailyTargets.calories) *
    NUTRITION.databaseProteinFloorFraction
  );
  const residualRows = rowTotals.map((row, index) => row - proteinFloors[index]);
  const residualColumns = [
    columnTotals.protein - sum(proteinFloors),
    columnTotals.carb,
    columnTotals.fat,
  ];
  const prior = profiles.map((profile, index) => {
    const rowCalories = rowTotals[index];
    return [
      Math.max(
        MATRIX_EPSILON,
        rowCalories * profile.macroCalorieRatio.protein - proteinFloors[index],
      ),
      Math.max(MATRIX_EPSILON, rowCalories * profile.macroCalorieRatio.carb),
      Math.max(MATRIX_EPSILON, rowCalories * profile.macroCalorieRatio.fat),
    ];
  });
  const residualMatrix = balanceMacroMatrix(prior, residualRows, residualColumns);

  return residualMatrix.map((row, index) => {
    const proteinCalories = row[0] + proteinFloors[index];
    const carbCalories = row[1];
    const fatCalories = row[2];
    return {
      calories: rowTotals[index],
      proteinG: proteinCalories / NUTRITION.proteinKcalPerGram,
      carbG: carbCalories / NUTRITION.carbKcalPerGram,
      fatG: fatCalories / NUTRITION.fatKcalPerGram,
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

function dailyMacroRanges(weightKg) {
  return {
    proteinG: {
      min: weightKg * NUTRITION.proteinPerKg.minimum,
      max: weightKg * NUTRITION.proteinPerKg.maximum,
    },
    fatG: {
      min: weightKg * NUTRITION.fatPerKg.minimum,
      max: weightKg * NUTRITION.fatPerKg.maximum,
    },
  };
}

function scaleTargets(targets, factor) {
  return {
    calories: targets.calories * factor,
    proteinG: targets.proteinG * factor,
    carbG: targets.carbG * factor,
    fatG: targets.fatG * factor,
  };
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
  calculateGoalCalories,
  calculateMacroTargets,
  calculateNutritionDetails,
  dailyMacroRanges,
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
