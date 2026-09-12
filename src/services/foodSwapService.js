/**
 * Per-request "swap suggestions" lookup.
 *
 * This file does exactly one thing: given a food id, look up the
 * precomputed candidate list built by scripts/buildFoodSwaps.js, apply the
 * user's live dietType/allergen/dislike filters, optionally check that each
 * candidate can actually be substituted into the meal it's being swapped
 * into, and return every valid option unless a caller explicitly limits it.
 *
 * It never computes distances or scores itself — that only happens in the
 * precompute script. Keeping the two apart means a slow request never
 * triggers a full-catalog recompute, and the precompute logic has exactly
 * one place to live.
 */

const { loadFoods, loadFoodSwaps } = require('../repositories/foodRepository');
const { filterFoods, clampServing, rebalanceMeal } = require('./planGenerator');

const DEFAULT_LIMIT = Number.POSITIVE_INFINITY;
// A candidate whose tier-adjusted score is >= 1 would produce a match_pct
// <= 0 — not a looser match, a non-match. Tier-4 condiment fallbacks can
// hit this (e.g. mustard as a "swap" for BBQ sauce). Drop them rather than
// show a 0% or negative "suggestion".
const MAX_SCORE = 1;
function scoreToMatchPct(score) {
  return Math.round(100 - score * 100);
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

/**
 * @param {object} params
 * @param {string} params.foodId - the food being swapped out
 * @param {object} [params.userPreferences] - { dietType, avoidFoods, dislikes },
 *   the same shape produced by the frontend's getUserPreferences()
 * @param {number|string} [params.limit] - max results, or "all" for every result
 * @param {object} [params.mealContext] - { itemIndex, currentItems, mealTarget,
 *   dailyContext }, the same shapes /api/rebalance-meal takes. When present,
 *   candidates are additionally required to actually fit the meal at some
 *   valid serving size. Omit it to get pure nutritional-similarity ranking
 *   (e.g. for a food browser with no meal in context).
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

  const swaps = loadFoodSwaps();
  const candidates = swaps[id] || [];
  if (candidates.length === 0) {
    return { foodId: id, options: [] };
  }

  const safeLimit = normalizeLimit(limit);

  // Resolve candidate ids to full food objects, preserving the precomputed
  // tier-then-score order. Drop non-matches up front (score >= MAX_SCORE)
  // and anything the catalog no longer has (stale precompute).
  const candidateFoods = [];
  const candidateById = new Map();
  for (const candidate of candidates) {
    if (candidate.score >= MAX_SCORE) continue;
    const food = foodById.get(candidate.candidateId);
    if (!food) continue;
    candidateFoods.push(food);
    candidateById.set(food.id, candidate);
  }

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
    const candidate = candidateById.get(food.id);
    return {
      foodId: food.id,
      name: food.name,
      matchPct: scoreToMatchPct(candidate.score),
      tier: candidate.tier,
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
