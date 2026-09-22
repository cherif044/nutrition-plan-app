/**
 * Per-request swap suggestions.
 *
 * Candidates are generated from the live food catalog for the meal being
 * edited. A food is eligible only when it has the same macro role as the
 * food being replaced and is tagged for that meal. Live dietary filters and
 * the normal rebalance check are then applied before it is returned.
 */

const { loadFoods } = require('../repositories/foodRepository');
const { filterFoods, clampServing, rebalanceMeal } = require('./planGenerator');

const DEFAULT_LIMIT = Number.POSITIVE_INFINITY;

const MEAL_TAG_ALIASES = {
  iftar: ['dinner', 'lunch'],
  suhoor: ['breakfast', 'dinner'],
  main: ['lunch', 'dinner'],
  main_meal: ['lunch', 'dinner'],
};

function normalizeLimit(limit) {
  if (limit === undefined || limit === null || limit === 'all') return DEFAULT_LIMIT;
  if (limit === Number.POSITIVE_INFINITY) return DEFAULT_LIMIT;
  const parsed = Number(limit);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_LIMIT;
}

/**
 * A candidate can be a great nutritional match and still be unusable: at
 * every valid serving size it might push the meal outside its calorie/macro
 * bounds. This runs the exact same check a real swap attempt would —
 * rebalanceMeal, unmodified — so "shown in the list" always means "will
 * succeed if clicked." No fit logic is duplicated here.
 */
function fitsMeal(candidateFood, mealContext) {
  const { itemIndex, currentItems, mealTarget, dailyContext } = mealContext;
  const currentItem = currentItems[itemIndex];
  if (!currentItem) return false;

  const attemptedItems = currentItems.map((rawItem, index) => (
    index === itemIndex
      ? { foodId: candidateFood.id, quantityG: clampServing(candidateFood, Number(rawItem.quantityG) || candidateFood.defaultServingG) }
      : rawItem
  ));

  try {
    return rebalanceMeal({
      mealTarget,
      items: attemptedItems,
      dailyContext,
      action: 'swap_food',
      changedItemIndex: itemIndex,
    }).success === true;
  } catch {
    // An unresolvable item elsewhere in the meal, or a malformed
    // mealContext, shouldn't take down suggestion loading — treat as "we
    // couldn't confirm this fits" rather than erroring the whole request.
    return false;
  }
}

function isUsableMealContext(mealContext) {
  return Boolean(
    mealContext &&
    Number.isInteger(mealContext.itemIndex) &&
    Array.isArray(mealContext.currentItems) &&
    mealContext.mealTarget,
  );
}

function mealTagsForSuggestions(mealContext, sourceFood) {
  const currentMealTag = String(mealContext?.mealTag ?? '').trim().toLowerCase();
  if (currentMealTag) {
    return MEAL_TAG_ALIASES[currentMealTag] || [currentMealTag];
  }

  // The planner always supplies mealTag. Retaining this fallback keeps the
  // service usable for non-planner callers while still limiting suggestions
  // to a meal in which the source itself is allowed.
  return Array.isArray(sourceFood.mealTags) ? sourceFood.mealTags : [];
}

/**
 * @param {object} params
 * @param {string} params.foodId - the food being swapped out
 * @param {object} [params.userPreferences] - { dietType, avoidFoods, dislikes },
 *   the same shape produced by the frontend's getUserPreferences()
 * @param {number|string} [params.limit] - max results, or "all" for every result
 * @param {object} [params.mealContext] - { mealTag, itemIndex, currentItems,
 *   mealTarget, dailyContext }, where mealTag is the current meal's tag.
 */
function getSwapSuggestions({ foodId, userPreferences = {}, limit = DEFAULT_LIMIT, mealContext = null }) {
  const id = String(foodId ?? '');
  if (!id) {
    throw new Error('foodId is required.');
  }

  const foods = loadFoods();
  const foodById = new Map(foods.map((food) => [food.id, food]));
  const sourceFood = foodById.get(id);
  if (!sourceFood) {
    return { foodId: id, options: [] };
  }

  const safeLimit = normalizeLimit(limit);
  const allowedMealTags = new Set(mealTagsForSuggestions(mealContext, sourceFood));
  const candidateFoods = foods.filter((food) => (
    food.id !== sourceFood.id
    && food.macroRole === sourceFood.macroRole
    && food.mealTags.some((mealTag) => allowedMealTags.has(mealTag))
  ));

  // Same filtering plan generation and the existing produce-swap endpoint
  // use: dietType (vegan/vegetarian) + avoidFoods/dislikes resolved through
  // the shared preference taxonomy. `allergies` is left empty because the
  // frontend's live preference state (preferenceState.avoidFoods) merges
  // allergy and dislike terms into one list — see getUserPreferences() in
  // public/js/app.js.
  const safeInput = {
    dietType: userPreferences?.dietType || 'standard',
    avoidFoods: Array.isArray(userPreferences?.avoidFoods) ? userPreferences.avoidFoods : [],
    allergies: [],
    dislikes: Array.isArray(userPreferences?.dislikes) ? userPreferences.dislikes : [],
  };

  let allowedCandidateFoods;
  try {
    allowedCandidateFoods = filterFoods(candidateFoods, safeInput);
  } catch {
    // Mirrors getProduceSwapOptions's fallback: an unrecognized preference
    // term shouldn't break the swap panel, just fall back to an id-based
    // avoid list.
    const avoided = new Set(safeInput.avoidFoods.map(String));
    allowedCandidateFoods = candidateFoods.filter((food) => !avoided.has(food.id));
  }

  const toOption = (food) => {
    return {
      foodId: food.id,
      name: food.name,
      // These legacy fields are not rendered by the frontend, but retaining
      // them preserves the existing API response shape for other callers.
      matchPct: 100,
      tier: 1,
    };
  };

  if (!isUsableMealContext(mealContext)) {
    return { foodId: id, options: allowedCandidateFoods.slice(0, safeLimit).map(toOption) };
  }

  // Meal-fit filtering. The precomputed list is stored in full (not sliced
  // to 10) so the UI can show every candidate that actually works in this
  // meal, while still preserving the precomputed tier-then-score order.
  const options = [];
  for (const food of allowedCandidateFoods) {
    if (options.length >= safeLimit) break;
    if (fitsMeal(food, mealContext)) {
      options.push(toOption(food));
    }
  }

  return { foodId: id, options };
}

module.exports = { getSwapSuggestions };
