const fs = require('fs');
const path = require('path');

let cache;

function loadFoods() {
  if (cache) return cache;

  const filePath = path.join(__dirname, '..', '..', 'data', 'foods.json');
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
    'min_serving_g', 'max_serving_g',
  ];

  for (const field of requiredFields) {
    if (food[field] === undefined || food[field] === null) {
      throw new Error(`Food item is missing required field: ${field}`);
    }
  }

  return {
    id: String(food.id),
    name: String(food.name),
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
  };
}

module.exports = { loadFoods };
