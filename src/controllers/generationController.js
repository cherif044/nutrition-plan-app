const { getPreferenceOptions } = require('../config/preferenceTaxonomy');
const { generatePlan, generatePlanFreeform, getFoods, rebalanceMeal, filterFoodsForChatbox, generateAlternateMealOptions } = require('../services/planGenerator');
const { chatWithLLM } = require('../services/llmService');

const STRICT_TARGET_TOLERANCE = 0.10;
const CONSTRAINED_REQUEST_TOLERANCE = 0.20;

function health(_req, res) {
  res.json({ status: 'ok' });
}

function getFoodsHandler(_req, res, next) {
  try {
    res.json({ foods: getFoods() });
  } catch (error) {
    next(error);
  }
}

function getPreferences(_req, res, next) {
  try {
    res.json(getPreferenceOptions(getFoods()));
  } catch (error) {
    next(error);
  }
}

function generatePlanHandler(req, res, next) {
  try {
    res.json(generatePlan(req.body));
  } catch (error) {
    next(error);
  }
}

function generatePlanFreeformHandler(req, res, next) {
  try {
    res.json(generatePlanFreeform(req.body));
  } catch (error) {
    next(error);
  }
}

function rebalanceMealHandler(req, res, next) {
  try {
    const { mealTarget, items, mealBounds, dailyContext } = req.body;
    if (!mealTarget || !Array.isArray(items)) {
      return res.status(400).json({ error: 'mealTarget and items are required.' });
    }
    if (!dailyContext) {
      return res.status(400).json({
        error: 'dailyContext is required to enforce the per-meal calorie and macro ranges.',
      });
    }
    res.json(rebalanceMeal({ mealTarget, items, mealBounds, dailyContext }));
  } catch (error) {
    next(error);
  }
}

function mealOptionsHandler(req, res, next) {
  try {
    const {
      mealTag,
      mealTarget,
      currentItems,
      templateId,
      userPreferences,
      dailyContext,
      limit,
    } = req.body;

    if (!mealTarget || !Array.isArray(currentItems) || !dailyContext) {
      return res.status(400).json({
        error: 'mealTarget, currentItems, and dailyContext are required.',
      });
    }

    res.json({
      mealOptions: generateAlternateMealOptions({
        mealTag,
        mealTarget,
        currentItems,
        templateId,
        userPreferences,
        dailyContext,
        limit,
      }),
    });
  } catch (error) {
    next(error);
  }
}

async function guidedMealSuggestionHandler(req, res, next) {
  try {
    const {
      action,
      mealTag,
      mealTarget,
      currentItems,
      attemptedItems,
      failureReason,
      userPreferences,
      rejectedProposal,
      userFeedback,
      dailyContext,
    } = req.body;

    if (!action || !mealTarget || !Array.isArray(currentItems) || !Array.isArray(attemptedItems)) {
      return res.status(400).json({ error: 'action, mealTarget, currentItems, and attemptedItems are required.' });
    }

    const foods = getFoods();
    const availableFoods = filterFoodsForChatbox({
      foods,
      mealTag: mealTag || 'lunch',
      userInput: {
        dietType: userPreferences?.dietType || 'standard',
        avoidFoods: Array.isArray(userPreferences?.avoidFoods) ? userPreferences.avoidFoods : [],
      },
    });

    const systemContent = `You are a meal-editing fallback. Respond with valid JSON only.

Goal: suggest a food-level change inside ONE meal after deterministic rebalance failed.
Do not adjust other meals. Do not suggest another full meal. Do not repeat rejected suggestions.
Return a complete final food list for this meal, not a delta/change list.

Allowed actions:
- replace one existing non-custom food with one available food
- add one available food when a swap/add/remove attempt is close but missing a balancing macro
- remove one existing food, and if that cannot fit by portion changes alone, keep it removed and add one available food to replace the lost calories/macros
- keep an existing custom food but suggest replacing another food
- return impossible if no sensible food-level change exists

Return one JSON object:
{"status":"proposal","message":"short user-facing explanation","items":[{"foodId":"exact id","quantityG":number}]}
or
{"status":"impossible","message":"short explanation"}

Rules:
1. Use only foodIds from CURRENT/ATTEMPTED items or AVAILABLE foods.
2. Preserve custom foods from ATTEMPTED items unless the failed action was adding that custom food and it is clearly impossible.
3. Do not include foods from user avoids.
4. Keep this meal recognizable; change the smallest number of foods.
5. For action "swap_food", preserve the user's chosen replacement from ATTEMPTED items whenever possible. First try adding exactly one AVAILABLE food to balance the swapped meal. If that cannot work, try removing exactly one non-custom food. Only suggest another replacement if preserving the chosen swap is clearly impossible.
6. For action "remove_food", foods present in CURRENT but missing from ATTEMPTED were intentionally deleted. Do not bring those deleted foods back. First try keeping all ATTEMPTED foods and adding exactly one AVAILABLE food that fixes the missing macro/calorie gap. If one added food cannot work, try replacing one remaining non-custom food plus adding one AVAILABLE food. Only return impossible after trying those food-level options.
7. Quantity numbers are only a draft; backend will rebalance and validate them.`;

    const userContent = JSON.stringify({
      action,
      mealTag,
      mealTarget,
      failureReason: failureReason || null,
      userAvoids: userPreferences?.avoidFoods || [],
      rejectedProposal: rejectedProposal || null,
      userFeedback: userFeedback || null,
      currentItems: currentItems.map(compactGuidedItem),
      attemptedItems: attemptedItems.map(compactGuidedItem),
      availableFoods: availableFoods.map((food) => ({
        foodId: food.id,
        name: food.name,
        macroRole: food.macroRole,
        minServingG: food.minServingG,
        maxServingG: food.maxServingG,
        caloriesPer100g: food.caloriesPer100g,
        proteinGPer100g: food.proteinGPer100g,
        carbGPer100g: food.carbGPer100g,
        fatGPer100g: food.fatGPer100g,
      })),
    });

    let payload;
    try {
      payload = await chatWithLLM([
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent },
      ]);
    } catch (error) {
      console.error('[guided-meal-suggestion llm]', error.message);
      return res.json({
        status: 'impossible',
        message: 'The deterministic solver could not fit this meal, and AI suggestions were unavailable.',
      });
    }

    if (payload?.status !== 'proposal' || !Array.isArray(payload.items) || payload.items.length === 0) {
      return res.json({
        status: 'impossible',
        message: payload?.message || 'No reliable food-level suggestion was found for this meal.',
      });
    }

    const safeItems = sanitizeGuidedItems(payload.items, { action, currentItems, attemptedItems, availableFoods });
    if (safeItems.length === 0) {
      return res.json({ status: 'impossible', message: 'AI suggested foods that are not allowed for this meal.' });
    }

    const rebalance = rebalanceMeal({ mealTarget, items: safeItems, dailyContext });
    if (!rebalance.success) {
      return res.json({
        status: 'impossible',
        message: `No combination can solve this meal with the suggested foods. Change one of the foods.`,
        violatedMacro: rebalance.violatedMacro,
      });
    }

    const proposedItems = buildGuidedProposedItems(safeItems, rebalance.items);
    res.json({
      status: 'proposal',
      message: payload.message || 'I found a food-level change that can fit this meal.',
      proposedItems,
      proposedTotals: rebalance.totals,
    });
  } catch (error) {
    next(error);
  }
}

