const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

let cache;
let swapCache;
const FOOD_ICON_DIR = path.join(__dirname, '..', '..', 'public', 'food-icons');
const FOOD_SWAPS_PATH = path.join(__dirname, '..', '..', 'used_food_repository', 'food_swaps.json');

function foodIconUrlForId(id) {
  const fileName = `${id}.png`;
  return fs.existsSync(path.join(FOOD_ICON_DIR, fileName))
    ? `/food-icons/${encodeURIComponent(fileName)}`
    : null;
}

function loadFoods() {
  if (cache) return cache;

  const filePath = path.join(__dirname, '..', '..', 'used_food_repository', 'foods.json');
  const decoded = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  if (!Array.isArray(decoded)) {
    throw new Error('Food data must be a JSON array.');
  }

  cache = decoded.map(normalizeFood);
  if (cache.length === 0) {
    throw new Error('Food data is empty.');
  }

  return cache;
}

function normalizeFood(food) {
  const requiredFields = [
    'id', 'name', 'macro_role', 'calories_per_100g', 'protein_g_per_100g',
    'carb_g_per_100g', 'fat_g_per_100g', 'is_vegan', 'is_vegetarian',
    'allergens', 'categories', 'meal_tags', 'default_serving_g',
    'min_serving_g', 'max_serving_g', 'cuisine_tag',
  ];

  for (const field of requiredFields) {
    if (food[field] === undefined || food[field] === null) {
      throw new Error(`Food item is missing required field: ${field}`);
    }
  }

  const id = String(food.id);

  return {
    id,
    name: String(food.name),
    iconUrl: foodIconUrlForId(id),
    nameAr: food.name_ar ? String(food.name_ar) : '',
    macroRole: String(food.macro_role),
    caloriesPer100g: Number(food.calories_per_100g),
    proteinGPer100g: Number(food.protein_g_per_100g),
    carbGPer100g: Number(food.carb_g_per_100g),
    fatGPer100g: Number(food.fat_g_per_100g),
    fiberGPer100g: Number(food.fiber_g_per_100g ?? 0),
    sodiumMgPer100g: Number(food.sodium_mg_per_100g ?? 0),
    isVegan: Boolean(food.is_vegan),
    isVegetarian: Boolean(food.is_vegetarian),
    allergens: food.allergens.map(String),
    categories: food.categories.map(String),
    mealTags: food.meal_tags.map(String),
    defaultServingG: Number(food.default_serving_g),
    minServingG: Number(food.min_serving_g),
    maxServingG: Number(food.max_serving_g),
    fdcId: food.fdc_id ? Number(food.fdc_id) : null,
    // sub_category vocab by macro_role:
    //   carb    → starch | bread | non_starchy_veg | fruit | legume
    //   protein → animal_protein | egg | dairy_protein | legume
    //   fat     → oil_fat | nuts_seeds | dairy_fat
    //   mixed   → null
    subCategory: food.sub_category ?? null,
    cuisineTag: String(food.cuisine_tag),
    dietTags: Array.isArray(food.diet_tags) ? food.diet_tags.map(String) : [],
  };
}

// Precomputed swap candidates, built by scripts/buildFoodSwaps.js. This is
// read-only at request time — nothing here recomputes the index. Run
// `npm run build:food-swaps` whenever used_food_repository/foods.json
// changes (new food, edited macros, edited macro_role/sub_category).
function loadFoodSwaps() {
  if (swapCache) return swapCache;

  const decoded = JSON.parse(fs.readFileSync(FOOD_SWAPS_PATH, 'utf8'));
  if (!decoded || typeof decoded.swaps !== 'object') {
    throw new Error('food_swaps.json is malformed: expected a { swaps: { ... } } object.');
  }

  const foods = loadFoods();
  const missing = foods.filter((food) => !(food.id in decoded.swaps));
  if (missing.length > 0) {
    logger.warn('food_swaps.json is stale: missing entries for foods in the catalog. Run `npm run build:food-swaps`.', {
      missingFoodIds: missing.map((food) => food.id),
    });
  }

  swapCache = decoded.swaps;
  return swapCache;
}

module.exports = { loadFoods, loadFoodSwaps };
