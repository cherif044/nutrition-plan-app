const { loadFoods } = require('../data/foodRepository');
const { normalizeToken, resolvePreferenceTerms } = require('../config/preferenceTaxonomy');
const {
  NUTRITION,
  calculateDailyTargets,
  splitMeals,
  macrosForFoodPortion,
  sumTargets,
  roundToNearest,
  clamp,
} = require('./nutritionService');

const ACTIVITY_LEVELS = new Set(['sedentary', 'light', 'moderate', 'very_active', 'athlete']);
const GOALS = new Set(['maintain', 'lose_weight', 'lose_weight_aggressive', 'gain_weight']);
const DIETS = new Set(['standard', 'vegetarian', 'vegan']);

function getFoods() {
  return loadFoods();
}

function generatePlan(rawInput) {
  const input = normalizeInput(rawInput);
  const dailyTargets = calculateDailyTargets(input);
  const mealTargets = splitMeals(dailyTargets, input);
  const allowedFoods = filterFoods(loadFoods(), input);

  if (allowedFoods.length === 0) {
    throw new Error('No foods match the selected restrictions. Try removing one filter.');
  }

  const meals = mealTargets.map((target, index) =>
    generateMeal({ target, allowedFoods, mealIndex: index }),
  );

  return {
    input,
    dailyTargets,
    meals,
  };
}

function normalizeInput(input = {}) {
  const weightKg = Number(input.weightKg);
  const heightCm = Number(input.heightCm);
  const bodyFatValue =
    input.bodyFatPercentage === '' || input.bodyFatPercentage === undefined
      ? null
      : Number(input.bodyFatPercentage);
  const activityLevel = String(input.activityLevel || 'moderate');
  const goal = String(input.goal || 'maintain');
  const dietType = String(input.dietType || 'standard');
  const numberOfMeals = Number.parseInt(input.numberOfMeals ?? 3, 10);
  const numberOfSnacks = Number.parseInt(input.numberOfSnacks ?? 1, 10);
  const coffeesPerDay = Number.parseInt(input.coffeesPerDay ?? 0, 10);

  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    throw new Error('Enter a valid weight.');
  }
  if (!Number.isFinite(heightCm) || heightCm <= 0) {
    throw new Error('Enter a valid height.');
  }
  if (bodyFatValue !== null && (!Number.isFinite(bodyFatValue) || bodyFatValue <= 0 || bodyFatValue >= 70)) {
    throw new Error('Body fat should be between 1 and 69%.');
  }
  if (!ACTIVITY_LEVELS.has(activityLevel)) {
    throw new Error('Choose a valid activity level.');
  }
  if (!GOALS.has(goal)) {
    throw new Error('Choose a valid goal.');
  }
  if (!DIETS.has(dietType)) {
    throw new Error('Choose a valid diet type.');
  }
  if (![2, 3, 4, 5].includes(numberOfMeals)) {
    throw new Error('Meals must be between 2 and 5.');
  }
  if (![0, 1, 2].includes(numberOfSnacks)) {
    throw new Error('Snacks must be between 0 and 2.');
  }

  return {
    weightKg,
    heightCm,
    bodyFatPercentage: bodyFatValue,
    activityLevel,
    goal,
    numberOfMeals,
    numberOfSnacks,
    dietType,
    allergies: normalizeList(input.allergies),
    dislikes: normalizeList(input.dislikes),
    milkType: String(input.milkType || '').trim(),
    coffeesPerDay: Number.isFinite(coffeesPerDay) ? Math.max(0, coffeesPerDay) : 0,
    ramadanMode: Boolean(input.ramadanMode),
  };
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function filterFoods(foods, input) {
  const foodIds = new Set(foods.map((food) => food.id));
  const categoryIds = new Set(foods.flatMap((food) => food.categories));
  const allergies = resolvePreferenceTerms(input.allergies);
  const dislikes = resolvePreferenceTerms(input.dislikes);
  const unknownTerms = [...allergies.unknownTerms, ...dislikes.unknownTerms];
  const unknownFoodIds = [...allergies.selectedIds, ...dislikes.selectedIds].filter(
    (id) => !foodIds.has(id),
  );
  const unknownCategoryIds = [...input.allergies, ...input.dislikes]
    .filter((term) => term.startsWith('category:'))
    .map((term) => term.slice(9))
    .filter((id) => !categoryIds.has(id));

  if (unknownTerms.length > 0) {
    throw new Error(
      `Choose allergies and dislikes from the suggestion list only: ${unknownTerms.join(', ')}.`,
    );
  }
  if (unknownFoodIds.length > 0) {
    throw new Error(
      `Choose allergies and dislikes from the suggestion list only: ${unknownFoodIds.join(', ')}.`,
    );
  }
  if (unknownCategoryIds.length > 0) {
    throw new Error(
      `Choose allergies and dislikes from the suggestion list only: ${unknownCategoryIds.join(', ')}.`,
    );
  }

  return foods.filter((food) => {
    if (input.dietType === 'vegan' && !food.isVegan) {
      return false;
    }
    if (input.dietType === 'vegetarian' && !food.isVegetarian) {
      return false;
    }
    const foodTerms = searchableTermsForFood(food);

    if (hasSemanticMatch(foodTerms, allergies.semanticTags)) {
      return false;
    }
    if (allergies.selectedIds.has(food.id)) {
      return false;
    }
    if (dislikes.selectedIds.has(food.id)) {
      return false;
    }
    if (hasSemanticMatch(foodTerms, dislikes.semanticTags)) {
      return false;
    }

    return true;
  });
}

