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

      console.log('TIER1 RESULT:', JSON.stringify(tier1Result));
      console.log('MEAL BOUNDS:', JSON.stringify(computeMealBounds(mealTarget, 0.05)));
      console.log('REBALANCE INPUT:', JSON.stringify(rebalanceInput.map((r) => ({
        name: r.food.name,
        quantityG: r.quantityG,
        maxServingG: r.food.maxServingG,
        minServingG: r.food.minServingG,
      }))));

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

      // TIER 1.5 — smart sequential scaling (handles foods already at max like oil)
      if (tier1Result.violatedMacro === 'calories') {
        const totalMaxCal = rebalanceInput.reduce(
          (sum, item) => sum + (item.food.maxServingG * item.food.caloriesPer100g / 100), 0,
        );

        if (totalMaxCal >= mealTarget.calories) {
          let remaining = mealTarget.calories;
          const result = [];

          // First pass: lock foods already at max, bank their calories
          for (const item of rebalanceInput) {
            const currentCal = item.quantityG * item.food.caloriesPer100g / 100;
            if (item.quantityG >= item.food.maxServingG * 0.99) {
              result.push({ ...item });
              remaining -= currentCal;
            } else {
              result.push({ ...item, _needsScale: true });
            }
          }

          // Second pass: distribute remaining calories among scalable foods
          // proportionally by their max calorie capacity
          const scalableMaxCal = result
            .filter((i) => i._needsScale)
            .reduce((sum, item) => sum + (item.food.maxServingG * item.food.caloriesPer100g / 100), 0);

          for (const item of result) {
            if (!item._needsScale) continue;
            const itemMaxCal = item.food.maxServingG * item.food.caloriesPer100g / 100;
            const share = remaining * (itemMaxCal / scalableMaxCal);
            const newQ = share / (item.food.caloriesPer100g / 100);
            item.quantityG = Math.min(
              item.food.maxServingG,
              Math.max(item.food.minServingG, Math.round(newQ / 5) * 5),
            );
            delete item._needsScale;
          }

          const scaledCal = result.reduce(
            (sum, item) => sum + (item.quantityG * item.food.caloriesPer100g / 100), 0,
          );

          if (Math.abs(scaledCal - mealTarget.calories) / mealTarget.calories <= 0.10) {
            const changes = result
              .map((item, i) => {
                if (Math.abs(item.quantityG - rebalanceInput[i].quantityG) < 5) return null;
                return { action: 'modify', food_name: item.food.name, grams: item.quantityG };
              })
              .filter(Boolean);

            if (changes.length > 0) {
              const snapshotItems = result.map((item) => {
                const factor = item.quantityG / 100;
                return {
                  name: item.food.name,
                  grams: item.quantityG,
                  calories: parseFloat((item.food.caloriesPer100g * factor).toFixed(1)),
                  proteinG: parseFloat((item.food.proteinGPer100g * factor).toFixed(1)),
                  carbG: parseFloat((item.food.carbGPer100g * factor).toFixed(1)),
                  fatG: parseFloat((item.food.fatGPer100g * factor).toFixed(1)),
                };
              });
              const snapshotTotals = snapshotItems.reduce(
                (acc, r) => ({
                  calories: acc.calories + r.calories,
                  proteinG: acc.proteinG + r.proteinG,
                  carbG: acc.carbG + r.carbG,
                  fatG: acc.fatG + r.fatG,
                }),
                { calories: 0, proteinG: 0, carbG: 0, fatG: 0 },
              );
              for (const k of ['calories', 'proteinG', 'carbG', 'fatG']) {
                snapshotTotals[k] = parseFloat(snapshotTotals[k].toFixed(1));
              }

              return res.json({
                status: 'ready',
                message: `Scaled up portions to reach your calorie target: ${changes.map((c) => `${c.food_name} → ${c.grams}g`).join(', ')}.`,
                changes,
                meal_snapshot: snapshotItems,
                meal_snapshot_totals: snapshotTotals,
              });
            }
          }
        }
      }

      // Tier 1 and 1.5 failed — record constrained foods and remaining gap for Tier 2 context
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

    const tier1Section = atLimitFoods.length > 0 || remainingGap
      ? `TIER 1 FAILURE CONTEXT:
JS balancing already tried modifying existing food grams but could not reach the target.
${atLimitFoods.length > 0 ? `These foods hit their serving limits:\n${atLimitFoods.map((f) => `- ${f.food.name} (${f.food.macroRole}) at max ${f.food.maxServingG}g`).join('\n')}` : 'No single food hit its limit, but the combination could not reach the target.'}
Remaining gap: Calories ${remainingGap?.calories ?? 0}kcal | P:${remainingGap?.proteinG ?? 0}g | C:${remainingGap?.carbG ?? 0}g | F:${remainingGap?.fatG ?? 0}g

SWAP CONTEXT:
The user recently swapped foods in this meal. The meal target is ${mealTarget.calories} kcal but the current foods at current portions only reach ${currentTotals?.calories ?? 0} kcal. The gap is large because the new foods have different calorie densities than the originals.
To close this gap you will likely need to significantly increase existing food portions toward their maxServingG limits AND possibly add one complementary food. Do not be surprised by large gram increases.

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

NUTRITION CALCULATION RULES:
You MUST calculate all macros using ONLY the per100g values from AVAILABLE FOODS and CURRENT MEAL FOODS listed above.
NEVER use your own training knowledge of nutrition values — our database is the only source of truth.
Formula: value = (valuePer100g / 100) * grams
Before proposing any change, calculate the full resulting meal totals using these formulas and verify they land within 5% of MEAL TARGET. Only then respond with status ready.

RULES:
1. You may ONLY suggest foods from the AVAILABLE FOODS list above. Never invent food names.
2. All quantities must be within each food's minServingG and maxServingG.
3. Your goal is to help the user reach the MEAL TARGET macros within 5% tolerance on all four values.
4. You may suggest adding a food, removing a food, or modifying grams of existing foods.
5. Keep messages concise and conversational.
6. If the user says something unrelated to nutrition or this meal, politely redirect them.
7. Never suggest removing all foods from a meal.
8. IMPORTANT: If the user gives you a list of specific foods they want, DO NOT ask questions. Immediately calculate the best quantities and respond with status "ready". Only use status "negotiating" if you genuinely need the user to make a choice between options.

TURN LIMIT: You have ${8 - turnCount} responses remaining.
${turnCount >= 2 ? 'MANDATORY: You MUST respond with status "ready" right now. No more negotiating.' : ''}${turnCount === 1 ? 'WARNING: This is your second response. Next one must be status "ready".' : ''}

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

You MUST always respond in this exact JSON format — no exceptions, no extra text outside the JSON object:

When negotiating:
{ "status": "negotiating", "message": "your message here", "meal_snapshot": [{ "name": "food name", "grams": 150, "calories": 247, "proteinG": 35, "carbG": 0, "fatG": 6 }], "meal_snapshot_totals": { "calories": 580, "proteinG": 50, "carbG": 60, "fatG": 15 } }

When ready:
{ "status": "ready", "message": "brief summary", "meal_snapshot": [ { "name": "...", "grams": 0, "calories": 0, "proteinG": 0, "carbG": 0, "fatG": 0 } ], "meal_snapshot_totals": { "calories": 0, "proteinG": 0, "carbG": 0, "fatG": 0 }, "changes": [ { "action": "add", "food_name": "exact name from AVAILABLE FOODS", "grams": 120 }, { "action": "remove", "food_name": "exact name from CURRENT MEAL FOODS" }, { "action": "modify", "food_name": "exact name from CURRENT MEAL FOODS", "grams": 90 } ] }

For negotiating with no changes yet: meal_snapshot shows current meal unchanged.
For ready: meal_snapshot shows the full meal AFTER applying all changes, with calories/proteinG/carbG/fatG calculated from database per100g values.

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
