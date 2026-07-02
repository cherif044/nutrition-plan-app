const { getPreferenceOptions } = require('../config/preferenceTaxonomy');
const { generatePlan, generatePlanFreeform, getFoods, rebalanceMeal, autoBalanceMeal, computeMealBounds, computeSensitivityMatrix, checkRebalanceFeasibility, filterFoodsForChatbox } = require('../services/planGenerator');
const { loadFoods } = require('../repositories/foodRepository');
const { chatWithLLM } = require('../services/llmService');

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
    const { mealTarget, items, mealBounds } = req.body;
    if (!mealTarget || !Array.isArray(items)) {
      return res.status(400).json({ error: 'mealTarget and items are required.' });
    }
    res.json(rebalanceMeal({ mealTarget, items, mealBounds }));
  } catch (error) {
    next(error);
  }
}

function checkSwapHandler(req, res, next) {
  try {
    const { mealTarget, items, mealBounds } = req.body;
    if (!mealTarget || !Array.isArray(items)) {
      return res.status(400).json({ error: 'mealTarget and items are required.' });
    }
    res.json(checkRebalanceFeasibility({ mealTarget, items, mealBounds }));
  } catch (error) {
    next(error);
  }
}

function autoBalanceMealHandler(req, res, next) {
  try {
    const { items, originalItems, mealTag } = req.body;
    if (!Array.isArray(items) || !Array.isArray(originalItems)) {
      return res.status(400).json({ error: 'items and originalItems must be arrays.' });
    }
    res.json(autoBalanceMeal({ items, originalItems, mealTag }));
  } catch (error) {
    next(error);
  }
}

