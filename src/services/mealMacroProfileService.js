const { loadFoods } = require('../repositories/foodRepository');
const { loadReadyMealBundles } = require('../repositories/readyMealRepository');
const { NUTRITION } = require('../config/nutritionConstants');

let cachedProfiles;

function getDatabaseMealMacroProfiles() {
  if (!cachedProfiles) {
    cachedProfiles = deriveMealMacroProfiles({
      readyMeals: loadReadyMealBundles(),
      foods: loadFoods(),
    });
  }
  return cachedProfiles;
}

function deriveMealMacroProfiles({ readyMeals, foods }) {
  if (!Array.isArray(readyMeals) || readyMeals.length === 0) {
    throw new Error('Meal macro profiles require ready-meal data.');
  }
  if (!Array.isArray(foods) || foods.length === 0) {
    throw new Error('Meal macro profiles require food nutrition data.');
  }

  const foodsByName = new Map(foods.map((food) => [normalizeName(food.name), food]));
  const samplesByTag = new Map();

  for (const meal of readyMeals) {
    const macroCalories = { protein: 0, carb: 0, fat: 0 };
    for (const component of meal.components || []) {
      const food = foodsByName.get(normalizeName(component.lookupName));
      if (!food) {
        throw new Error(`Ready-meal ingredient has no nutrition record: ${component.lookupName}`);
      }
      const servingFactor = Number(food.defaultServingG || 100) / 100;
      macroCalories.protein += Number(food.proteinGPer100g || 0) * servingFactor * NUTRITION.proteinKcalPerGram;
      macroCalories.carb += Number(food.carbGPer100g || 0) * servingFactor * NUTRITION.carbKcalPerGram;
      macroCalories.fat += Number(food.fatGPer100g || 0) * servingFactor * NUTRITION.fatKcalPerGram;
    }

    const total = macroCalories.protein + macroCalories.carb + macroCalories.fat;
    if (total <= 0) continue;
    const sample = {
      protein: macroCalories.protein / total,
      carb: macroCalories.carb / total,
      fat: macroCalories.fat / total,
    };
    const samples = samplesByTag.get(meal.mealTag) || [];
    samples.push(sample);
    samplesByTag.set(meal.mealTag, samples);
  }

  const profiles = {};
  for (const requiredTag of ['breakfast', 'lunch', 'dinner', 'snack']) {
    const samples = samplesByTag.get(requiredTag) || [];
    if (samples.length === 0) {
      throw new Error(`No database macro samples were available for ${requiredTag}.`);
    }
    const mean = samples.reduce(
      (total, sample) => ({
        protein: total.protein + sample.protein,
        carb: total.carb + sample.carb,
        fat: total.fat + sample.fat,
      }),
      { protein: 0, carb: 0, fat: 0 },
    );
    profiles[requiredTag] = {
      protein: mean.protein / samples.length,
      carb: mean.carb / samples.length,
      fat: mean.fat / samples.length,
      sourceCount: samples.length,
      source: 'ready_meal_database',
    };
  }

  const mainTags = ['breakfast', 'lunch', 'dinner'];
  const mainSourceCount = mainTags.reduce(
    (total, tag) => total + profiles[tag].sourceCount,
    0,
  );
  profiles.main = {
    protein: mainTags.reduce(
      (total, tag) => total + profiles[tag].protein * profiles[tag].sourceCount,
      0,
    ) / mainSourceCount,
    carb: mainTags.reduce(
      (total, tag) => total + profiles[tag].carb * profiles[tag].sourceCount,
      0,
    ) / mainSourceCount,
    fat: mainTags.reduce(
      (total, tag) => total + profiles[tag].fat * profiles[tag].sourceCount,
      0,
    ) / mainSourceCount,
    sourceCount: mainSourceCount,
    source: 'ready_meal_database',
  };

  return profiles;
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

module.exports = {
  deriveMealMacroProfiles,
  getDatabaseMealMacroProfiles,
};
