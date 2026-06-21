const { loadFoods } = require('../repositories/foodRepository');
const { loadTemplates } = require('../repositories/templateRepository');
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
  return _generatePlanInternal(rawInput, true);
}

function generatePlanFreeform(rawInput) {
  return _generatePlanInternal(rawInput, false);
}

function _generatePlanInternal(rawInput, useTemplates) {
  const input = normalizeInput(rawInput);
  const dailyTargets = calculateDailyTargets(input);
  const mealTargets = splitMeals(dailyTargets, input);
  const allowedFoods = filterFoods(loadFoods(), input);

  if (allowedFoods.length === 0) {
    throw new Error('No foods match the selected restrictions. Try removing one filter.');
  }

  const usedSnackFoodIds = new Set();
  const meals = mealTargets.map((target, index) => {
    // MOD-7: exclude foods already used in a previous snack
    let foodPool = allowedFoods;
    if (target.tag === 'snack' && usedSnackFoodIds.size > 0) {
      const filtered = allowedFoods.filter((f) => !usedSnackFoodIds.has(f.id));
      if (filtered.length > 0) foodPool = filtered;
    }
    const meal = generateMeal({ target, allowedFoods: foodPool, mealIndex: index, input, useTemplates });
    if (target.tag === 'snack') {
      meal.items.forEach((item) => usedSnackFoodIds.add(item.food.id));
    }
    const plainItems = meal.items.map((item) => ({ food: item.food, quantityG: item.quantityG }));
    const mealTotals = sumTargets(plainItems.map((item) => macrosForFoodPortion(item.food, item.quantityG)));
    return {
      ...meal,
      sensitivityMatrix: computeSensitivityMatrix(plainItems, mealTotals),
      originalItems: plainItems.map((item) => ({ food: item.food, quantityG: item.quantityG })),
    };
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
  if (![2, 3, 4, 5, 6].includes(numberOfMeals)) {
    throw new Error('Meals must be between 2 and 6.');
  }
  if (![0, 1, 2, 3].includes(numberOfSnacks)) {
    throw new Error('Snacks must be between 0 and 3.');
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
    avoidFoods: normalizeList(input.avoidFoods ?? []),
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
  // avoidFoods merges into both allergies and dislikes
  const mergedAvoid = [...new Set([...input.avoidFoods, ...input.allergies])];
  const allergies = resolvePreferenceTerms(mergedAvoid);
  const dislikes = resolvePreferenceTerms([...new Set([...input.avoidFoods, ...input.dislikes])]);
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

function selectTemplateForMeal({ mealTag, allowedFoods, input, target, seed }) {
  const templates = loadTemplates();
  const allowedFoodMap = new Map(allowedFoods.map((f) => [f.id, f]));
  const allFoodMap = new Map(loadFoods().map((f) => [f.id, f]));

  let filtered = templates.filter((t) => t.mealType === mealTag);

  // All component foods must be in the already-filtered allowed pool
  filtered = filtered.filter((t) =>
    t.components.every((c) => allowedFoodMap.has(c.foodId)),
  );

  // Diet compatibility
  if (input.dietType === 'vegan') {
    filtered = filtered.filter((t) => t.dietTags && t.dietTags.includes('vegan'));
  } else if (input.dietType === 'vegetarian') {
    filtered = filtered.filter(
      (t) => t.dietTags && (t.dietTags.includes('vegetarian') || t.dietTags.includes('vegan')),
    );
  }

  if (filtered.length === 0) return null;

  // Feasibility check: keep only templates whose foods can reach the macro target
  // Store solved items so we can return them directly (avoids re-solving and avoids
  // adjustPortions starting from default quantities which may violate serving bounds).
  const feasible = [];
  for (const t of filtered) {
    const items = t.components.map((c) => {
      const food = allowedFoodMap.get(c.foodId) ?? allFoodMap.get(c.foodId);
      return food ? { food, quantityG: food.defaultServingG } : null;
    }).filter(Boolean);

    if (items.length === 0) continue;

    const solved = solvePortionsLeastSquares(items, {
      proteinG: target.proteinG,
      carbG: target.carbG,
      fatG: target.fatG,
    });

    if (isWithinTolerance(solved, target)) {
      feasible.push(solved);
    }
  }

  if (feasible.length === 0) return null;

  return pick(feasible, seed);
}

function generateMeal({ target, allowedFoods, mealIndex, input = null, useTemplates = false }) {
  let bestMeal = null;
  let bestScore = Infinity;

  for (let attempt = 0; attempt < NUTRITION.maxMealAttempts; attempt += 1) {
    let items;
    if (useTemplates && target.tag !== 'snack' && attempt === 0 && input) {
      const templateItems = selectTemplateForMeal({
        mealTag: target.tag,
        allowedFoods,
        input,
        target: target.targets,
        seed: mealIndex,
      });
      items = templateItems ?? selectInitialItems({ target, allowedFoods, seed: mealIndex + attempt });
    } else {
      items = selectInitialItems({
        target,
        allowedFoods,
        seed: mealIndex + attempt,
      });
    }
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

function alternativesFor({ original, allowedFoods, mealTag, limit = 4 }) {
  // MOD-11: prefer foods sharing a category (same semantic type), fall back to same role only
  const byRole = (food) =>
    food.id !== original.id &&
    food.macroRole === original.macroRole &&
    food.mealTags.includes(mealTag);

  const withCategory = allowedFoods.filter(
    (food) => byRole(food) && food.categories.some((c) => original.categories.includes(c)),
  );
  const pool = withCategory.length > 0 ? withCategory : allowedFoods.filter(byRole);

  const unique = new Map();
  pool
    .sort((a, b) => macroDistance(original, a) - macroDistance(original, b))
    .forEach((food) => {
      if (!unique.has(food.id)) unique.set(food.id, food);
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

function solvePortionsLeastSquares(items, target, options = {}) {
  const weights = { protein: 1, carb: 1, fat: 1, ...(options.weights ?? {}) };
  const maxIterations = options.maxIterations ?? NUTRITION.maxPortionAdjustmentIterations;
  const learningRate = options.learningRate ?? 0.3;

  const meta = items.map((item) => ({
    p: item.food.proteinGPer100g / 100,
    c: item.food.carbGPer100g / 100,
    f: item.food.fatGPer100g / 100,
    min: Number.isFinite(item.food.minServingG) ? item.food.minServingG : 20,
    max: Number.isFinite(item.food.maxServingG) ? item.food.maxServingG : 500,
  }));

  // Raw floats during iteration — rounding only applied to final output
  let x = meta.map((m, i) => clamp(items[i].quantityG, m.min, m.max));

  for (let iter = 0; iter < maxIterations; iter++) {
    let P = 0;
    let C = 0;
    let F = 0;
    for (let i = 0; i < x.length; i++) {
      P += x[i] * meta[i].p;
      C += x[i] * meta[i].c;
      F += x[i] * meta[i].f;
    }

    const errP = P - target.proteinG;
    const errC = C - target.carbG;
    const errF = F - target.fatG;

    let gradNormSq = 0;
    const next = x.map((xi, i) => {
      const grad =
        2 * weights.protein * meta[i].p * errP +
        2 * weights.carb   * meta[i].c * errC +
        2 * weights.fat    * meta[i].f * errF;
      gradNormSq += grad * grad;
      return clamp(xi - learningRate * grad, meta[i].min, meta[i].max);
    });

    x = next;
    if (gradNormSq < 1e-6) break;
  }

  return items.map((item, i) => ({
    ...item,
    quantityG: roundToNearest(clamp(x[i], meta[i].min, meta[i].max), 5),
  }));
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
      };
    });

    const solved = solvePortionsLeastSquares(items, {
      proteinG: mealTarget.proteinG,
      carbG: mealTarget.carbG,
      fatG: mealTarget.fatG,
    });

    const finalTotals = totalsForItems(solved);

    const absErrP = Math.abs(finalTotals.proteinG - mealTarget.proteinG);
    const absErrC = Math.abs(finalTotals.carbG - mealTarget.carbG);
    const absErrF = Math.abs(finalTotals.fatG - mealTarget.fatG);

    if (
      absErrP <= NUTRITION.proteinToleranceG &&
      absErrC <= NUTRITION.carbToleranceG &&
      absErrF <= NUTRITION.fatToleranceG
    ) {
      return { feasible: true, violatedMacro: null };
    }

    const relP = absErrP / Math.max(1, mealTarget.proteinG);
    const relC = absErrC / Math.max(1, mealTarget.carbG);
    const relF = absErrF / Math.max(1, mealTarget.fatG);

    let violatedMacro = 'protein';
    if (relC >= relP && relC >= relF) violatedMacro = 'carbs';
    else if (relF >= relP && relF >= relC) violatedMacro = 'fat';

    return { feasible: false, violatedMacro };
  } catch {
    return { feasible: false, violatedMacro: null };
  }
}

function adjustPortionsWithLocks(initialItems, target, bounds) {
  return solvePortionsLeastSquares(initialItems, {
    proteinG: target.proteinG,
    carbG: target.carbG,
    fatG: target.fatG,
  });
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

// ── Auto-balance meal (user-triggered, targets original generated values) ─────

function autoBalanceMeal({ items: rawItems, originalItems: rawOriginals, mealTag }) {
  const foods = loadFoods();
  const foodMap = new Map(foods.map((f) => [f.id, f]));

  const items = rawItems.map((item) => {
    const food = foodMap.get(String(item.foodId));
    if (!food) throw new Error(`Unknown food id: ${item.foodId}`);
    return {
      food,
      quantityG: clampServing(food, Number(item.quantityG) || food.defaultServingG),
    };
  });

  // Original totals are the optimization target (not the meal's current target)
  const origTotals = sumTargets(
    rawOriginals.map((orig) => {
      const fid = String(orig.foodId ?? orig.food?.id ?? '');
      const food = foodMap.get(fid);
      if (!food) return { calories: 0, proteinG: 0, carbG: 0, fatG: 0 };
      return macrosForFoodPortion(food, Number(orig.quantityG) || 0);
    }),
  );

  let current = solvePortionsLeastSquares(items.map((i) => ({ ...i })), {
    proteinG: origTotals.proteinG,
    carbG: origTotals.carbG,
    fatG: origTotals.fatG,
  });

  const finalTotals = totalsForItems(current);
  const THRESH = 0.10;
  const acceptable =
    Math.abs(finalTotals.proteinG - origTotals.proteinG) / Math.max(1, origTotals.proteinG) <= THRESH &&
    Math.abs(finalTotals.carbG - origTotals.carbG) / Math.max(1, origTotals.carbG) <= THRESH &&
    Math.abs(finalTotals.fatG - origTotals.fatG) / Math.max(1, origTotals.fatG) <= THRESH &&
    Math.abs(finalTotals.calories - origTotals.calories) / Math.max(1, origTotals.calories) <= THRESH;

  if (acceptable) {
    return {
      success: true,
      items: current.map((i) => ({ foodId: i.food.id, quantityG: i.quantityG })),
      totals: finalTotals,
    };
  }

  const problematic = findMostProblematicFood(current, origTotals);
  const suggestions = problematic
    ? suggestReplacementsForFood({
        problematicFood: problematic.food,
        items: current,
        origTotals,
        mealTag: String(mealTag || ''),
        foods,
      })
    : [];

  return {
    success: false,
    problematicFoodId: problematic?.food.id ?? null,
    suggestions,
    deviations: {
      proteinPct: Math.abs(finalTotals.proteinG - origTotals.proteinG) / Math.max(1, origTotals.proteinG),
      carbPct: Math.abs(finalTotals.carbG - origTotals.carbG) / Math.max(1, origTotals.carbG),
      fatPct: Math.abs(finalTotals.fatG - origTotals.fatG) / Math.max(1, origTotals.fatG),
    },
  };
}

function findMostProblematicFood(items, origTotals) {
  const totals = totalsForItems(items);

  const checks = [
    { key: 'proteinG', field: 'proteinGPer100g' },
    { key: 'carbG',    field: 'carbGPer100g' },
    { key: 'calories', field: 'caloriesPer100g' },
    { key: 'fatG',     field: 'fatGPer100g' },
  ];

  let worstKey = 'proteinG';
  let worstDev = 0;
  for (const { key } of checks) {
    const dev = Math.abs(totals[key] - origTotals[key]) / Math.max(1, origTotals[key]);
    if (dev > worstDev) { worstDev = dev; worstKey = key; }
  }

  const fieldPer100 = checks.find((c) => c.key === worstKey)?.field ?? 'caloriesPer100g';
  const needMore = totals[worstKey] < origTotals[worstKey];

  let bestItem = null;
  let bestScore = -1;

  for (const item of items) {
    const rate = item.food[fieldPer100] / 100;
    if (rate <= 0) continue;
    const minQ = item.food.minServingG ?? 20;
    const maxQ = item.food.maxServingG ?? 500;
    const atLimit = needMore ? item.quantityG >= maxQ - 5 : item.quantityG <= minQ + 5;
    const score = rate * (maxQ - minQ) * (atLimit ? 2 : 0.5);
    if (score > bestScore) { bestScore = score; bestItem = item; }
  }

  return bestItem ?? items[0] ?? null;
}

function suggestReplacementsForFood({ problematicFood, items, origTotals, mealTag, foods }) {
  const otherTotals = totalsForItems(items.filter((i) => i.food.id !== problematicFood.id));
  const budget = {
    calories: origTotals.calories - otherTotals.calories,
    proteinG: origTotals.proteinG - otherTotals.proteinG,
    carbG: origTotals.carbG - otherTotals.carbG,
    fatG: origTotals.fatG - otherTotals.fatG,
  };

  const results = [];

  for (const food of foods) {
    if (food.id === problematicFood.id) continue;

    let gramAmount;
    if (food.proteinGPer100g > 1 && budget.proteinG > 5) {
      gramAmount = budget.proteinG / (food.proteinGPer100g / 100);
    } else if (food.caloriesPer100g > 0 && budget.calories > 0) {
      gramAmount = budget.calories / (food.caloriesPer100g / 100);
    } else {
      continue;
    }

    gramAmount = Math.round(gramAmount / 5) * 5;
    if (!Number.isFinite(gramAmount) || gramAmount <= 0) continue;

    const minG = food.minServingG ?? 20;
    const maxG = food.maxServingG ?? 500;
    if (gramAmount < minG || gramAmount > maxG) continue;

    const sameCategory = problematicFood.categories.some((c) => food.categories.includes(c));
    results.push({ food, gramAmount, sameCategory });
  }

  results.sort((a, b) => {
    if (a.sameCategory !== b.sameCategory) return a.sameCategory ? -1 : 1;
    return macroDistance(problematicFood, a.food) - macroDistance(problematicFood, b.food);
  });

  return results.slice(0, 5).map((r) => ({
    food: r.food,
    gramAmount: r.gramAmount,
    isSwap: r.sameCategory,
  }));
}

function filterFoodsForChatbox({ foods, mealTag, userInput }) {
  let filtered = foods.filter((f) => f.mealTags.includes(mealTag));

  try {
    const safeInput = {
      dietType: userInput.dietType || 'standard',
      avoidFoods: Array.isArray(userInput.avoidFoods) ? userInput.avoidFoods : [],
      allergies: [],
      dislikes: [],
    };
    filtered = filterFoods(filtered, safeInput);
  } catch {
    // If filter fails (e.g. unknown term), use unfiltered by-tag results
  }

  const byRole = { protein: [], carb: [], fat: [], mixed: [] };
  for (const f of filtered) {
    byRole[f.macroRole]?.push(f);
  }

  const balanced = [
    ...byRole.protein.slice(0, 8),
    ...byRole.carb.slice(0, 8),
    ...byRole.fat.slice(0, 5),
    ...byRole.mixed.slice(0, 4),
  ];

  return balanced.map((f) => ({
    id: f.id,
    name: f.name,
    macroRole: f.macroRole,
    minServingG: f.minServingG,
    maxServingG: f.maxServingG,
    caloriesPer100g: f.caloriesPer100g,
    proteinGPer100g: f.proteinGPer100g,
    carbGPer100g: f.carbGPer100g,
    fatGPer100g: f.fatGPer100g,
  }));
}

module.exports = {
  generatePlan,
  generatePlanFreeform,
  getFoods,
  normalizeInput,
  rebalanceMeal,
  autoBalanceMeal,
  computeSensitivityMatrix,
  checkRebalanceFeasibility,
  computeMealBounds,
  filterFoodsForChatbox,
  solvePortionsLeastSquares,
};
