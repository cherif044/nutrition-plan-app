const {
  AMBIGUOUS_MEAL_SLOT_POLICY,
  MEAL_DISTRIBUTIONS,
  NUTRITION,
  RAMADAN_DISTRIBUTION,
  STANDARD_MEAL_SLOT_POLICY,
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

function calculateGoalCalories(input, maintenance) {
  if (input.goal === 'maintain') {
    return {
      targetCalories: maintenance,
      adjustmentCalories: 0,
    };
  }

  if (input.goal === 'gain_weight') {
    const surplus = input.gainSurplusCalories ?? NUTRITION.weightGain.defaultSurplusCalories;
    return {
      targetCalories: maintenance + surplus,
      adjustmentCalories: surplus,
    };
  }

  const weeklyPercent =
    input.weeklyWeightLossPercent ?? NUTRITION.weightLoss.defaultWeeklyPercent;
  const weeklyLossKg = input.weightKg * weeklyPercent / 100;
  const dailyDeficit = weeklyLossKg * NUTRITION.weightLoss.kcalPerKg / 7;
  const targetCalories = maintenance - dailyDeficit;

  return {
    targetCalories,
    adjustmentCalories: -dailyDeficit,
    requestedDailyDeficitCalories: dailyDeficit,
    weeklyWeightLossPercent: weeklyPercent,
  };
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
    ? AMBIGUOUS_MEAL_SLOT_POLICY[distribution]
    : numberOfMeals === 5
      ? AMBIGUOUS_MEAL_SLOT_POLICY[`${distribution}_5`]
      : STANDARD_MEAL_SLOT_POLICY[numberOfMeals];
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
      Math.max(MATRIX_EPSILON, rowCalories * profile.macroCalorieRatio.protein),
      Math.max(MATRIX_EPSILON, rowCalories * profile.macroCalorieRatio.carb),
      Math.max(MATRIX_EPSILON, rowCalories * profile.macroCalorieRatio.fat),
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
