const fs = require('fs');
const path = require('path');

const BUNDLE_COMPONENT_KEYS = ['protein', 'carb', 'fat', 'extra', 'sauce'];
const SKIP_INGREDIENTS = new Set(['(included in bar)', '(included in peanuts)', '—']);
const INGREDIENT_ALIASES = new Map([
  ['Egg whites, cooked (omelette/scrambled)', 'Egg, white, raw, fresh'],
  ['Whey protein isolate, unflavored (mixed with milk)', 'Whey protein isolate, unflavored'],
  ['Whey protein concentrate, unflavored (mixed with milk)', 'Whey protein concentrate, unflavored'],
]);

let cache;

function loadReadyMealBundles() {
  if (cache) return cache;

  const filePath = path.join(__dirname, '..', '..', 'ready_meals', 'meals.json');
  const decoded = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const bundles = decoded.meal_bundles ?? {};

  cache = Object.entries(bundles).flatMap(([mealTag, meals]) => (
    (meals || []).map((meal) => ({
      id: String(meal.id),
      mealTag,
      track: String(meal.track || ''),
      components: BUNDLE_COMPONENT_KEYS
        .map((key) => {
          const name = meal[key];
          if (!name || SKIP_INGREDIENTS.has(name)) return null;
          return {
            slot: key,
            ingredientName: String(name),
            lookupName: INGREDIENT_ALIASES.get(String(name)) || String(name),
          };
        })
        .filter(Boolean),
    }))
  ));

  validateReadyMeals(cache);
  return cache;
}

function validateReadyMeals(meals) {
  if (!Array.isArray(meals) || meals.length === 0) {
    throw new Error('Ready meal data must include meal bundles.');
  }

  const seen = new Set();
  for (const meal of meals) {
    if (seen.has(meal.id)) throw new Error(`Duplicate ready meal id: ${meal.id}`);
    seen.add(meal.id);
    if (!meal.mealTag) throw new Error(`Ready meal ${meal.id} is missing mealTag.`);
    if (!meal.components.length) throw new Error(`Ready meal ${meal.id} has no usable ingredients.`);
  }
}

module.exports = { loadReadyMealBundles };