function compactGuidedItem(item) {
  return {
    foodId: item.foodId,
    name: item.name || item.food?.name,
    quantityG: Number(item.quantityG) || 0,
    customFood: item.customFood || (String(item.foodId || '').startsWith('custom_') ? item.food : null),
  };
}

function sanitizeGuidedItems(items, { action, currentItems, attemptedItems, availableFoods }) {
  const attemptedIds = new Set(attemptedItems.map((item) => String(item.foodId)));
  const removedIds = new Set(
    action === 'remove_food'
      ? currentItems
        .map((item) => String(item.foodId))
        .filter((foodId) => foodId && !attemptedIds.has(foodId))
      : [],
  );
  const allowedIds = new Set([
    ...currentItems.map((item) => String(item.foodId)),
    ...attemptedItems.map((item) => String(item.foodId)),
    ...availableFoods.map((food) => String(food.id)),
  ]);
  const customById = new Map(
    [...currentItems, ...attemptedItems]
      .filter((item) => String(item.foodId || '').startsWith('custom_'))
      .map((item) => [String(item.foodId), item.customFood || item.food]),
  );
  const seen = new Set();
  return items
    .map((item) => ({
      foodId: String(item.foodId || ''),
      quantityG: Number(item.quantityG) || 0,
      customFood: customById.get(String(item.foodId || '')) || null,
    }))
    .filter((item) => {
      if (!item.foodId || seen.has(item.foodId) || !allowedIds.has(item.foodId)) return false;
      if (removedIds.has(item.foodId)) return false;
      seen.add(item.foodId);
      return true;
    });
}

function buildGuidedProposedItems(requestItems, solvedItems) {
  const foods = getFoods();
  const foodById = new Map(foods.map((food) => [food.id, food]));
  const requestById = new Map(requestItems.map((item) => [String(item.foodId), item]));
  return solvedItems.map((solved) => {
    const request = requestById.get(String(solved.foodId));
    const food = foodById.get(String(solved.foodId)) || request?.customFood || null;
    return {
      foodId: solved.foodId,
      food,
      quantityG: solved.quantityG,
      customFood: request?.customFood || null,
    };
  }).filter((item) => item.food);
}

function macroGapScore(totals, target) {
  const scorePart = (actual, desired) => Math.abs((Number(actual) || 0) - (Number(desired) || 0)) / Math.max(1, Number(desired) || 0);
  return (
    scorePart(totals.calories, target.calories) +
    scorePart(totals.proteinG, target.proteinG) +
    scorePart(totals.carbG, target.carbG) +
    scorePart(totals.fatG, target.fatG)
  );
}

function regressesSatisfiedMacro(currentTotals, proposedTotals, target) {
  const macros = [
    ['calories', target.calories],
    ['proteinG', target.proteinG],
    ['carbG', target.carbG],
    ['fatG', target.fatG],
  ];

  return macros.some(([key, desired]) => {
    const denominator = Math.max(1, Number(desired) || 0);
    const currentGap = Math.abs((Number(currentTotals[key]) || 0) - desired) / denominator;
    const proposedGap = Math.abs((Number(proposedTotals[key]) || 0) - desired) / denominator;
    return currentGap <= 0.10 && proposedGap > 0.15;
  });
}

function missesTargetBadly(totals, target, tolerance = STRICT_TARGET_TOLERANCE) {
  const macros = [
    ['calories', target.calories],
    ['proteinG', target.proteinG],
    ['carbG', target.carbG],
    ['fatG', target.fatG],
  ];

  return macros.some(([key, desired]) => (
    Math.abs((Number(totals[key]) || 0) - desired) / Math.max(1, Number(desired) || 0) > tolerance
  ));
}

function totalsFromProposedItems(items) {
  return items.reduce(
    (acc, item) => ({
      calories: parseFloat((acc.calories + item.calories).toFixed(1)),
      proteinG: parseFloat((acc.proteinG + item.proteinG).toFixed(1)),
      carbG: parseFloat((acc.carbG + item.carbG).toFixed(1)),
      fatG: parseFloat((acc.fatG + item.fatG).toFixed(1)),
    }),
    { calories: 0, proteinG: 0, carbG: 0, fatG: 0 },
  );
}

function totalsFromWorkingItems(items) {
  return items.reduce(
    (acc, item) => {
      const factor = item.grams / 100;
      return {
        calories: acc.calories + (item.food.caloriesPer100g ?? 0) * factor,
        proteinG: acc.proteinG + (item.food.proteinGPer100g ?? 0) * factor,
        carbG: acc.carbG + (item.food.carbGPer100g ?? 0) * factor,
        fatG: acc.fatG + (item.food.fatGPer100g ?? 0) * factor,
      };
    },
    { calories: 0, proteinG: 0, carbG: 0, fatG: 0 },
  );
}

function toRoundedTotals(totals) {
  return {
    calories: parseFloat(totals.calories.toFixed(1)),
    proteinG: parseFloat(totals.proteinG.toFixed(1)),
    carbG: parseFloat(totals.carbG.toFixed(1)),
    fatG: parseFloat(totals.fatG.toFixed(1)),
  };
}

function foodConveniencePenalty(food) {
  const name = String(food.name || '').toLowerCase();
  const categories = new Set(food.categories || []);
  let penalty = 0;

  if (name.includes('raw') && (categories.has('egg') || categories.has('eggs') || name.includes('egg'))) {
    penalty += 0.18;
  }
  if (name.includes('oil') || name.includes('butter')) {
    penalty += 0.05;
  }
  if (name.includes('sauce') || name.includes('mustard')) {
    penalty += 0.05;
  }

  return penalty;
}