function searchableTermsForFood(food) {
  return new Set(
    [
      food.id,
      food.name,
      food.nameAr,
      food.macroRole,
      ...food.allergens,
      ...food.categories,
    ]
      .filter(Boolean)
      .map(normalizeToken),
  );
}

function hasSemanticMatch(foodTerms, selectedTerms) {
  for (const term of selectedTerms) {
    if (foodTerms.has(normalizeToken(term))) {
      return true;
    }
  }

  return false;
}

function generateMeal({ target, allowedFoods, mealIndex }) {
  let bestMeal = null;
  let bestScore = Infinity;

  for (let attempt = 0; attempt < NUTRITION.maxMealAttempts; attempt += 1) {
    const items = selectInitialItems({
      target,
      allowedFoods,
      seed: mealIndex + attempt,
    });
    const adjusted = adjustPortions(items, target.targets);
    const approximate = !isWithinTolerance(adjusted, target.targets);
    const score = mealScore(adjusted, target.targets);
    const withAlternatives = adjusted.map((item) => ({
      ...item,
      alternatives: alternativesFor({
        original: item.food,
        allowedFoods,
        mealTag: target.tag,
      }),
      totals: macrosForFoodPortion(item.food, item.quantityG),
    }));

    const meal = {
      name: target.name,
      tag: target.tag,
      target: target.targets,
      items: withAlternatives,
      totals: sumTargets(withAlternatives.map((item) => item.totals)),
      isApproximate: approximate,
    };

    if (!approximate) {
      return meal;
    }

    if (score < bestScore) {
      bestScore = score;
      bestMeal = meal;
    }
  }

  return (
    bestMeal || {
      name: target.name,
      tag: target.tag,
      target: target.targets,
      items: [],
      totals: { calories: 0, proteinG: 0, carbG: 0, fatG: 0 },
      isApproximate: true,
    }
  );
}

function selectInitialItems({ target, allowedFoods, seed }) {
  const proteinFoods = foodsForRole(allowedFoods, 'protein', target.tag);
  const carbFoods = foodsForRole(allowedFoods, 'carb', target.tag);
  const fatFoods = foodsForRole(allowedFoods, 'fat', target.tag);
  const mixedFoods = foodsForRole(allowedFoods, 'mixed', target.tag);
  const items = [];

  const protein = pick(proteinFoods, seed) || pick(mixedFoods, seed);
  const carb = pick(carbFoods, seed + 1) || pick(mixedFoods, seed + 1);
  const fat = pick(fatFoods, seed + 2);
  const mixed = target.tag === 'snack' ? null : pick(mixedFoods, seed + 3);

  if (protein) {
    items.push(defaultItem(protein));
  }
  if (carb && carb.id !== protein?.id) {
    items.push(defaultItem(carb));
  }
  if (fat && fat.id !== protein?.id && fat.id !== carb?.id) {
    items.push(defaultItem(fat));
  }
  if (mixed && items.every((item) => item.food.id !== mixed.id) && target.targets.calories > 450) {
    items.push(defaultItem(mixed, 0.55));
  }
  if (items.length === 0) {
    const anyFood = pick(allowedFoods, seed);
    if (anyFood) {
      items.push(defaultItem(anyFood));
    }
  }

  return items;
}

function foodsForRole(foods, role, mealTag) {
  return foods.filter((food) => food.macroRole === role && food.mealTags.includes(mealTag));
}

function pick(foods, seed) {
  if (foods.length === 0) {
    return null;
  }
  return foods[Math.abs(seed) % foods.length];
}

function defaultItem(food, scale = 1) {
  return {
    food,
    quantityG: clampServing(food, food.defaultServingG * scale),
    alternatives: [],
  };
}

