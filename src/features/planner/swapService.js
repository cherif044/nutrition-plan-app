/**
 * Per-request swap suggestions.
 *
 * Candidates are generated from the live food catalog for the meal being
 * edited. A food is eligible only when it has the same macro role as the
 * food being replaced and is tagged for that meal. Live dietary filters and
 * the normal rebalance check are then applied before it is returned.
 */

const { loadFoods } = require('./foodRepository');
const { filterFoods, clampServing, rebalanceMeal } = require('./generator');
const { INPUT_LIMITS } = require('../../config/inputLimits');
const { inputError } = require('../../utils/httpErrors');

const DEFAULT_LIMIT = Number.POSITIVE_INFINITY;

const MEAL_TAG_ALIASES = {
  main: ['lunch', 'dinner'],
  main_meal: ['lunch', 'dinner'],
};

function normalizeCursor(cursor) {
  const parsed = Number(cursor);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

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
// Returns true, false, or 'limited' when the search ran out of time before it
// could decide, so the caller can stop and retry that candidate later.
function fitsMeal(candidateFood, mealContext, deadlineAt) {
  const { itemIndex, currentItems, mealTarget, dailyContext } = mealContext;
  const currentItem = currentItems[itemIndex];
  if (!currentItem) return false;

  const attemptedItems = currentItems.map((rawItem, index) => (
    index === itemIndex
      ? { foodId: candidateFood.id, quantityG: clampServing(candidateFood, Number(rawItem.quantityG) || candidateFood.defaultServingG) }
      : rawItem
  ));

  try {
    const result = rebalanceMeal({
      mealTarget,
      items: attemptedItems,
      dailyContext,
      action: 'swap_food',
      changedItemIndex: itemIndex,
      deadlineAt,
    });
    if (result.searchLimited) return 'limited';
    return result.success === true;
  } catch {
    // An unresolvable item elsewhere in the meal, or a malformed
    // mealContext, shouldn't take down suggestion loading — treat as "we
    // couldn't confirm this fits" rather than erroring the whole request.
    return false;
  }
}

function mealTagsForSuggestions(mealContext) {
  const currentMealTag = String(mealContext.mealTag).trim().toLowerCase();
  return MEAL_TAG_ALIASES[currentMealTag] || [currentMealTag];
}

/**
 * @param {object} params
 * @param {string} params.foodId - the food being swapped out
 * @param {object} [params.userPreferences] - { avoidFoods },
 *   the same shape produced by the frontend's getUserPreferences()
 * @param {number|string} [params.limit] - max results, or "all" for every result
 * @param {number} [params.cursor] - resume position from a previous response's
 *   nextCursor, for "show more" batches
 * @param {object} params.mealContext - { mealTag, itemIndex, currentItems,
 *   mealTarget, dailyContext }, where mealTag is the current meal's tag.
 */
function getSwapSuggestions({
  foodId, userPreferences = {}, limit = DEFAULT_LIMIT, mealContext, cursor = 0,
  deadlineAt = performance.now() + INPUT_LIMITS.swapSearchMs,
}) {
  const id = String(foodId ?? '');
  if (!id) {
    throw inputError('foodId is required.');
  }
  if (!mealContext) {
    throw inputError('mealContext is required.');
  }

  const foods = loadFoods();
  const foodById = new Map(foods.map((food) => [food.id, food]));
  const sourceFood = foodById.get(id);
  if (!sourceFood) {
    return { foodId: id, options: [], nextCursor: null, hasMore: false };
  }

  const safeLimit = normalizeLimit(limit);
  const start = normalizeCursor(cursor);
  const allowedMealTags = new Set(mealTagsForSuggestions(mealContext));
  const candidateFoods = foods.filter((food) => (
    food.id !== sourceFood.id
    && food.macroRole === sourceFood.macroRole
    && food.mealTags.some((mealTag) => allowedMealTags.has(mealTag))
  ));

  const safeInput = {
    avoidFoods: Array.isArray(userPreferences?.avoidFoods) ? userPreferences.avoidFoods : [],
  };

  let allowedCandidateFoods;
  try {
    allowedCandidateFoods = filterFoods(candidateFoods, safeInput);
  } catch {
    // Mirrors the generator fallback: an unrecognized preference
    // term shouldn't break the swap panel, just fall back to an id-based
    // avoid list.
    const avoided = new Set(safeInput.avoidFoods.map(String));
    allowedCandidateFoods = candidateFoods.filter((food) => !avoided.has(food.id));
  }

  const toOption = (food) => {
    return {
      foodId: food.id,
      name: food.name,
    };
  };

  // Meal-fit filtering runs the full rebalance check per candidate, so it
  // stops as soon as one batch is filled. Finding one extra fitting
  // candidate tells the UI whether "show more" has anything to show; the
  // cursor points at that candidate so the next batch starts with it.
  const options = [];
  let nextCursor = null;
  for (let index = start; index < allowedCandidateFoods.length; index += 1) {
    // Out of time for this request: end the batch here and let "show more"
    // resume from this candidate, rather than dropping it as unusable.
    if (performance.now() > deadlineAt && options.length > 0) {
      nextCursor = index;
      break;
    }
    const food = allowedCandidateFoods[index];
    const fits = fitsMeal(food, mealContext, deadlineAt);
    if (fits === 'limited') {
      if (options.length > 0) {
        nextCursor = index;
        break;
      }
      continue;
    }
    if (!fits) continue;
    if (options.length >= safeLimit) {
      nextCursor = index;
      break;
    }
    options.push(toOption(food));
  }

  return { foodId: id, options, nextCursor, hasMore: nextCursor !== null };
}

module.exports = { getSwapSuggestions };
