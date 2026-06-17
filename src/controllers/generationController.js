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

    const foods = getFoods();
    const foodById = new Map(foods.map((f) => [f.id, f]));
    const foodByName = new Map(foods.map((f) => [f.name.toLowerCase(), f]));

    // TIER 1: Pure JS balancing — try to hit mealTarget by adjusting existing food grams only
    // rebalanceMeal expects { foodId, quantityG } and does its own food lookup internally
    const rebalanceInput = currentItems
      .map((ci) => {
        const food = (ci.foodId ? foodById.get(String(ci.foodId)) : null) || foodByName.get(ci.name?.toLowerCase());
        return food ? { foodId: food.id, quantityG: Number(ci.grams), food } : null;
      })
      .filter(Boolean);

    let atLimitFoods = [];
    let remainingGap = null;

    if (rebalanceInput.length > 0) {
      const mealBounds = computeMealBounds(mealTarget, 0.05);
      const tier1Result = rebalanceMeal({
        mealTarget,
        items: rebalanceInput.map(({ foodId, quantityG }) => ({ foodId, quantityG })),
        mealBounds,
      });

      if (tier1Result.success) {
        const changes = tier1Result.items
          .map((resultItem) => {
            const orig = rebalanceInput.find((r) => r.food.id === resultItem.foodId);
            if (!orig || Math.abs(resultItem.quantityG - orig.quantityG) < 0.5) return null;
            return { action: 'modify', food_name: orig.food.name, grams: Math.round(resultItem.quantityG) };
          })
          .filter(Boolean);

        if (changes.length === 0) {
          return res.json({ status: 'negotiating', message: 'Your meal is already well-balanced — no changes needed!' });
        }

        return res.json({
          status: 'ready',
          message: `Adjusted portions to hit your targets: ${changes.map((c) => `${c.food_name} → ${c.grams}g`).join(', ')}.`,
          changes,
        });
      }

      // Tier 1 failed — record constrained foods and remaining gap for Tier 2 context
      atLimitFoods = rebalanceInput.filter(
        (item) => item.quantityG >= item.food.maxServingG * 0.95 || item.quantityG <= item.food.minServingG * 1.05,
      );
      remainingGap = {
        calories: Math.round(mealTarget.calories - (currentTotals?.calories || 0)),
        proteinG: Math.round(mealTarget.proteinG - (currentTotals?.proteinG || 0)),
        carbG: Math.round(mealTarget.carbG - (currentTotals?.carbG || 0)),
        fatG: Math.round(mealTarget.fatG - (currentTotals?.fatG || 0)),
      };
    }

    // TIER 2: AI call
    const availableFoods = filterFoodsForChatbox({ foods, mealTag, userInput: userPreferences || {} });
    const turnCount = Array.isArray(conversationHistory) ? Math.ceil(conversationHistory.length / 2) : 0;
    const existingCategories = [...new Set(currentItems.flatMap((i) => i.categories || []))];

    const tier1Section = atLimitFoods.length > 0
      ? `TIER 1 FAILURE CONTEXT:
JS balancing already tried modifying existing food grams.
It failed because these foods hit their serving limits:
${atLimitFoods.map((f) => `- ${f.food.name} (${f.food.macroRole}) at max ${f.food.maxServingG}g`).join('\n')}
Remaining gap: Calories ${remainingGap.calories}kcal | P:${remainingGap.proteinG}g | C:${remainingGap.carbG}g | F:${remainingGap.fatG}g

`
      : '';

    const systemContent = `You are a nutrition assistant helping a user modify a single meal to reach its macro targets.

${tier1Section}MEAL TARGET:
- Calories: ${mealTarget.calories} kcal
- Protein: ${mealTarget.proteinG}g
- Carbs: ${mealTarget.carbG}g
- Fat: ${mealTarget.fatG}g

CURRENT MEAL FOODS:
${currentItems.map((i) => `- ${i.name}: ${i.grams}g | ${i.calories}kcal | P:${i.proteinG}g C:${i.carbG}g F:${i.fatG}g`).join('\n')}

CURRENT MEAL TOTALS:
- Calories: ${currentTotals?.calories ?? 0} kcal
- Protein: ${currentTotals?.proteinG ?? 0}g
- Carbs: ${currentTotals?.carbG ?? 0}g
- Fat: ${currentTotals?.fatG ?? 0}g

CURRENT MEAL MACRO ROLES:
${currentItems.map((i) => `- ${i.name}: ${i.macroRole}`).join('\n')}

USER DIET: ${userPreferences?.dietType || 'standard'}

EXISTING MEAL CATEGORIES (do not add any food that shares a category with these):
${existingCategories.join(', ')}

MEAL TYPE: ${mealTag} — only suggest foods whose mealTags includes '${mealTag}'

AVAILABLE FOODS (already filtered for this meal type and user preferences — you MUST only suggest foods from this list):
${availableFoods.map((f) => `- ${f.name} | role:${f.macroRole} | min:${f.minServingG}g max:${f.maxServingG}g | per100g: ${f.caloriesPer100g}kcal P:${f.proteinGPer100g}g C:${f.carbGPer100g}g F:${f.fatGPer100g}g`).join('\n')}

RULES:
1. You may ONLY suggest foods from the AVAILABLE FOODS list above. Never invent food names.
2. All quantities must be within each food's minServingG and maxServingG.
3. Your goal is to help the user reach the MEAL TARGET macros within 5% tolerance on all four values.
4. You may suggest adding a food, removing a food, or modifying grams of existing foods.
5. Keep messages concise and conversational.
6. If the user says something unrelated to nutrition or this meal, politely redirect them.
7. Never suggest removing all foods from a meal.
8. IMPORTANT: If the user gives you a list of specific foods they want, DO NOT ask questions. Immediately calculate the best quantities and respond with status "ready". Only use status "negotiating" if you genuinely need the user to make a choice between options.
9. ${turnCount >= 2 ? 'MANDATORY: This is your 3rd or later response. You MUST respond with status "ready" — stop negotiating and commit to your best solution now.' : 'If this is your 3rd or more response in this conversation, you MUST respond with status "ready" — stop negotiating and commit to your best solution now.'}
10. You MUST always respond in this exact JSON format — no exceptions, no extra text outside the JSON object:

AI DECISION PRIORITY (when a new food is needed):
1. First try: add one food from AVAILABLE FOODS that fills the remaining gap, has a unique macroRole not already in the meal, shares NO categories with existing meal foods, and has mealTag '${mealTag}'
2. If no single food can fill the gap: suggest swapping the most problematic existing food (furthest from its macro role contribution) with a better alternative from AVAILABLE FOODS
3. Last resort: suggest both adding one food AND swapping one existing food
Respond with status "ready" immediately. No questions.

BALANCING LOGIC:
- To fix a calorie/macro gap, FIRST try increasing grams of existing foods before adding anything new
- Only suggest adding a NEW food if ALL existing foods of the relevant macro role are already at their maxServingG limit
- NEVER add a food with the same macroRole as an existing meal food unless the user explicitly requests it
- NEVER add a food that shares any category with an existing meal food
- NEVER ask the user to confirm quantities — calculate them yourself and commit

CURRENT GAP TO TARGET:
- Calories missing: ${Math.round(mealTarget.calories - (currentTotals?.calories ?? 0))} kcal
- Protein missing: ${Math.round(mealTarget.proteinG - (currentTotals?.proteinG ?? 0))}g
- Carbs missing: ${Math.round(mealTarget.carbG - (currentTotals?.carbG ?? 0))}g
- Fat missing: ${Math.round(mealTarget.fatG - (currentTotals?.fatG ?? 0))}g

EXAMPLE — when user says "add gouda and pasta":
WRONG: { "status": "negotiating", "message": "Great choice! How much gouda would you like?" }
RIGHT: { "status": "ready", "message": "Adding gouda 60g and pasta 120g to balance your protein and carbs.", "changes": [{ "action": "add", "food_name": "Gouda", "grams": 60 }, { "action": "add", "food_name": "Pasta", "grams": 120 }] }

When still discussing or presenting options to the user:
{ "status": "negotiating", "message": "your conversational message here" }

When you have a complete final solution ready to apply:
{
  "status": "ready",
  "message": "brief summary of what you are proposing",
  "changes": [
    { "action": "add", "food_name": "exact name from AVAILABLE FOODS", "grams": 120 },
    { "action": "remove", "food_name": "exact name from CURRENT MEAL FOODS" },
    { "action": "modify", "food_name": "exact name from CURRENT MEAL FOODS", "grams": 90 }
  ]
}

Before responding, silently calculate what quantities of the requested foods would hit the meal target within 5% tolerance. Then respond with status "ready" and those quantities. Do the math first, commit second.`;

    const messages = [
      { role: 'system', content: systemContent },
      ...(Array.isArray(conversationHistory) ? conversationHistory : []),
      { role: 'user', content: userMessage },
    ];

    const payload = await chatWithLLM(messages);
    res.json(payload);
  } catch (error) {
    next(error);
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

    // Check macros within ±5% of target
    const TOLERANCE = 0.05;
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