function scoreWorkingItems(items, target, options = {}) {
  const totals = toRoundedTotals(totalsFromWorkingItems(items));
  let score = macroGapScore(totals, target);
  const originalIds = options.originalIds || new Set();

  for (const [key, desired] of [
    ['calories', target.calories],
    ['proteinG', target.proteinG],
    ['carbG', target.carbG],
    ['fatG', target.fatG],
  ]) {
    const pct = Math.abs((totals[key] - desired) / Math.max(1, desired));
    if (pct > 0.10) score += (pct - 0.10) * 5;
  }

  for (const item of items) {
    const conveniencePenalty = foodConveniencePenalty(item.food);
    if (conveniencePenalty >= 0.18) {
      score += conveniencePenalty;
    }
    if (!originalIds.has(item.food.id)) {
      score += 0.025;
      if (conveniencePenalty < 0.18) score += conveniencePenalty;
    }
  }

  return score;
}

function quantityBounds(food) {
  return {
    min: Number.isFinite(food.minServingG) ? food.minServingG : 1,
    max: Number.isFinite(food.maxServingG) ? food.maxServingG : 500,
  };
}

function clampQuantity(food, grams) {
  const { min, max } = quantityBounds(food);
  return Math.min(max, Math.max(min, grams));
}

function optimizeWorkingItems(seedItems, target, options = {}) {
  let best = seedItems.map((item) => ({ ...item, grams: clampQuantity(item.food, item.grams) }));
  let bestScore = scoreWorkingItems(best, target, options);

  for (const step of [50, 25, 10, 5, 1]) {
    let improved = true;
    let passes = 0;
    while (improved && passes < 60) {
      improved = false;
      passes += 1;

      for (let i = 0; i < best.length; i++) {
        for (const direction of [-1, 1]) {
          const candidate = best.map((item) => ({ ...item }));
          candidate[i].grams = clampQuantity(candidate[i].food, candidate[i].grams + direction * step);
          if (candidate[i].grams === best[i].grams) continue;

          const score = scoreWorkingItems(candidate, target, options);
          if (score < bestScore - 0.0001) {
            best = candidate;
            bestScore = score;
            improved = true;
          }
        }
      }
    }
  }

  return best;
}

function toProposedItems(workingItems) {
  return workingItems.map(({ food, grams }) => {
    const roundedGrams = parseFloat(grams.toFixed(1));
    const factor = roundedGrams / 100;
    return {
      foodId: food.id,
      name: food.name,
      grams: roundedGrams,
      calories: parseFloat(((food.caloriesPer100g ?? 0) * factor).toFixed(1)),
      proteinG: parseFloat(((food.proteinGPer100g ?? 0) * factor).toFixed(1)),
      carbG: parseFloat(((food.carbGPer100g ?? 0) * factor).toFixed(1)),
      fatG: parseFloat(((food.fatGPer100g ?? 0) * factor).toFixed(1)),
    };
  });
}

function buildChangesFromProposal(currentItems, proposedItems) {
  const currentById = new Map(currentItems.map((item) => [String(item.foodId), item]));
  const proposedById = new Map(proposedItems.map((item) => [String(item.foodId), item]));
  const changes = [];

  for (const proposed of proposedItems) {
    const current = currentById.get(String(proposed.foodId));
    if (!current) {
      changes.push({ action: 'add', food_name: proposed.name, grams: proposed.grams });
    } else if (Math.abs((Number(current.grams) || 0) - proposed.grams) > 0.5) {
      changes.push({ action: 'modify', food_name: proposed.name, grams: proposed.grams });
    }
  }

  for (const current of currentItems) {
    if (!proposedById.has(String(current.foodId))) {
      changes.push({ action: 'remove', food_name: current.name });
    }
  }

  return changes;
}

function buildDeterministicMealSuggestion({
  currentItems,
  currentTotals,
  availableFoods,
  foodById,
  foodByName,
  mealTarget,
  blockedFoodIds = new Set(),
  protectedFoodIds = new Set(),
  targetTolerance = STRICT_TARGET_TOLERANCE,
}) {
  const currentWorking = currentItems
    .map((item) => {
      const food = (item.foodId ? foodById.get(String(item.foodId)) : null) || foodByName.get(item.name?.toLowerCase());
      return food ? { food, grams: Number(item.grams) || food.defaultServingG } : null;
    })
    .filter((item) => !blockedFoodIds.has(item.food.id) || protectedFoodIds.has(item.food.id))
    .filter(Boolean);

  if (currentWorking.length === 0) return null;

  const currentScore = macroGapScore(currentTotals || toRoundedTotals(totalsFromWorkingItems(currentWorking)), mealTarget);
  const existingIds = new Set(currentWorking.map((item) => item.food.id));
  const existingSubCategories = new Set(currentWorking.map((item) => item.food.subCategory).filter(Boolean));
  const existingBySubCategory = currentWorking.reduce((acc, item) => {
    if (!item.food.subCategory) return acc;
    if (!acc.has(item.food.subCategory)) acc.set(item.food.subCategory, []);
    acc.get(item.food.subCategory).push(item.food);
    return acc;
  }, new Map());
  const fatNearTarget = Math.abs(((currentTotals?.fatG ?? 0) - mealTarget.fatG) / Math.max(1, mealTarget.fatG)) <= 0.10;
  const addCandidates = availableFoods
    .map((food) => foodById.get(food.id) || foodByName.get(food.name.toLowerCase()))
    .filter(Boolean)
    .filter((food) => !existingIds.has(food.id))
    .filter((food) => !blockedFoodIds.has(food.id))
    .filter((food) => {
      if (!food.subCategory || !existingSubCategories.has(food.subCategory)) return true;
      if (food.macroRole !== 'protein') return false;

      const candidateFatPerProtein = (food.fatGPer100g || 0) / Math.max(1, food.proteinGPer100g || 0);
      return (existingBySubCategory.get(food.subCategory) || []).some((existing) => {
        const existingFatPerProtein = (existing.fatGPer100g || 0) / Math.max(1, existing.proteinGPer100g || 0);
        return candidateFatPerProtein + 0.15 < existingFatPerProtein;
      });
    })
    .filter((food) => !(fatNearTarget && food.macroRole === 'fat'));

  const scoreOptions = { originalIds: existingIds };
  let bestWorking = optimizeWorkingItems(currentWorking, mealTarget, scoreOptions);
  let bestScore = scoreWorkingItems(bestWorking, mealTarget, scoreOptions);

  const evaluateCandidate = (seed) => {
    const optimized = optimizeWorkingItems(seed, mealTarget, scoreOptions);
    const score = scoreWorkingItems(optimized, mealTarget, scoreOptions);
    if (score < bestScore - 0.0001) {
      bestWorking = optimized;
      bestScore = score;
    }
  };

  for (const food of addCandidates) {
    evaluateCandidate([...currentWorking, { food, grams: quantityBounds(food).min }]);
  }

  for (let i = 0; i < currentWorking.length; i++) {
    const current = currentWorking[i];
    if (current.food.macroRole !== 'protein' || !current.food.subCategory) continue;
    const currentFatPerProtein = (current.food.fatGPer100g || 0) / Math.max(1, current.food.proteinGPer100g || 0);
    const currentConveniencePenalty = foodConveniencePenalty(current.food);

    for (const food of availableFoods
      .map((candidate) => foodById.get(candidate.id) || foodByName.get(candidate.name.toLowerCase()))
      .filter(Boolean)) {
      if (food.id === current.food.id || food.subCategory !== current.food.subCategory) continue;
      if (food.macroRole !== 'protein') continue;

      const candidateFatPerProtein = (food.fatGPer100g || 0) / Math.max(1, food.proteinGPer100g || 0);
      const candidateConveniencePenalty = foodConveniencePenalty(food);
      const isLeanerSwap = candidateFatPerProtein + 0.15 < currentFatPerProtein;
      const isMoreConvenientSwap = candidateConveniencePenalty + 0.05 < currentConveniencePenalty;
      if (!isLeanerSwap && !isMoreConvenientSwap) continue;

      const seed = currentWorking.map((item, index) => (
        index === i ? { food, grams: clampQuantity(food, current.grams) } : { ...item }
      ));
      evaluateCandidate(seed);
    }
  }

  const proposedItems = toProposedItems(bestWorking);
  const proposedTotals = totalsFromProposedItems(proposedItems);

  if (bestScore >= currentScore || missesTargetBadly(proposedTotals, mealTarget, targetTolerance)) {
    return null;
  }

  return { proposedItems, proposedTotals };
}

