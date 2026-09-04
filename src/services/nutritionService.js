const {
  AMBIGUOUS_MEAL_SLOT_POLICY,
  MEAL_DISTRIBUTIONS,
  NUTRITION,
  STANDARD_MEAL_SLOT_POLICY,
} = require('../config/nutritionConstants');

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
  const floorCalories = NUTRITION.calorieFloorBySex[input.sex];
  if (!Number.isFinite(floorCalories)) {
    throw new Error(`No calorie floor is configured for sex: ${input.sex}.`);
  }

  function withCalorieFloor(goalCalories, extras = {}) {
    const minimumTargetCalories = floorCalories / (1 - NUTRITION.dailyCalorieTolerancePercent);
    const targetCalories = Math.max(goalCalories, minimumTargetCalories);
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
    return withCalorieFloor(maintenance + NUTRITION.weightGain.surplusCalories);
  }

  const weeklyPercent = NUTRITION.weightLoss.weeklyPercent;
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
  const calories = {
    min: targetCalories * (1 - NUTRITION.dailyCalorieTolerancePercent),
    max: targetCalories * (1 + NUTRITION.dailyCalorieTolerancePercent),
  };
  return {
    proteinG: protein,
    carbG: carbRangeFromCaloriesProteinFat(calories, protein, fat),
    fatG: fat,
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

function buildMealTargets(dailyTargets, input) {
  const profiles = getMealSlotProfile(
    input.numberOfMeals,
    input.mealDistribution,
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
) {
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
  }));
}

function buildSlotProfile({
  name,
  tag,
  profileTag = tag,
  idealCaloriePercent,
}) {
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
  };
}

function fixedMacroRatioRangeFor(profileTag) {
  const ratioRange = NUTRITION.mealMacroRatioRanges[profileTag];
  if (!ratioRange) {
    throw new Error(`No meal macro ratio range is configured for profile: ${profileTag}.`);
  }
  return ratioRange;
}

function buildScaledMealMacroWindows(dailyTargets, profiles) {
  const dailyRanges = dailyTargets.macroRanges;
  if (!dailyRanges?.proteinG || !dailyRanges?.fatG) {
    throw new Error('Daily macro ranges must be provided by nutrition constants.');
  }
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
    return {
      calories: calorieWindow,
      proteinG,
      carbG: carbRangeFromCaloriesProteinFat(calorieWindow, proteinG, fatG),
      fatG,
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

function carbRangeFromCaloriesProteinFat(calories, proteinG, fatG) {
  return {
    min: Math.max(0, (
      calories.min -
      proteinG.max * NUTRITION.proteinKcalPerGram -
      fatG.max * NUTRITION.fatKcalPerGram
    ) / NUTRITION.carbKcalPerGram),
    max: (
      calories.max -
      proteinG.min * NUTRITION.proteinKcalPerGram -
      fatG.min * NUTRITION.fatKcalPerGram
    ) / NUTRITION.carbKcalPerGram,
  };
}

function rawMacroWindowFor(profile, dailyCalories, macro) {
  const ratioRange = profile.macroCalorieRatio[macro];
  if (!ratioRange || !Number.isFinite(ratioRange.min) || !Number.isFinite(ratioRange.max)) {
    throw new Error(`No ${macro} macro ratio range is configured for profile: ${profile.profileTag}.`);
  }
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

function distributeMacrosAcrossMeals(dailyTargets, profiles) {
  const rowTotals = profiles.map((profile) =>
    dailyTargets.calories * profile.idealCaloriePercent
  );
  const proteinCalories = distributeMacroCaloriesAcrossMeals(
    profiles,
    rowTotals,
    'protein',
    dailyTargets.proteinG * NUTRITION.proteinKcalPerGram,
  );
  const fatCalories = distributeMacroCaloriesAcrossMeals(
    profiles,
    rowTotals,
    'fat',
    dailyTargets.fatG * NUTRITION.fatKcalPerGram,
  );

  return rowTotals.map((calories, index) => {
    const proteinKcal = proteinCalories[index];
    const fatKcal = fatCalories[index];
    return {
      calories,
      proteinG: proteinKcal / NUTRITION.proteinKcalPerGram,
      carbG: (calories - proteinKcal - fatKcal) / NUTRITION.carbKcalPerGram,
      fatG: fatKcal / NUTRITION.fatKcalPerGram,
    };
  });
}

function distributeMacroCaloriesAcrossMeals(profiles, rowTotals, macro, totalMacroCalories) {
  if (!Number.isFinite(totalMacroCalories)) {
    throw new Error(`Daily ${macro} target must be finite.`);
  }

  const raw = profiles.map((profile, index) =>
    rowTotals[index] * ratioMidpoint(profile.macroCalorieRatio[macro])
  );
  const rawSum = sum(raw);
  if (rawSum <= 0) {
    throw new Error(`Meal ${macro} ratio ranges must produce a positive total.`);
  }

  return raw.map((value) => value * totalMacroCalories / rawSum);
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
