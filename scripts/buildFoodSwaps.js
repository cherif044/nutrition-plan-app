#!/usr/bin/env node
/**
 * Precomputes the "swap suggestions" candidate list for every food in the
 * catalog and writes it to used_food_repository/food_swaps.json.
 *
 * This is a BUILD-TIME step. Run it once, and re-run it whenever
 * used_food_repository/foods.json changes (new foods, edited macros,
 * edited macro_role/sub_category). Nothing in the request path should ever
 * recompute this — src/services/foodSwapService.js only reads the output
 * file at request time and applies the user's live allergen/diet filters.
 *
 * Usage:
 *   node scripts/buildFoodSwaps.js
 *   npm run build:food-swaps
 *
 * ─── Grouping (tiers) ────────────────────────────────────────────────────
 * For a source food A, every other food B in the catalog is classified into
 * exactly one tier (or excluded entirely). Tiers are exhausted in order —
 * tier 1 candidates always precede tier 2, which always precede tier 3, etc.
 * A fixed score penalty is added per tier so a looser-tier match can never
 * outrank a tighter-tier one, and so match_pct honestly reflects how loose
 * the swap is:
 *
 *   Tier 1 (penalty 0.00): same macro_role AND same sub_category
 *                          (both sub_category values non-null and equal)
 *   Tier 2 (penalty 0.15): same macro_role, A has a real sub_category but
 *                          B's is null (widen to same-role "uncategorized"
 *                          items as filler, one direction only — see note)
 *   Tier 3 (penalty 0.30): same macro_role, both have a real (non-null)
 *                          sub_category, but they differ
 *   Tier 4 (penalty 0.45): A.macro_role === 'mixed' only (the condiments
 *                          bucket) — widen by categories[] overlap instead
 *                          of macro_role/sub_category, since condiments
 *                          have no sub_category to anchor on
 *
 * Note on tier 2 direction: only a source with a real sub_category pulls in
 * same-role uncategorized candidates as filler. The reverse — a source
 * whose OWN sub_category is null matching every food in its macro_role —
 * is deliberately NOT done. Verified against this catalog: doing it the
 * naive symmetric way pairs protein_bar_average with beef liver and
 * chocolate_dark_70_85_cacao with olive oil (same macro_role, nutritionally
 * plausible, categorically absurd). A food whose own sub_category is null
 * and isn't in the 'mixed' role (tier 4) gets NO suggestions — see the
 * zero-candidate log below. That's the correct outcome for those foods:
 * nothing in the catalog is a real swap for them today.
 *
 * ─── Score ───────────────────────────────────────────────────────────────
 * Base distance is Euclidean over normalized [calories_per_100g,
 * protein_%_of_cal, carb_%_of_cal, fat_%_of_cal]. Calories are min-max
 * normalized against the full catalog; the macro percentages are already
 * on a 0-1 scale. effective_score = base_distance + tier_penalty.
 * match_pct is NOT stored here — src/services/foodSwapService.js derives
 * it from `score` at request time (match_pct = round(100 - score*100)),
 * so recalibrating the multiplier never requires a rebuild.
 *
 * The full sorted candidate list is stored per food (not just top 10) so
 * the per-request allergen/diet filter still has 10 candidates worth of
 * headroom to fall back on after filtering some out.
 */

const fs = require('fs');
const path = require('path');
const { loadFoods } = require('../src/repositories/foodRepository');

const OUTPUT_PATH = path.join(__dirname, '..', 'used_food_repository', 'food_swaps.json');

const TIER_PENALTY = {
  1: 0,
  2: 0.15,
  3: 0.30,
  4: 0.45,
};

function macroComposition(food) {
  const proteinCal = food.proteinGPer100g * 4;
  const carbCal = food.carbGPer100g * 4;
  const fatCal = food.fatGPer100g * 9;
  const totalCal = proteinCal + carbCal + fatCal;
  return {
    proteinPct: totalCal > 0 ? proteinCal / totalCal : 0,
    carbPct: totalCal > 0 ? carbCal / totalCal : 0,
    fatPct: totalCal > 0 ? fatCal / totalCal : 0,
  };
}

