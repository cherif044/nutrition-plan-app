const { MEAL_SPLITS, NUTRITION } = require('../config/nutritionConstants');

function calculateDailyTargets(input) {
  const maintenance = maintenanceCalories(input);
  const adjustment = NUTRITION.goalAdjustments[input.goal] ?? 0;
  const targetCalories = Math.max(1200, maintenance + adjustment);
  const proteinG = input.weightKg * NUTRITION.proteinPerKg;
  const fatG = input.weightKg * NUTRITION.fatPerKg;
  const proteinCalories = proteinG * NUTRITION.proteinKcalPerGram;
  const fatCalories = fatG * NUTRITION.fatKcalPerGram;
  const remainingCalories = Math.max(0, targetCalories - proteinCalories - fatCalories);

  return {
    calories: targetCalories,
    proteinG,
    carbG: remainingCalories / NUTRITION.carbKcalPerGram,
    fatG,
  };
}

function maintenanceCalories(input) {
  const bodyFat = input.bodyFatPercentage;
  if (bodyFat !== null && bodyFat > 0 && bodyFat < 70) {
    const leanBodyMass = input.weightKg * (1 - bodyFat / 100);
    const bmr =
      NUTRITION.katchMcArdleBase +
      NUTRITION.katchMcArdleLeanMassMultiplier * leanBodyMass;
    return bmr * (NUTRITION.activityMultipliers[input.activityLevel] ?? 1.2);
  }

  return input.weightKg * (NUTRITION.bodyweightActivityFactors[input.activityLevel] ?? 30);
}

function splitMeals(dailyTargets, input) {
  if (input.ramadanMode) {
    return MEAL_SPLITS.ramadanSplits.map((factor, index) => ({
      name: MEAL_SPLITS.ramadanNames[index],
      tag: MEAL_SPLITS.ramadanTags[index],
      targets: scaleTargets(dailyTargets, factor),
    }));
  }

  const snackTotalFactor = MEAL_SPLITS.snacks[input.numberOfSnacks] ?? 0;
  const mealFactors = MEAL_SPLITS.meals[input.numberOfMeals] ?? MEAL_SPLITS.meals[3];
  const mealTotalFactor = 1 - snackTotalFactor;
  const snackFactor = input.numberOfSnacks === 0 ? 0 : snackTotalFactor / input.numberOfSnacks;

  const targets = mealFactors.map((factor, index) => ({
    name: mealNameFor(index, mealFactors.length),
    tag: mealTagFor(index, mealFactors.length),
    targets: scaleTargets(dailyTargets, factor * mealTotalFactor),
  }));

  for (let index = 0; index < input.numberOfSnacks; index += 1) {
    targets.push({
      name: input.numberOfSnacks === 1 ? 'Snack' : `Snack ${index + 1}`,
      tag: 'snack',
      targets: scaleTargets(dailyTargets, snackFactor),
    });
  }

  return targets;
}

function mealNameFor(index, total) {
  if (total === 2) {
    return index === 0 ? 'Meal 1' : 'Meal 2';
  }
  if (index === 0) {
    return 'Breakfast';
  }
  if (index === total - 1) {
    return 'Dinner';
  }
  return total > 3 ? `Meal ${index + 1}` : 'Lunch';
}

function mealTagFor(index, total) {
  if (total === 2) {
    return index === 0 ? 'lunch' : 'dinner';
  }
  if (index === 0) {
    return 'breakfast';
  }
  if (index === total - 1) {
    return 'dinner';
  }
  return 'lunch';
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
  if (step <= 0) {
    return value;
  }
  return Math.round(value / step) * step;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

module.exports = {
  NUTRITION,
  calculateDailyTargets,
  splitMeals,
  macrosForFoodPortion,
  sumTargets,
  roundToNearest,
  clamp,
};
