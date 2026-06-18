const { getPreferenceOptions } = require('../config/preferenceTaxonomy');
const { generatePlan, getFoods, rebalanceMeal, autoBalanceMeal, computeMealBounds, computeSensitivityMatrix, checkRebalanceFeasibility, filterFoodsForChatbox } = require('../services/planGenerator');
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

    // AI call
    const availableFoods = filterFoodsForChatbox({ foods, mealTag, userInput: safePreferences });
    const turnCount = Array.isArray(conversationHistory) ? Math.ceil(conversationHistory.length / 2) : 0;
    const existingCategories = [...new Set(currentItems.flatMap((i) => i.categories || []))];

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

STEP 1 — Is the user's message about adjusting this meal (food, nutrition, macros, calories, grams, swapping or adding foods)?
- If YES → use the meal context below, respond with status "ready" and include "changes".
- If NO → reply conversationally, status "negotiating", do NOT include "changes" or touch the meal.

MEAL CONTEXT (use only if the user is asking about the meal):
TARGET: ${mealTarget.calories}kcal P${mealTarget.proteinG}g C${mealTarget.carbG}g F${mealTarget.fatG}g
CURRENT: ${currentTotals?.calories ?? 0}kcal P${currentTotals?.proteinG ?? 0}g C${currentTotals?.carbG ?? 0}g F${currentTotals?.fatG ?? 0}g
GAP: ${calGap}kcal P${pGap}g C${cGap}g F${fGap}g
DIET: ${safePreferences.dietType} | MEAL: ${mealTag} | BLOCKED CATEGORIES: ${existingCategories.join(', ') || 'none'}

CURRENT FOODS (name | grams | kcal | P C F | role):
${currentItems.map((i) => `${i.name} | ${i.grams}g | ${i.calories}kcal | P${i.proteinG} C${i.carbG} F${i.fatG} | ${i.macroRole}`).join('\n')}

AVAILABLE FOODS — only suggest from this list (name | role | min-maxg | kcal P C F per100g):
${availableFoods.map((f) => `${f.name}|${f.macroRole}|${f.minServingG}-${f.maxServingG}g|${f.caloriesPer100g}kcal P${f.proteinGPer100g} C${f.carbGPer100g} F${f.fatGPer100g}`).join('\n')}

MEAL ADJUSTMENT RULES (only apply when making meal changes):
1. Only use foods from AVAILABLE FOODS. Calculate macros from per100g values (val=per100g/100*grams). Never use training knowledge.
2. Stay within each food's min-max grams. Never remove all foods.
3. First increase existing food grams to close the gap; only add a new food if existing foods are at their max.
4. Never add a food that shares a BLOCKED CATEGORY or is wrong meal type.
5. ${turnRule}
6. A meal is ON TARGET if every gap (calories, protein, carbs, fat) is within 5% of its target value. If the user asks whether the meal hits the targets, use this rule to answer accurately.

Always respond in valid JSON only — no text outside the JSON object.
WHEN CHATTING (no changes): {"status":"negotiating","message":"<write your actual response here>","meal_snapshot":[{"name":"<food name>","grams":0,"calories":0,"proteinG":0,"carbG":0,"fatG":0}],"meal_snapshot_totals":{"calories":0,"proteinG":0,"carbG":0,"fatG":0}}
WHEN MAKING CHANGES: {"status":"ready","message":"<write your actual response here>","meal_snapshot":[{"name":"<food name>","grams":0,"calories":0,"proteinG":0,"carbG":0,"fatG":0}],"meal_snapshot_totals":{"calories":0,"proteinG":0,"carbG":0,"fatG":0},"changes":[{"action":"add","food_name":"<exact name from AVAILABLE FOODS>","grams":0}]}
meal_snapshot must show the full meal after all changes with macros recalculated from database values.`;

    const messages = [
      { role: 'system', content: systemContent },
      ...(Array.isArray(conversationHistory) ? conversationHistory : []),
      { role: 'user', content: userMessage },
    ];

    const payload = await chatWithLLM(messages);
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
  rebalanceMealHandler,
  checkSwapHandler,
  autoBalanceMealHandler,
  computeSensitivityHandler,
  mealChatHandler,
  validateMealChangesHandler,
};