function buildVectors(foods) {
  const compositions = foods.map(macroComposition);
  const calorieValues = foods.map((food) => food.caloriesPer100g);
  const minCalories = Math.min(...calorieValues);
  const maxCalories = Math.max(...calorieValues);
  const calorieRange = maxCalories - minCalories || 1;

  return foods.map((food, index) => {
    const composition = compositions[index];
    return [
      (food.caloriesPer100g - minCalories) / calorieRange,
      composition.proteinPct,
      composition.carbPct,
      composition.fatPct,
    ];
  });
}

function euclideanDistance(a, b) {
  let sumOfSquares = 0;
  for (let i = 0; i < a.length; i += 1) {
    const diff = a[i] - b[i];
    sumOfSquares += diff * diff;
  }
  return Math.sqrt(sumOfSquares);
}

function classifyTier(source, candidate) {
  const sourceSub = source.subCategory ?? null;
  const candidateSub = candidate.subCategory ?? null;

  if (source.macroRole === candidate.macroRole) {
    if (sourceSub !== null && candidateSub !== null && sourceSub === candidateSub) {
      return 1;
    }
    if (sourceSub !== null && candidateSub === null) {
      return 2;
    }
    if (sourceSub !== null && candidateSub !== null && sourceSub !== candidateSub) {
      return 3;
    }
    // sourceSub === null and candidateSub is anything: no tier 1-3 match.
    // (See "Note on tier 2 direction" above for why this is intentional.)
  }

  if (source.macroRole === 'mixed') {
    const sourceCategories = new Set(source.categories || []);
    const sharesCategory = (candidate.categories || []).some((tag) => sourceCategories.has(tag));
    if (sharesCategory) {
      return 4;
    }
  }

  return null;
}

function buildSwapsForFood(source, foods, vectors, sourceIndex) {
  const byTier = { 1: [], 2: [], 3: [], 4: [] };

  foods.forEach((candidate, candidateIndex) => {
    if (candidateIndex === sourceIndex) return;
    const tier = classifyTier(source, candidate);
    if (tier === null) return;

    const baseDistance = euclideanDistance(vectors[sourceIndex], vectors[candidateIndex]);
    const score = baseDistance + TIER_PENALTY[tier];
    byTier[tier].push({ candidateId: candidate.id, tier, score: Number(score.toFixed(6)) });
  });

  for (const tier of Object.keys(byTier)) {
    byTier[tier].sort((a, b) => a.score - b.score);
  }

  // Concatenate tiers in order — this is what "exhaust tier N before N+1,
  // never interleave" means in practice: tier blocks are never merged or
  // re-sorted against each other, only sorted internally.
  return [...byTier[1], ...byTier[2], ...byTier[3], ...byTier[4]];
}

function build() {
  const foods = loadFoods();
  const vectors = buildVectors(foods);

  const swaps = {};
  const zeroCandidateFoods = [];

  foods.forEach((source, index) => {
    const candidates = buildSwapsForFood(source, foods, vectors, index);
    swaps[source.id] = candidates;
    if (candidates.length === 0) {
      zeroCandidateFoods.push(source.id);
    }
  });

  const output = {
    generatedAt: new Date().toISOString(),
    foodCount: foods.length,
    swaps,
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);

  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(`  foods: ${foods.length}`);
  console.log(`  foods with zero swap candidates (all 4 tiers exhausted): ${zeroCandidateFoods.length}`);
  if (zeroCandidateFoods.length > 0) {
    console.log(`    ${zeroCandidateFoods.join(', ')}`);
    console.log('    These will show "no suggested swaps" in the UI; manual search still works.');
    console.log('    Re-check this list after adding foods — a new catalog entry may fill the gap.');
  }
}

build();