function computeSensitivityHandler(req, res, next) {
  try {
    const { mealTarget, items: rawItems } = req.body;
    if (!mealTarget || !Array.isArray(rawItems)) {
      return res.status(400).json({ error: 'mealTarget and items are required.' });
    }
    const foods = loadFoods();
    const foodMap = new Map(foods.map((f) => [f.id, f]));
    const items = rawItems.map((item) => {
      const food = foodMap.get(String(item.foodId));
      if (!food) throw new Error(`Unknown food id: ${item.foodId}`);
      return { food, quantityG: Number(item.quantityG) || food.defaultServingG };
    });
    res.json({ sensitivityMatrix: computeSensitivityMatrix(items, mealTarget) });
  } catch (error) {
    next(error);
  }
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

function missesTargetBadly(totals, target) {
  const macros = [
    ['calories', target.calories],
    ['proteinG', target.proteinG],
    ['carbG', target.carbG],
    ['fatG', target.fatG],
  ];

  return macros.some(([key, desired]) => (
    Math.abs((Number(totals[key]) || 0) - desired) / Math.max(1, Number(desired) || 0) > 0.10
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
    if (!originalIds.has(item.food.id)) {
      score += 0.025;
      score += foodConveniencePenalty(item.food);
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

function buildDeterministicMealSuggestion({ currentItems, currentTotals, availableFoods, foodById, foodByName, mealTarget }) {
  const currentWorking = currentItems
    .map((item) => {
      const food = (item.foodId ? foodById.get(String(item.foodId)) : null) || foodByName.get(item.name?.toLowerCase());
      return food ? { food, grams: Number(item.grams) || food.defaultServingG } : null;
    })
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

    for (const food of availableFoods
      .map((candidate) => foodById.get(candidate.id) || foodByName.get(candidate.name.toLowerCase()))
      .filter(Boolean)) {
      if (food.id === current.food.id || food.subCategory !== current.food.subCategory) continue;
      if (food.macroRole !== 'protein') continue;

      const candidateFatPerProtein = (food.fatGPer100g || 0) / Math.max(1, food.proteinGPer100g || 0);
      if (candidateFatPerProtein + 0.15 >= currentFatPerProtein) continue;

      const seed = currentWorking.map((item, index) => (
        index === i ? { food, grams: clampQuantity(food, current.grams) } : { ...item }
      ));
      evaluateCandidate(seed);
    }
  }

  const proposedItems = toProposedItems(bestWorking);
  const proposedTotals = totalsFromProposedItems(proposedItems);

  if (bestScore >= currentScore || missesTargetBadly(proposedTotals, mealTarget)) {
    return null;
  }

  return { proposedItems, proposedTotals };
}

function tokenizeFoodQuery(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !new Set(['i', 'want', 'need', 'the', 'a', 'an', 'to', 'with', 'for', 'of', 'instead', 'please', 'can', 'you']).has(token));
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

function findBestFoodMatch(query, foods) {
  const tokens = tokenizeFoodQuery(query);
  if (tokens.length === 0) return null;

  let best = null;
  let bestScore = 0;

  for (const food of foods) {
    const searchText = searchableFoodText(food);
    let score = 0;

    for (const token of tokens) {
      if (searchText.includes(token)) score += token.length;
    }

    if (tokens.includes('toast') && food.id === 'bread_white') score += 40;
    if (tokens.includes('baladi') && food.id.includes('baladi')) score += 40;
    if (tokens.includes('white') && food.id === 'bread_white') score += 20;

    if (score > bestScore) {
      best = food;
      bestScore = score;
    }
  }

  return bestScore >= 4 ? best : null;
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

    const payload = await chatWithLLM(messages);

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
            payload.status = 'ready';
            payload.message = 'I rebuilt the draft with backend macro math: keeping the current foods, adjusting portions, and only adding a food if it improves the target fit.';
            payload.proposedItems = fallback.proposedItems;
            payload.proposedTotals = fallback.proposedTotals;
            payload.meal_snapshot = fallback.proposedItems.map((item) => ({
              name: item.name,
              grams: item.grams,
              calories: item.calories,
              proteinG: item.proteinG,
              carbG: item.carbG,
              fatG: item.fatG,
            }));
            payload.meal_snapshot_totals = fallback.proposedTotals;
            payload.changes = buildChangesFromProposal(currentItems, fallback.proposedItems);
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

async function validateMealChangesHandler(req, res, next) {
  try {
    const { mealTarget, mealTag, currentItems, changes } = req.body;
    if (!mealTarget || !Array.isArray(currentItems) || !Array.isArray(changes)) {
      return res.status(400).json({ error: 'mealTarget, currentItems, and changes are required.' });
    }

    const foods = getFoods();
    const foodByName = new Map(foods.map((f) => [f.name.toLowerCase(), f]));
    const foodById = new Map(foods.map((f) => [f.id, f]));

    // Validate all food names in changes
    for (const change of changes) {
      if (change.action === 'add' || change.action === 'modify' || change.action === 'remove') {
        const found = foodByName.get(change.food_name?.toLowerCase());
        if (!found) {
          return res.json({ valid: false, reason: 'food_not_found', food_name: change.food_name });
        }
      }
    }

    // Build existing item categories for overlap checks
    const existingFoods = currentItems
      .map((ci) => (ci.foodId ? foodById.get(String(ci.foodId)) : null) || foodByName.get(ci.name?.toLowerCase()))
      .filter(Boolean);
    const existingCategories = new Set(existingFoods.flatMap((f) => f.categories || []));

    // Extra validation for 'add' actions: mealTag and category overlap
    for (const change of changes) {
      if (change.action !== 'add') continue;
      const food = foodByName.get(change.food_name?.toLowerCase());
      if (!food) continue;

      if (mealTag && !food.mealTags?.includes(mealTag)) {
        return res.json({ valid: false, reason: 'wrong_meal_type', food_name: food.name, mealTag });
      }

      const overlap = (food.categories || []).find((c) => existingCategories.has(c));
      if (overlap) {
        return res.json({ valid: false, reason: 'category_overlap', food_name: food.name, duplicateCategory: overlap });
      }
    }

    // Start from current items
    let items = currentItems.map((ci) => {
      const food = ci.foodId ? foodById.get(String(ci.foodId)) : foodByName.get(ci.name?.toLowerCase());
      if (!food) return null;
      return { food, grams: Number(ci.grams) };
    }).filter(Boolean);

    // Apply changes
    for (const change of changes) {
      const food = foodByName.get(change.food_name.toLowerCase());
      if (change.action === 'remove') {
        items = items.filter((i) => i.food.name.toLowerCase() !== change.food_name.toLowerCase());
      } else if (change.action === 'add') {
        items.push({ food, grams: Number(change.grams) });
      } else if (change.action === 'modify') {
        const existing = items.find((i) => i.food.name.toLowerCase() === change.food_name.toLowerCase());
        if (existing) existing.grams = Number(change.grams);
      }
    }

    // Validate quantities
    for (const item of items) {
      const { food, grams } = item;
      const min = food.minServingG ?? 20;
      const max = food.maxServingG ?? 500;
      if (grams < min || grams > max) {
        return res.json({ valid: false, reason: 'quantity_out_of_range', food_name: food.name });
      }
    }

    // Compute proposed totals
    const proposedTotals = items.reduce(
      (acc, { food, grams }) => {
        const factor = grams / 100;
        acc.calories += food.caloriesPer100g * factor;
        acc.proteinG += food.proteinGPer100g * factor;
        acc.carbG += food.carbGPer100g * factor;
        acc.fatG += food.fatGPer100g * factor;
        return acc;
      },
      { calories: 0, proteinG: 0, carbG: 0, fatG: 0 },
    );

    // Round totals
    for (const key of ['calories', 'proteinG', 'carbG', 'fatG']) {
      proposedTotals[key] = parseFloat(proposedTotals[key].toFixed(1));
    }

    // Check macros within tolerance of target
    console.log('VALIDATION - target:', mealTarget, 'proposed:', proposedTotals);
    const TOLERANCE = 0.10;
    for (const key of ['calories', 'proteinG', 'carbG', 'fatG']) {
      const tgt = mealTarget[key];
      const actual = proposedTotals[key];
      if (Math.abs(actual - tgt) / Math.max(1, tgt) > TOLERANCE) {
        return res.json({
          valid: false,
          reason: 'macros_off_target',
          details: {
            key,
            target: tgt,
            actual,
            deviation: parseFloat(((Math.abs(actual - tgt) / Math.max(1, tgt)) * 100).toFixed(1)),
          },
        });
      }
    }

    const proposedItems = items.map(({ food, grams }) => {
      const factor = grams / 100;
      return {
        foodId: food.id,
        name: food.name,
        grams,
        calories: parseFloat((food.caloriesPer100g * factor).toFixed(1)),
        proteinG: parseFloat((food.proteinGPer100g * factor).toFixed(1)),
        carbG: parseFloat((food.carbGPer100g * factor).toFixed(1)),
        fatG: parseFloat((food.fatGPer100g * factor).toFixed(1)),
      };
    });

    res.json({ valid: true, proposedItems, proposedTotals });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  health,
  getFoodsHandler,
  getPreferences,
  generatePlanHandler,
  generatePlanFreeformHandler,
  rebalanceMealHandler,
  checkSwapHandler,
  autoBalanceMealHandler,
  computeSensitivityHandler,
  mealChatHandler,
  validateMealChangesHandler,
};