function tokenizeFoodQuery(text) {
  const stopWords = new Set([
    'i', 'u', 'me', 'my', 'am', 'bro',
    'want', 'need', 'telling', 'tell',
    'the', 'a', 'an', 'to', 'with', 'for', 'of', 'instead',
    'please', 'pls', 'can', 'you',
    'make', 'any', 'change', 'balance', 'balanced', 'rebalance',
    'meal', 'food', 'foods', 'it', 'this', 'that', 'as',
  ]);

  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => token.length >= 3)
    .filter((token) => !stopWords.has(token));
}

function normalToken(token) {
  return String(token || '').toLowerCase().replace(/s$/, '');
}

function normalizedWordsFrom(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(normalToken);
}

function searchableFoodText(food) {
  return [
    food.id,
    food.name,
    food.macroRole,
    food.subCategory,
    ...(food.categories || []),
  ].join(' ').toLowerCase();
}

function foodSearchScore(food, tokens) {
  const normalizedTokens = tokens.map(normalToken).filter(Boolean);
  const idWords = normalizedWordsFrom(food.id);
  const nameWords = normalizedWordsFrom(food.name);
  const subCategoryWords = normalizedWordsFrom(food.subCategory);
  const categoryWords = (food.categories || []).flatMap(normalizedWordsFrom);
  const allergenWords = (food.allergens || []).flatMap(normalizedWordsFrom);
  const allWords = [...idWords, ...nameWords, ...subCategoryWords, ...categoryWords, ...allergenWords];

  let score = 0;
  for (const token of normalizedTokens) {
    if (idWords.includes(token)) score += 40;
    if (nameWords.includes(token)) score += 40;
    if (subCategoryWords.includes(token)) score += 18;
    if (categoryWords.includes(token)) score += 8;
    if (allergenWords.includes(token)) score += 8;
    if (!allWords.includes(token) && searchableFoodText(food).includes(token)) score += token.length;
  }

  if (normalizedTokens.includes('toast') && food.id === 'bread_white') score += 40;
  if (normalizedTokens.includes('baladi') && food.id.includes('baladi')) score += 40;
  if (normalizedTokens.includes('white') && food.id === 'bread_white') score += 20;
  if (normalizedTokens.includes('egg')) {
    if (nameWords.includes('egg')) score += 100;
    if (food.id === 'egg_whole_cooked_hard_boiled') score += 30;
    if (food.id === 'egg_whole_cooked_scrambled') score += 25;
    if (String(food.name || '').toLowerCase().includes('raw')) score -= 100;
  }

  score -= foodConveniencePenalty(food) * 100;
  return score;
}

function findBestFoodMatch(query, foods) {
  const tokens = tokenizeFoodQuery(query);
  if (tokens.length === 0) return null;

  let best = null;
  let bestScore = 0;

  for (const food of foods) {
    const score = foodSearchScore(food, tokens);

    if (score > bestScore) {
      best = food;
      bestScore = score;
    }
  }

  return bestScore >= 4 ? best : null;
}

function foodMatchesTokens(food, tokens) {
  const normalizedTokens = tokens.map(normalToken).filter(Boolean);
  if (normalizedTokens.length === 0) return false;

  const fields = [
    food.id,
    food.name,
    food.subCategory,
    food.macroRole,
    ...(food.categories || []),
    ...(food.allergens || []),
  ].map((value) => String(value || '').toLowerCase());
  const normalizedFields = fields.map((field) => field.replace(/s\b/g, ''));

  return normalizedTokens.some((token) => (
    normalizedFields.some((field) => field.includes(token))
  ));
}

function foodDirectlyMatchesTokens(food, tokens) {
  const normalizedTokens = tokens.map(normalToken).filter(Boolean);
  if (normalizedTokens.length === 0) return false;

  const directWords = [
    ...normalizedWordsFrom(food.id),
    ...normalizedWordsFrom(food.name),
    ...normalizedWordsFrom(food.nameAr),
  ];
  const directText = [food.id, food.name, food.nameAr].join(' ').toLowerCase().replace(/s\b/g, '');

  return normalizedTokens.some((token) => directWords.includes(token) || directText.includes(token));
}

function foodMatchesCategoryConstraint(food, constraint) {
  if (!constraint?.tokens?.length) return false;
  const fields = [
    food.id,
    food.name,
    food.macroRole,
    food.subCategory,
    ...(food.categories || []),
    ...(food.allergens || []),
  ].join(' ').toLowerCase();
  const normalizedFields = fields.replace(/s\b/g, '');

  return constraint.tokens.some((token) => normalizedFields.includes(token));
}

