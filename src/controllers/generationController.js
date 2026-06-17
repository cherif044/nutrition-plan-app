const { getPreferenceOptions } = require('../config/preferenceTaxonomy');
const { generatePlan, getFoods, rebalanceMeal, autoBalanceMeal, computeSensitivityMatrix, checkRebalanceFeasibility, filterFoodsForChatbox } = require('../services/planGenerator');
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
    const availableFoods = filterFoodsForChatbox({ foods, mealTag, userInput: userPreferences || {} });

    const turnCount = Array.isArray(conversationHistory) ? Math.ceil(conversationHistory.length / 2) : 0;

    const systemContent = `You are a nutrition assistant helping a user modify a single meal to reach its macro targets.

MEAL TARGET:
- Calories: ${mealTarget.calories} kcal
- Protein: ${mealTarget.proteinG}g
- Carbs: ${mealTarget.carbG}g
- Fat: ${mealTarget.fatG}g

CURRENT MEAL FOODS:
${currentItems.map((i) => `- ${i.name}: ${i.grams}g | ${i.calories}kcal | P:${i.proteinG}g C:${i.carbG}g F:${i.fatG}g`).join('\n')}

CURRENT MEAL TOTALS:
- Calories: ${currentTotals.calories} kcal
- Protein: ${currentTotals.proteinG}g
- Carbs: ${currentTotals.carbG}g
- Fat: ${currentTotals.fatG}g

USER DIET: ${userPreferences?.dietType || 'standard'}

AVAILABLE FOODS (already filtered for this meal type and user preferences — you MUST only suggest foods from this list):
${availableFoods.map((f) => `- ${f.name} | role:${f.macroRole} | min:${f.minServingG}g max:${f.maxServingG}g | per100g: ${f.caloriesPer100g}kcal P:${f.proteinGPer100g}g C:${f.carbGPer100g}g F:${f.fatGPer100g}g`).join('\n')}

RULES:
1. You may ONLY suggest foods from the AVAILABLE FOODS list above. Never invent food names.
2. All quantities must be within each food's minServingG and maxServingG.
3. Your goal is to help the user reach the MEAL TARGET macros within 5% tolerance on all four values.
4. You may suggest adding a food, removing a food, swapping a food, or modifying grams of existing foods.
5. If a change creates a trade-off (e.g. adding food X pushes calories over), explain the trade-off and ask the user to choose between options.
6. Keep messages concise and conversational.
7. If the user says something unrelated to nutrition or this meal, politely redirect them.
8. Never suggest removing all foods from a meal.
9. IMPORTANT: If the user gives you a list of specific foods they want, DO NOT ask questions. Immediately calculate the best quantities and respond with status "ready". Only use status "negotiating" if you genuinely need the user to make a choice between options.
10. ${turnCount >= 2 ? 'MANDATORY: This is your 3rd or later response. You MUST respond with status "ready" — stop negotiating and commit to your best solution now.' : 'If this is your 3rd or more response in this conversation, you MUST respond with status "ready" — stop negotiating and commit to your best solution now.'}
11. You MUST always respond in this exact JSON format — no exceptions, no extra text outside the JSON object:

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

Before responding, silently calculate what quantities of the requested foods would hit the meal target within 5% tolerance. Then respond with status "ready" and those quantities. Do the math first, commit second.
CURRENT MEAL MACRO ROLES:
{list each food with its macroRole}
- Chicken breast: protein
- Whole-wheat pasta: carb  
- Sunflower oil: fat

BALANCING LOGIC:
- The meal is SHORT on calories ({gap} kcal missing)
- To fix a calorie gap, FIRST try increasing grams of existing foods
- Only suggest adding a NEW food if increasing existing food grams 
  hits their maxServingG limit AND the gap still isn't closed
- NEVER add a food with the same macroRole as an existing food 
  unless the user explicitly asks for it
- Protein gap → increase the existing protein food's grams first
- Carb gap → increase the existing carb food's grams first  
- Fat gap → increase the existing fat food's grams first
CURRENT GAP TO TARGET:
- Calories missing: {target.calories - current.calories} kcal
- Protein missing: {target.proteinG - current.proteinG}g
- Carbs missing: {target.carbG - current.carbG}g
- Fat missing: {target.fatG - current.fatG}g`;

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
    const { mealTarget, currentItems, changes } = req.body;
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
