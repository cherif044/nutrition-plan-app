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

  const meals = mealTargets.map((target, index) => {
    const meal = generateMeal({ target, allowedFoods, mealIndex: index });
    const plainItems = meal.items.map((item) => ({ food: item.food, quantityG: item.quantityG }));
    const mealTotals = sumTargets(plainItems.map((item) => macrosForFoodPortion(item.food, item.quantityG)));
    return { ...meal, sensitivityMatrix: computeSensitivityMatrix(plainItems, mealTotals) };
  });

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
  const calTarget = target.targets.calories;
  // Filter out protein/fat foods whose max serving can't meaningfully contribute to this meal's
  // calorie target (e.g. egg white or olive oil in a 979-kcal lunch). Always falls back to full
  // list so rare diet combinations still work.
  function capablePool(foods, fraction) {
    const minCal = calTarget * fraction;
    const capable = foods.filter((f) => (f.maxServingG * f.caloriesPer100g) / 100 > minCal);
    return capable.length > 0 ? capable : foods;
  }

  const proteinFoods = capablePool(foodsForRole(allowedFoods, 'protein', target.tag), 0.22);
  const carbFoods    = foodsForRole(allowedFoods, 'carb', target.tag);
  const fatFoods     = capablePool(foodsForRole(allowedFoods, 'fat', target.tag), 0.10);
  const mixedFoods = foodsForRole(allowedFoods, 'mixed', target.tag);
  const items = [];

  const protein = pick(proteinFoods, seed) || pick(mixedFoods, seed);
  const proteinCuisine = protein ? getCuisineGroup(protein) : 'neutral';

  const compatCarbs = carbFoods.filter((f) => cuisineCompatible(getCuisineGroup(f), proteinCuisine));
  const compatFats = fatFoods.filter((f) => cuisineCompatible(getCuisineGroup(f), proteinCuisine));

  const carb = pick(compatCarbs.length ? compatCarbs : carbFoods, seed + 1) || pick(mixedFoods, seed + 1);
  const fat = pick(compatFats.length ? compatFats : fatFoods, seed + 2);
  const mixed = target.tag === 'snack' ? null : pick(mixedFoods, seed + 3);

  if (protein) items.push(defaultItem(protein));
  if (carb && carb.id !== protein?.id) items.push(defaultItem(carb));
  if (fat && fat.id !== protein?.id && fat.id !== carb?.id) items.push(defaultItem(fat));
  if (mixed && items.every((item) => item.food.id !== mixed.id) && calTarget > 450) {
    items.push(defaultItem(mixed, 0.55));
  }
  if (items.length === 0) {
    const anyFood = pick(allowedFoods, seed);
    if (anyFood) items.push(defaultItem(anyFood));
  }

  // Scale initial portions toward the calorie target so adjustPortions starts close
  const defaultCal = items.reduce(
    (sum, item) => sum + (item.food.caloriesPer100g * item.quantityG) / 100,
    0,
  );
  if (defaultCal > 0 && calTarget > defaultCal * 1.2) {
    const scale = calTarget / defaultCal;
    return items.map((item) => ({
      ...item,
      quantityG: clampServing(item.food, item.quantityG * scale),
    }));
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
      const updated = adjustByMacro(items[proteinIndex], proteinDiff, items[proteinIndex].food.proteinGPer100g);
      if (updated.quantityG !== items[proteinIndex].quantityG) {
        items = replaceAt(items, proteinIndex, updated);
        continue;
      }
    }

    if (fatIndex !== null && Math.abs(fatDiff) > NUTRITION.fatToleranceG / 2) {
      const updated = adjustByMacro(items[fatIndex], fatDiff, items[fatIndex].food.fatGPer100g);
      if (updated.quantityG !== items[fatIndex].quantityG) {
        items = replaceAt(items, fatIndex, updated);
        continue;
      }
      // Fat food is at its limit — fall through to calorie adjustment
    }

    if (carbIndex !== null && Math.abs(calorieDiff) > target.calories * 0.05) {
      const updated = adjustByCalories(items[carbIndex], calorieDiff);
      if (updated.quantityG === items[carbIndex].quantityG) break; // carb food is at its limit too
      items = replaceAt(items, carbIndex, updated);
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

function computeMealBounds(target, tolerance) {
  const t = tolerance ?? 0.10;
  return {
    calories: { min: target.calories * (1 - t), max: target.calories * (1 + t) },
    proteinG: { min: target.proteinG * (1 - t), max: target.proteinG * (1 + t) },
    carbG: { min: target.carbG * (1 - t), max: target.carbG * (1 + t) },
    fatG: { min: target.fatG * (1 - t), max: target.fatG * (1 + t) },
  };
}

function findBoundsViolation(totals, bounds) {
  if (totals.calories < bounds.calories.min || totals.calories > bounds.calories.max) return 'calories';
  if (totals.proteinG < bounds.proteinG.min || totals.proteinG > bounds.proteinG.max) return 'protein';
  if (totals.carbG < bounds.carbG.min || totals.carbG > bounds.carbG.max) return 'carbs';
  if (totals.fatG < bounds.fatG.min || totals.fatG > bounds.fatG.max) return 'fat';
  return null;
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
  // Weight calories 3× — calorie accuracy is the primary quality signal
  const calorieScore = 3 * Math.abs(totals.calories - target.calories) / Math.max(1, target.calories);
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

function getCuisineGroup(food) {
  const cats = new Set(food.categories);
  if (cats.has('fruits') || cats.has('fruit')) return 'sweet';
  if (
    cats.has('beef') || cats.has('poultry') || cats.has('seafood') ||
    cats.has('fish') || cats.has('shellfish') || cats.has('legumes') ||
    cats.has('vegetables') || cats.has('vegetable') || cats.has('sauces')
  ) return 'savory';
  return 'neutral';
}

function cuisineCompatible(groupA, groupB) {
  if (groupA === 'neutral' || groupB === 'neutral') return true;
  return groupA === groupB;
}

function macroDistance(original, candidate) {
  return (
    Math.abs(original.caloriesPer100g - candidate.caloriesPer100g) +
    Math.abs(original.proteinGPer100g - candidate.proteinGPer100g) * 4 +
    Math.abs(original.carbGPer100g - candidate.carbGPer100g) * 2 +
    Math.abs(original.fatGPer100g - candidate.fatGPer100g) * 4
  );
}

// ── Interactive meal rebalancing ─────────────────────────────────────────────

// After the main algorithm converges, nudge the most relevant unlocked food to fix
// any remaining bounds violations (e.g. protein drift when no protein-role food exists).
// Runs up to 4 single-food adjustments; gives up if a pass makes no progress.
function nudgeIntoBounds(items, bounds) {
  // Maps the violation label returned by findBoundsViolation to the keys used in totals/bounds
  const VIOLATION_TO_KEY = { calories: 'calories', protein: 'proteinG', carbs: 'carbG', fat: 'fatG' };
  const KEY_TO_FOOD_FIELD = {
    calories: 'caloriesPer100g',
    proteinG: 'proteinGPer100g',
    carbG: 'carbGPer100g',
    fatG: 'fatGPer100g',
  };

  let current = items.map((i) => ({ ...i }));

  for (let pass = 0; pass < 4; pass++) {
    const totals = totalsForItems(current);
    const violation = findBoundsViolation(totals, bounds);
    if (!violation) return current;

    const key = VIOLATION_TO_KEY[violation];
    const field = KEY_TO_FOOD_FIELD[key];
    const currentVal = totals[key];
    const tooLow = currentVal < bounds[key].min;
    const deficit = tooLow ? bounds[key].min - currentVal : bounds[key].max - currentVal;

    let bestIdx = -1;
    let bestRate = 0;
    current.forEach((item, i) => {
      if (item.locked) return;
      const rate = item.food[field] / 100;
      if (rate <= 0) return;
      const minQ = item.food.minServingG ?? 20;
      const maxQ = item.food.maxServingG ?? 500;
      const atLimit = tooLow ? item.quantityG >= maxQ : item.quantityG <= minQ;
      if (!atLimit && rate > bestRate) {
        bestRate = rate;
        bestIdx = i;
      }
    });

    if (bestIdx === -1) return current;

    const item = current[bestIdx];
    const deltaG = (tooLow ? 1 : -1) * Math.abs(deficit) / bestRate;
    const minQ = item.food.minServingG ?? 20;
    const maxQ = item.food.maxServingG ?? 500;
    const newQ = roundToNearest(Math.min(maxQ, Math.max(minQ, item.quantityG + deltaG)), 5);
    if (newQ === item.quantityG) return current;

    current[bestIdx] = { ...item, quantityG: newQ };
  }

  return current;
}

function rebalanceMeal({ mealTarget, items: rawItems, mealBounds }) {
  const foods = loadFoods();
  const foodMap = new Map(foods.map((f) => [f.id, f]));

  const items = rawItems.map((item) => {
    const food = foodMap.get(String(item.foodId));
    if (!food) throw new Error(`Unknown food id: ${item.foodId}`);
    return {
      food,
      quantityG: clampServing(food, Number(item.quantityG) || food.defaultServingG),
      locked: Boolean(item.locked),
    };
  });

  const bounds = mealBounds ?? computeMealBounds(mealTarget);
  const adjusted = adjustPortionsWithLocks(items, mealTarget, bounds);

  const finalItems = findBoundsViolation(totalsForItems(adjusted), bounds)
    ? nudgeIntoBounds(adjusted, bounds)
    : adjusted;

  const totals = totalsForItems(finalItems);
  const violation = findBoundsViolation(totals, bounds);
  if (violation) {
    return { success: false, violatedMacro: violation };
  }

  return {
    success: true,
    items: finalItems.map((item) => ({ foodId: item.food.id, quantityG: item.quantityG })),
    totals,
  };
}

function checkRebalanceFeasibility({ mealTarget, items: rawItems, mealBounds }) {
  const foods = loadFoods();
  const foodMap = new Map(foods.map((f) => [f.id, f]));

  try {
    const items = rawItems.map((item) => {
      const food = foodMap.get(String(item.foodId));
      if (!food) throw new Error(`Unknown food id: ${item.foodId}`);
      return {
        food,
        quantityG: clampServing(food, Number(item.quantityG) || food.defaultServingG),
        locked: Boolean(item.locked),
      };
    });

    const bounds = mealBounds ?? computeMealBounds(mealTarget);
    const adjusted = adjustPortionsWithLocks(items, mealTarget, bounds);

    const finalItems = findBoundsViolation(totalsForItems(adjusted), bounds)
      ? nudgeIntoBounds(adjusted, bounds)
      : adjusted;

    const totals = totalsForItems(finalItems);
    const violation = findBoundsViolation(totals, bounds);

    return { feasible: !violation, violatedMacro: violation ?? null };
  } catch {
    return { feasible: false, violatedMacro: null };
  }
}

function adjustPortionsWithLocks(initialItems, target, bounds) {
  let items = initialItems.map((item) => ({ ...item }));

  // When 10% bounds are provided use tighter per-macro thresholds (5% of target)
  // so that drifts within NUTRITION tolerances but outside bounds still get corrected.
  const proteinThresh = bounds ? target.proteinG * 0.05 : NUTRITION.proteinToleranceG / 2;
  const fatThresh     = bounds ? target.fatG     * 0.05 : NUTRITION.fatToleranceG     / 2;
  const carbThresh    = bounds ? target.carbG    * 0.05 : NUTRITION.carbToleranceG    / 2;

  for (let i = 0; i < NUTRITION.maxPortionAdjustmentIterations; i += 1) {
    const totals = totalsForItems(items);
    const proteinDiff = target.proteinG - totals.proteinG;
    const fatDiff = target.fatG - totals.fatG;
    const carbDiff = target.carbG - totals.carbG;
    const calorieDiff = target.calories - totals.calories;
    const proteinIndex =
      firstAdjustableIndexForRole(items, 'protein') ?? firstAdjustableIndexForRole(items, 'mixed');
    const fatIndex = firstAdjustableIndexForRole(items, 'fat');
    const carbIndex =
      firstAdjustableIndexForRole(items, 'carb') ?? firstAdjustableIndexForRole(items, 'mixed');

    if (proteinIndex !== null && Math.abs(proteinDiff) > proteinThresh) {
      const updated = adjustByMacro(items[proteinIndex], proteinDiff, items[proteinIndex].food.proteinGPer100g);
      if (updated.quantityG !== items[proteinIndex].quantityG) {
        items = replaceAt(items, proteinIndex, updated);
        continue;
      }
    }
    if (fatIndex !== null && Math.abs(fatDiff) > fatThresh) {
      const updated = adjustByMacro(items[fatIndex], fatDiff, items[fatIndex].food.fatGPer100g);
      if (updated.quantityG !== items[fatIndex].quantityG) {
        items = replaceAt(items, fatIndex, updated);
        continue;
      }
    }
    if (carbIndex !== null && Math.abs(carbDiff) > carbThresh) {
      const updated = adjustByMacro(items[carbIndex], carbDiff, items[carbIndex].food.carbGPer100g);
      if (updated.quantityG !== items[carbIndex].quantityG) {
        items = replaceAt(items, carbIndex, updated);
        continue;
      }
    }
    if (carbIndex !== null && Math.abs(calorieDiff) > 15) {
      const updated = adjustByCalories(items[carbIndex], calorieDiff);
      if (updated.quantityG === items[carbIndex].quantityG) break;
      items = replaceAt(items, carbIndex, updated);
      continue;
    }
    break;
  }

  return items.map((item) => ({ ...item, quantityG: roundToNearest(item.quantityG, 5) }));
}

function firstAdjustableIndexForRole(items, role) {
  const index = items.findIndex((item) => !item.locked && item.food.macroRole === role);
  return index === -1 ? null : index;
}

// Pre-compute how other foods should change when a given food increases by 10g.
// Uses pure calorie compensation: the best calorie-absorbing unlocked food adjusts.
function computeSensitivityMatrix(items, mealTarget) {
  return items.map((trigger, triggerIdx) => {
    const deltas = new Array(items.length).fill(0);
    const extraCal = 10 * trigger.food.caloriesPer100g / 100;
    if (extraCal <= 0) return deltas;

    const compIdx = findCalorieCompensatorIndex(items, triggerIdx);
    if (compIdx === -1) return deltas;

    const comp = items[compIdx];
    if (comp.food.caloriesPer100g <= 0) return deltas;

    const rawDelta = -extraCal / (comp.food.caloriesPer100g / 100);
    const minQ = comp.food.minServingG ?? 20;
    const maxQ = comp.food.maxServingG ?? 500;
    const newQ = Math.min(Math.max(comp.quantityG + rawDelta, minQ), maxQ);
    // Store exact delta (not rounded) so the frontend can accumulate correctly
    deltas[compIdx] = newQ - comp.quantityG;

    return deltas;
  });
}

function findCalorieCompensatorIndex(items, excludeIdx) {
  for (const role of ['carb', 'mixed', 'protein']) {
    const idx = items.findIndex((item, i) => i !== excludeIdx && item.food.macroRole === role);
    if (idx !== -1) return idx;
  }
  return items.findIndex((_, i) => i !== excludeIdx);
}

module.exports = {
  generatePlan,
  getFoods,
  normalizeInput,
  rebalanceMeal,
  computeSensitivityMatrix,
  checkRebalanceFeasibility,
  computeMealBounds,
};