function parseSingleCategoryConstraint(message) {
  const text = String(message || '').toLowerCase();
  const matches = [
    text.match(/\b(?:only\s+|just\s+)?(?:one|1|single)\s+([a-z][a-z\s_-]{1,40}?)(?:\s+(?:item|items|food|foods))?(?:\b|$)/),
    text.match(/\b(?:not|no|dont|don't)\s+(?:want\s+)?(?:two|2|multiple|more\s+than\s+one)\s+([a-z][a-z\s_-]{1,40}?)(?:\b|$)/),
  ].filter(Boolean);
  if (matches.length === 0) {
    return null;
  }

  const rawLabel = matches[0][1]
    .replace(/\b(?:just|only|anymore|again|please|pls)\b.*$/i, '')
    .trim();
  const tokens = tokenizeFoodQuery(rawLabel)
    .map(normalToken)
    .filter(Boolean);
  if (tokens.length === 0) return null;

  return { label: tokens.join(' '), tokens, maxCount: 1 };
}

function buildSingleCategorySuggestion({ userMessage, currentItems, availableFoods, foodById, foodByName, mealTarget }) {
  const constraint = parseSingleCategoryConstraint(userMessage);
  if (!constraint) return null;

  const working = currentItems
    .map((item) => {
      const food = (item.foodId ? foodById.get(String(item.foodId)) : null) || foodByName.get(item.name?.toLowerCase());
      return food ? { food, grams: Number(item.grams) || food.defaultServingG } : null;
    })
    .filter(Boolean);
  const constrainedItems = working.filter((item) => foodMatchesCategoryConstraint(item.food, constraint));
  if (constrainedItems.length <= constraint.maxCount) {
    return {
      status: 'negotiating',
      message: `This draft already has only one ${constraint.label} item.`,
    };
  }

  let best = null;
  let bestScore = Infinity;
  for (const keptItem of constrainedItems) {
    const blockedFoodIds = new Set(
      availableFoods
        .map((food) => foodById.get(food.id) || foodByName.get(food.name.toLowerCase()))
        .filter(Boolean)
        .filter((food) => foodMatchesCategoryConstraint(food, constraint))
        .filter((food) => food.id !== keptItem.food.id)
        .map((food) => food.id),
    );

    const fallback = buildDeterministicMealSuggestion({
      currentItems,
      currentTotals: null,
      availableFoods,
      foodById,
      foodByName,
      mealTarget,
      blockedFoodIds,
    });
    if (!fallback) continue;

    const proposedCount = fallback.proposedItems.filter((item) => {
      const food = foodById.get(String(item.foodId));
      return food && foodMatchesCategoryConstraint(food, constraint);
    }).length;
    if (proposedCount > constraint.maxCount) continue;

    const score = macroGapScore(fallback.proposedTotals, mealTarget);
    if (score < bestScore) {
      best = { keptItem, fallback };
      bestScore = score;
    }
  }

  if (!best) {
    return buildConstraintFailureResponse(
      `I could not find a meal that stays close to the targets while keeping only one ${constraint.label} item. I did not apply a different combination because that would ignore your request.`,
    );
  }

  return {
    status: 'ready',
    message: `Kept one ${constraint.label} item (${best.keptItem.food.name}) and rebalanced the meal without the extra ${constraint.label}.`,
    meal_snapshot: best.fallback.proposedItems.map((item) => ({
      name: item.name,
      grams: item.grams,
      calories: item.calories,
      proteinG: item.proteinG,
      carbG: item.carbG,
      fatG: item.fatG,
    })),
    meal_snapshot_totals: best.fallback.proposedTotals,
    changes: buildChangesFromProposal(currentItems, best.fallback.proposedItems),
    proposedItems: best.fallback.proposedItems,
    proposedTotals: best.fallback.proposedTotals,
  };
}

function buildConstraintFailureResponse(message) {
  return {
    status: 'negotiating',
    message,
  };
}

function buildBackendRebalanceResponse(currentItems, fallback, message = 'I rebuilt the draft with backend macro math: keeping the current foods, adjusting portions, and only adding a food if it improves the target fit.') {
  return {
    status: 'ready',
    message,
    meal_snapshot: fallback.proposedItems.map((item) => ({
      name: item.name,
      grams: item.grams,
      calories: item.calories,
      proteinG: item.proteinG,
      carbG: item.carbG,
      fatG: item.fatG,
    })),
    meal_snapshot_totals: fallback.proposedTotals,
    changes: buildChangesFromProposal(currentItems, fallback.proposedItems),
    proposedItems: fallback.proposedItems,
    proposedTotals: fallback.proposedTotals,
  };
}

function isMealChangeRequest(message) {
  return /\b(auto-?balance|balance|rebalance|fix|adjust|change|closer|target|add|remove|swap|replace|instead|without|avoid|no|don't|dont|cannot|can't)\b/i
    .test(String(message || ''));
}

function parseExplicitRemovalRequest(message) {
  const text = String(message || '').toLowerCase();
  const patterns = [
    /\bremove\s+(.+?)(?:\s+and\b|$)/,
    /\btake\s+out\s+(.+?)(?:\s+and\b|$)/,
    /\bdelete\s+(.+?)(?:\s+and\b|$)/,
    /\b(?:do\s+not|don't|dont|not)\s+want\s+(.+?)(?:\s+and\b|$)/,
    /\b(?:can't|cant|cannot)\s+(?:have|eat)\s+(.+?)(?:\s+and\b|$)/,
    /\bwithout\s+(.+?)(?:\s+and\b|$)/,
    /\b(?:do\s+not|don't|dont|not)\s+like\s+(.+?)(?:\s+and\b|$)/,
    /\bdislike\s+(.+?)(?:\s+and\b|$)/,
    /\bavoid\s+(.+?)(?:\s+and\b|$)/,
    /\bno\s+(.+?)(?:\s+and\b|$)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const tokens = tokenizeFoodQuery(match[1]);
      if (tokens.length > 0) return { query: match[1], tokens };
    }
  }

  return null;
}

function buildExplicitRemovalSuggestion({ userMessage, currentItems, availableFoods, foodById, foodByName, mealTarget }) {
  const parsed = parseExplicitRemovalRequest(userMessage);
  if (!parsed) return null;

  const currentFoods = currentItems
    .map((item) => (item.foodId ? foodById.get(String(item.foodId)) : null) || foodByName.get(item.name?.toLowerCase()))
    .filter(Boolean);
  const directRemovedFoods = currentFoods.filter((food) => foodDirectlyMatchesTokens(food, parsed.tokens));
  const removedFoods = directRemovedFoods.length > 0
    ? directRemovedFoods
    : currentFoods.filter((food) => foodMatchesTokens(food, parsed.tokens));
  if (removedFoods.length === 0) return null;
  const isDirectRemoval = directRemovedFoods.length > 0;
  const removalMatcher = isDirectRemoval ? foodDirectlyMatchesTokens : foodMatchesTokens;

  const blockedFoodIds = new Set(
    availableFoods
      .map((food) => foodById.get(food.id) || foodByName.get(food.name.toLowerCase()))
      .filter(Boolean)
      .filter((food) => (isDirectRemoval ? foodMatchesTokens(food, parsed.tokens) : removalMatcher(food, parsed.tokens)))
      .map((food) => food.id),
  );
  for (const food of removedFoods) blockedFoodIds.add(food.id);
  const convenienceBlockedFoods = currentFoods.filter((food) => foodConveniencePenalty(food) >= 0.18);
  for (const food of convenienceBlockedFoods) blockedFoodIds.add(food.id);
  const removedFoodIds = new Set(removedFoods.map((food) => food.id));
  const convenienceBlockedFoodIds = new Set(convenienceBlockedFoods.map((food) => food.id));
  const protectedFoodIds = new Set(
    currentFoods
      .filter((food) => !removedFoodIds.has(food.id) && !convenienceBlockedFoodIds.has(food.id))
      .map((food) => food.id),
  );

  const fallback = buildDeterministicMealSuggestion({
    currentItems,
    currentTotals: null,
    availableFoods,
    foodById,
    foodByName,
    mealTarget,
    blockedFoodIds,
    protectedFoodIds,
    targetTolerance: CONSTRAINED_REQUEST_TOLERANCE,
  });

  if (!fallback) {
    return buildConstraintFailureResponse(
      `I could not find a meal that stays close to the targets after removing ${removedFoods.map((food) => food.name).join(', ')}. I did not apply a different combination because that would ignore your request.`,
    );
  }

  return {
    status: 'ready',
    message: [
      `Removed ${removedFoods.map((food) => food.name).join(', ')} and rebalanced the meal without that ${isDirectRemoval ? 'food' : 'food group'}.`,
      convenienceBlockedFoods.length
        ? `I also replaced ${convenienceBlockedFoods.map((food) => food.name).join(', ')} with a more practical option.`
        : '',
    ].filter(Boolean).join(' '),
    meal_snapshot: fallback.proposedItems.map((item) => ({
      name: item.name,
      grams: item.grams,
      calories: item.calories,
      proteinG: item.proteinG,
      carbG: item.carbG,
      fatG: item.fatG,
    })),
    meal_snapshot_totals: fallback.proposedTotals,
    changes: buildChangesFromProposal(currentItems, fallback.proposedItems),
    proposedItems: fallback.proposedItems,
    proposedTotals: fallback.proposedTotals,
  };
}

function parseExplicitSwapRequest(message) {
  const text = String(message || '').toLowerCase();
  if (!/\b(swap|replace|instead of|change)\b/.test(text)) return null;

  let sourceQuery = '';
  let targetQuery = '';

  let match = text.match(/\bswap\s+(.+?)\s+(?:with|for|to)\s+(.+)$/);
  if (match) {
    sourceQuery = match[1];
    targetQuery = match[2];
  } else {
    match = text.match(/\breplace\s+(.+?)\s+(?:with|for|to)\s+(.+)$/);
    if (match) {
      sourceQuery = match[1];
      targetQuery = match[2];
    }
  }

  if (!sourceQuery || !targetQuery) {
    match = text.match(/(.+?)\s+instead of\s+(.+)$/);
    if (match) {
      targetQuery = match[1];
      sourceQuery = match[2];
    }
  }

  return sourceQuery && targetQuery ? { sourceQuery, targetQuery } : null;
}

function buildExplicitSwapSuggestion({ userMessage, currentItems, availableFoods, foodById, foodByName, mealTarget }) {
  const parsed = parseExplicitSwapRequest(userMessage);
  if (!parsed) return null;

  const currentWorking = currentItems
    .map((item) => {
      const food = (item.foodId ? foodById.get(String(item.foodId)) : null) || foodByName.get(item.name?.toLowerCase());
      return food ? { food, grams: Number(item.grams) || food.defaultServingG } : null;
    })
    .filter(Boolean);
  const availableFullFoods = availableFoods
    .map((food) => foodById.get(food.id) || foodByName.get(food.name.toLowerCase()))
    .filter(Boolean);

  const sourceFood = findBestFoodMatch(parsed.sourceQuery, currentWorking.map((item) => item.food));
  const targetFood = findBestFoodMatch(parsed.targetQuery, availableFullFoods);
  if (!sourceFood || !targetFood || sourceFood.id === targetFood.id) return null;

  const sourceItem = currentWorking.find((item) => item.food.id === sourceFood.id);
  if (!sourceItem) return null;

  const sourceCalories = (sourceFood.caloriesPer100g || 0) * sourceItem.grams / 100;
  const startingTargetGrams = sourceCalories > 0 && targetFood.caloriesPer100g > 0
    ? sourceCalories / targetFood.caloriesPer100g * 100
    : sourceItem.grams;

  const swapped = currentWorking.map((item) => (
    item.food.id === sourceFood.id
      ? { food: targetFood, grams: clampQuantity(targetFood, startingTargetGrams) }
      : { ...item }
  ));

  const optimized = optimizeWorkingItems(swapped, mealTarget, {
    originalIds: new Set(swapped.map((item) => item.food.id)),
  });
  const proposedItems = toProposedItems(optimized);
  const proposedTotals = totalsFromProposedItems(proposedItems);

  if (missesTargetBadly(proposedTotals, mealTarget, CONSTRAINED_REQUEST_TOLERANCE)) {
    return buildConstraintFailureResponse(
      `I found the requested swap from ${sourceFood.name} to ${targetFood.name}, but I could not keep the meal close to the targets with that swap. I did not apply a different swap because that would ignore your request.`,
    );
  }

  return {
    status: 'ready',
    message: `Swapped ${sourceFood.name} for ${targetFood.name} and adjusted portions to keep the meal close to target.`,
    meal_snapshot: proposedItems.map((item) => ({
      name: item.name,
      grams: item.grams,
      calories: item.calories,
      proteinG: item.proteinG,
      carbG: item.carbG,
      fatG: item.fatG,
    })),
    meal_snapshot_totals: proposedTotals,
    changes: buildChangesFromProposal(currentItems, proposedItems),
    proposedItems,
    proposedTotals,
  };
}

async function mealChatHandler(req, res, next) {
  try {
    const { mealTag, mealTarget, currentItems, currentTotals, userPreferences, conversationHistory, userMessage } = req.body;
    if (!mealTag || !mealTarget || !Array.isArray(currentItems) || !userMessage) {
      return res.status(400).json({ error: 'mealTag, mealTarget, currentItems, and userMessage are required.' });
    }

    const safePreferences = {
      dietType: userPreferences?.dietType || 'standard',
      avoidFoods: Array.isArray(userPreferences?.avoidFoods) ? userPreferences.avoidFoods : [],
    };

    const foods = getFoods();
    const foodByName = new Map(foods.map((f) => [f.name.toLowerCase(), f]));
    const foodById = new Map(foods.map((f) => [f.id, f]));

    // AI call
    const availableFoods = filterFoodsForChatbox({ foods, mealTag, userInput: safePreferences });
    const explicitSwap = buildExplicitSwapSuggestion({
      userMessage,
      currentItems,
      availableFoods,
      foodById,
      foodByName,
      mealTarget,
    });
    if (explicitSwap) {
      return res.json(explicitSwap);
    }

    const singleCategory = buildSingleCategorySuggestion({
      userMessage,
      currentItems,
      availableFoods,
      foodById,
      foodByName,
      mealTarget,
    });
    if (singleCategory) {
      return res.json(singleCategory);
    }

    const explicitRemoval = buildExplicitRemovalSuggestion({
      userMessage,
      currentItems,
      availableFoods,
      foodById,
      foodByName,
      mealTarget,
    });
    if (explicitRemoval) {
      return res.json(explicitRemoval);
    }

    const turnCount = Array.isArray(conversationHistory) ? Math.ceil(conversationHistory.length / 2) : 0;
    const currentFoodCategories = [...new Set(currentItems.flatMap((i) => i.categories || []))];

    const calGap = Math.round(mealTarget.calories - (currentTotals?.calories ?? 0));
    const pGap = Math.round(mealTarget.proteinG - (currentTotals?.proteinG ?? 0));
    const cGap = Math.round(mealTarget.carbG - (currentTotals?.carbG ?? 0));
    const fGap = Math.round(mealTarget.fatG - (currentTotals?.fatG ?? 0));

    const turnRule = turnCount >= 2
      ? 'MANDATORY: respond with status "ready" now.'
      : turnCount === 1
        ? 'Next response must be status "ready".'
        : 'Use "negotiating" only if you must ask the user to choose; otherwise respond "ready" immediately.';

    const systemContent = `You are a friendly meal assistant. Always respond in valid JSON only.

STEP 1 — Is the user asking you to CHANGE this meal (add/remove a food, adjust grams, swap an ingredient)?
- If YES → respond with status "ready". Include "changes" and "meal_snapshot".
- If NO → respond with status "negotiating". Use the MEAL CONTEXT below to answer any meal questions accurately. Do NOT include "changes".

MEAL CONTEXT:
TARGET: ${mealTarget.calories}kcal P${mealTarget.proteinG}g C${mealTarget.carbG}g F${mealTarget.fatG}g
CURRENT: ${currentTotals?.calories ?? 0}kcal P${currentTotals?.proteinG ?? 0}g C${currentTotals?.carbG ?? 0}g F${currentTotals?.fatG ?? 0}g
GAP: ${calGap}kcal P${pGap}g C${cGap}g F${fGap}g
DIET: ${safePreferences.dietType} | MEAL: ${mealTag} | USER AVOIDS: ${safePreferences.avoidFoods.join(', ') || 'none'}
CURRENT FOOD CATEGORIES (not blocked; use for context only): ${currentFoodCategories.join(', ') || 'none'}

CURRENT FOODS (name | current grams | allowed min-maxg | kcal | P C F now | role | kcal P C F per100g):
${currentItems.map((i) => {
  const food = (i.foodId ? foodById.get(String(i.foodId)) : null) || foodByName.get(i.name?.toLowerCase());
  return `${i.name} | ${i.grams}g | ${food?.minServingG ?? 1}-${food?.maxServingG ?? 500}g | ${i.calories}kcal | P${i.proteinG} C${i.carbG} F${i.fatG} | ${i.macroRole} | ${food?.caloriesPer100g ?? 0}kcal P${food?.proteinGPer100g ?? 0} C${food?.carbGPer100g ?? 0} F${food?.fatGPer100g ?? 0}`;
}).join('\n')}

AVAILABLE FOODS — only suggest from this list (name | role | min-maxg | kcal P C F per100g):
${availableFoods.map((f) => `${f.name}|${f.macroRole}|${f.minServingG}-${f.maxServingG}g|${f.caloriesPer100g}kcal P${f.proteinGPer100g} C${f.carbGPer100g} F${f.fatGPer100g}`).join('\n')}

MEAL ADJUSTMENT RULES (only apply when making meal changes):
1. Only use foods from AVAILABLE FOODS. Calculate macros from per100g values (val=per100g/100*grams). Never use training knowledge.
2. Preserve every CURRENT FOOD unless the user explicitly asks to remove/swap/replace it. For auto-balance suggestions, keep the meal recognizable.
3. Stay within each food's min-max grams. Never remove all foods.
4. First adjust existing food grams to close the gap; only add a new food if existing foods cannot reasonably close the largest remaining gap.
5. Follow the gap direction: if carbs are short, prioritize carb-role or low-fat mixed foods; if protein is short, prioritize protein-role foods; if fat is already within 10% of target, do not add fat-role foods or high-fat foods such as nuts/oils/cheese.
6. Do not replace bread with oats, dairy with nuts, or similar broad swaps unless the user specifically asks for a swap.
7. Never add a food from USER AVOIDS or the wrong meal type.
8. Before responding with status "ready", recalculate meal_snapshot_totals. Every macro should be within 10% of target, and no macro may be more than 15% over or under target.
9. If you cannot make a valid draft, respond with status "negotiating" and explain the closest sensible adjustment instead of inventing a bad draft.
10. ${turnRule}
11. A meal is ON TARGET if every gap (calories, protein, carbs, fat) is within 5% of its target value. If the user asks whether the meal hits the targets, use this rule to answer accurately.

Always respond in valid JSON only — no text outside the JSON object.
WHEN CHATTING (no changes): {"status":"negotiating","message":"<write your actual response here>","meal_snapshot":[{"name":"<food name>","grams":0,"calories":0,"proteinG":0,"carbG":0,"fatG":0}],"meal_snapshot_totals":{"calories":0,"proteinG":0,"carbG":0,"fatG":0}}
WHEN MAKING CHANGES: {"status":"ready","message":"<write your actual response here>","meal_snapshot":[{"name":"<food name>","grams":0,"calories":0,"proteinG":0,"carbG":0,"fatG":0}],"meal_snapshot_totals":{"calories":0,"proteinG":0,"carbG":0,"fatG":0},"changes":[{"action":"modify","food_name":"<exact name from CURRENT FOODS>","grams":0},{"action":"add","food_name":"<exact name from AVAILABLE FOODS>","grams":0},{"action":"remove","food_name":"<exact name from CURRENT FOODS>"}]}
meal_snapshot must list ALL foods in the final meal (including unchanged ones) using exact names from CURRENT FOODS or AVAILABLE FOODS.`;

    const messages = [
      { role: 'system', content: systemContent },
      ...(Array.isArray(conversationHistory) ? conversationHistory : []),
      { role: 'user', content: userMessage },
    ];

    let payload;
    try {
      payload = await chatWithLLM(messages);
    } catch (llmError) {
      console.error('MEAL CHAT LLM ERROR:', llmError.message);
      const fallback = isMealChangeRequest(userMessage)
        ? buildDeterministicMealSuggestion({
          currentItems,
          currentTotals,
          availableFoods,
          foodById,
          foodByName,
          mealTarget,
        })
        : null;

      if (fallback) {
        return res.json(buildBackendRebalanceResponse(currentItems, fallback));
      }

      return res.json(buildConstraintFailureResponse(
        'I could not get a reliable AI response, and the backend solver could not find a valid meal draft. I did not apply any changes.',
      ));
    }

    // Rebuild proposed meal from DB values (never trust LLM math)
    if (payload.status === 'ready') {
      let workingItems = currentItems
        .map((ci) => {
          const food = (ci.foodId ? foodById.get(String(ci.foodId)) : null) || foodByName.get(ci.name?.toLowerCase());
          return food ? { food, grams: Number(ci.grams) } : null;
        })
        .filter(Boolean);

      // Primary: use meal_snapshot (the model's full view of the meal after changes).
      // This is more reliable than `changes` because small models often forget to include
      // the changes array or use the wrong action type, but always fill in meal_snapshot.
      if (Array.isArray(payload.meal_snapshot) && payload.meal_snapshot.length > 0) {
        const explicitRemovals = new Set(
          (Array.isArray(payload.changes) ? payload.changes : [])
            .filter((change) => change.action === 'remove')
            .map((change) => change.food_name?.toLowerCase())
            .filter(Boolean),
        );
        workingItems = workingItems.filter((item) => !explicitRemovals.has(item.food.name.toLowerCase()));

        const snapshotItems = payload.meal_snapshot
          .map((snap) => {
            const food = foodByName.get(snap.name?.toLowerCase());
            const grams = Math.max(1, Number(snap.grams) || 0);
            return food ? { food, grams } : null;
          })
          .filter(Boolean);
        for (const snapshotItem of snapshotItems) {
          const existing = workingItems.find((item) => item.food.id === snapshotItem.food.id);
          if (existing) existing.grams = snapshotItem.grams;
          else workingItems.push(snapshotItem);
        }
      } else if (Array.isArray(payload.changes) && payload.changes.length > 0) {
        // Fallback: apply changes action list
        for (const change of payload.changes) {
          const food = foodByName.get(change.food_name?.toLowerCase());
          if (!food) continue;
          if (change.action === 'remove') {
            workingItems = workingItems.filter((i) => i.food.name.toLowerCase() !== change.food_name.toLowerCase());
          } else if (change.action === 'add') {
            if (!workingItems.some((i) => i.food.name.toLowerCase() === change.food_name.toLowerCase())) {
              workingItems.push({ food, grams: Number(change.grams) });
            }
          } else if (change.action === 'modify') {
            const existing = workingItems.find((i) => i.food.name.toLowerCase() === change.food_name.toLowerCase());
            if (existing) existing.grams = Number(change.grams);
          }
        }
      }

      const proposedItems = workingItems.map(({ food, grams }) => {
        const factor = grams / 100;
        return {
          foodId: food.id,
          name: food.name,
          grams,
          calories: parseFloat(((food.caloriesPer100g ?? 0) * factor).toFixed(1)),
          proteinG: parseFloat(((food.proteinGPer100g ?? 0) * factor).toFixed(1)),
          carbG: parseFloat(((food.carbGPer100g ?? 0) * factor).toFixed(1)),
          fatG: parseFloat(((food.fatGPer100g ?? 0) * factor).toFixed(1)),
        };
      });
      console.log('[meal-chat] proposedItems:', JSON.stringify(proposedItems));

      // Only attach proposedItems if something actually changed
      const somethingChanged = proposedItems.some((pi) => {
        const orig = currentItems.find((ci) => {
          const food = (ci.foodId ? foodById.get(String(ci.foodId)) : null) || foodByName.get(ci.name?.toLowerCase());
          return food?.id === pi.foodId;
        });
        return !orig || Math.abs(Number(orig.grams) - pi.grams) > 0.5;
      }) || proposedItems.length !== currentItems.length;

      if (somethingChanged) {
        const proposedTotals = totalsFromProposedItems(proposedItems);
        const currentScore = macroGapScore(currentTotals || totalsFromProposedItems(currentItems), mealTarget);
        const proposedScore = macroGapScore(proposedTotals, mealTarget);
        const invalidRegression = regressesSatisfiedMacro(currentTotals || totalsFromProposedItems(currentItems), proposedTotals, mealTarget);
        const invalidTargetMiss = missesTargetBadly(proposedTotals, mealTarget);

        if (invalidRegression || invalidTargetMiss || proposedScore >= currentScore) {
          const fallback = buildDeterministicMealSuggestion({
            currentItems,
            currentTotals,
            availableFoods,
            foodById,
            foodByName,
            mealTarget,
          });

          if (fallback) {
            Object.assign(payload, buildBackendRebalanceResponse(currentItems, fallback));
          } else {
            payload.status = 'negotiating';
            payload.message = 'That draft was not close enough to the meal targets, so I did not apply it. For this meal, keep the current foods and adjust the main carb/protein portions first instead of adding high-fat foods.';
            delete payload.proposedItems;
            delete payload.proposedTotals;
          }
        } else {
          payload.proposedItems = proposedItems;
          payload.proposedTotals = proposedTotals;
        }
      }
    }

    res.json(payload);
  } catch (error) {
    console.error('MEAL CHAT ERROR:', error.message, error.stack);
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  health,
  getFoodsHandler,
  getPreferences,
  generatePlanHandler,
  generatePlanFreeformHandler,
  rebalanceMealHandler,
  mealOptionsHandler,
  mealChatHandler,
  guidedMealSuggestionHandler,
};