function adjustPortions(initialItems, target) {
  let items = initialItems.map((item) => ({ ...item }));

  for (let index = 0; index < NUTRITION.maxPortionAdjustmentIterations; index += 1) {
    const totals = totalsForItems(items);
    const proteinDiff = target.proteinG - totals.proteinG;
    const fatDiff = target.fatG - totals.fatG;
    const calorieDiff = target.calories - totals.calories;
    const proteinIndex = firstIndexForRole(items, 'protein') ?? firstIndexForRole(items, 'mixed');
    const fatIndex = firstIndexForRole(items, 'fat');
    const carbIndex = firstIndexForRole(items, 'carb') ?? firstIndexForRole(items, 'mixed');

    if (proteinIndex !== null && Math.abs(proteinDiff) > NUTRITION.proteinToleranceG / 2) {
      items = replaceAt(
        items,
        proteinIndex,
        adjustByMacro(items[proteinIndex], proteinDiff, items[proteinIndex].food.proteinGPer100g),
      );
      continue;
    }

    if (fatIndex !== null && Math.abs(fatDiff) > NUTRITION.fatToleranceG / 2) {
      items = replaceAt(
        items,
        fatIndex,
        adjustByMacro(items[fatIndex], fatDiff, items[fatIndex].food.fatGPer100g),
      );
      continue;
    }

    if (carbIndex !== null && Math.abs(calorieDiff) > target.calories * 0.05) {
      items = replaceAt(items, carbIndex, adjustByCalories(items[carbIndex], calorieDiff));
      continue;
    }

    break;
  }

  return items.map((item) => ({
    ...item,
    quantityG: roundToNearest(item.quantityG, 5),
  }));
}

function adjustByMacro(item, macroDiff, per100g) {
  if (per100g <= 0) {
    return item;
  }
  const deltaG = macroDiff / (per100g / 100);
  return { ...item, quantityG: clampServing(item.food, item.quantityG + deltaG) };
}

function adjustByCalories(item, calorieDiff) {
  if (item.food.caloriesPer100g <= 0) {
    return item;
  }
  const deltaG = calorieDiff / (item.food.caloriesPer100g / 100);
  return { ...item, quantityG: clampServing(item.food, item.quantityG + deltaG) };
}

function clampServing(food, quantityG) {
  const min = Number.isFinite(food.minServingG) ? food.minServingG : 20;
  const max = Number.isFinite(food.maxServingG) ? food.maxServingG : 500;
  return roundToNearest(clamp(quantityG, min, max), 5);
}

function replaceAt(items, index, item) {
  const next = [...items];
  next[index] = item;
  return next;
}

function firstIndexForRole(items, role) {
  const index = items.findIndex((item) => item.food.macroRole === role);
  return index === -1 ? null : index;
}

function totalsForItems(items) {
  return sumTargets(items.map((item) => macrosForFoodPortion(item.food, item.quantityG)));
}

function isWithinTolerance(items, target) {
  const totals = totalsForItems(items);
  return (
    Math.abs(totals.calories - target.calories) <=
      target.calories * NUTRITION.calorieTolerancePercent &&
    Math.abs(totals.proteinG - target.proteinG) <= NUTRITION.proteinToleranceG &&
    Math.abs(totals.carbG - target.carbG) <= NUTRITION.carbToleranceG &&
    Math.abs(totals.fatG - target.fatG) <= NUTRITION.fatToleranceG
  );
}

function mealScore(items, target) {
  const totals = totalsForItems(items);
  const calorieScore = Math.abs(totals.calories - target.calories) / Math.max(1, target.calories);
  const proteinScore = Math.abs(totals.proteinG - target.proteinG) / Math.max(1, target.proteinG);
  const carbScore = Math.abs(totals.carbG - target.carbG) / Math.max(1, target.carbG);
  const fatScore = Math.abs(totals.fatG - target.fatG) / Math.max(1, target.fatG);
  return calorieScore + proteinScore + carbScore + fatScore;
}

function alternativesFor({ original, allowedFoods, mealTag, limit = 2 }) {
  const sameRole = allowedFoods.filter(
    (food) =>
      food.id !== original.id &&
      food.macroRole === original.macroRole &&
      food.mealTags.includes(mealTag),
  );
  const unique = new Map();

  sameRole
    .sort((a, b) => macroDistance(original, a) - macroDistance(original, b))
    .forEach((food) => {
      if (!unique.has(food.id)) {
        unique.set(food.id, food);
      }
    });

  return Array.from(unique.values()).slice(0, limit);
}

function macroDistance(original, candidate) {
  return (
    Math.abs(original.caloriesPer100g - candidate.caloriesPer100g) +
    Math.abs(original.proteinGPer100g - candidate.proteinGPer100g) * 4 +
    Math.abs(original.carbGPer100g - candidate.carbGPer100g) * 2 +
    Math.abs(original.fatGPer100g - candidate.fatGPer100g) * 4
  );
}

module.exports = {
  generatePlan,
  getFoods,
  normalizeInput,
};
