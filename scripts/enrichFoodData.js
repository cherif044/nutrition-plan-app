const fs = require('fs');
const path = require('path');

const foodPath = path.join(__dirname, '..', 'data', 'foods.json');

const metadata = {
  chicken_breast: {
    allergens: [],
    categories: ['animal_protein', 'meat', 'poultry', 'chicken', 'lean_protein'],
  },
  chicken_thigh: {
    allergens: [],
    categories: ['animal_protein', 'meat', 'poultry', 'chicken'],
  },
  turkey_breast: {
    allergens: [],
    categories: ['animal_protein', 'meat', 'poultry', 'turkey', 'lean_protein'],
  },
  chicken_kofta: {
    allergens: [],
    categories: ['animal_protein', 'meat', 'poultry', 'chicken', 'kofta'],
  },
  beef_lean: {
    allergens: [],
    categories: ['animal_protein', 'meat', 'red_meat', 'beef', 'lean_protein'],
  },
  kofta_beef: {
    allergens: [],
    categories: ['animal_protein', 'meat', 'red_meat', 'beef', 'kofta'],
  },
  lamb_lean: {
    allergens: [],
    categories: ['animal_protein', 'meat', 'red_meat', 'lamb'],
  },
  liver_beef: {
    allergens: [],
    categories: ['animal_protein', 'meat', 'red_meat', 'beef', 'organ_meat', 'liver'],
  },
  liver_chicken: {
    allergens: [],
    categories: ['animal_protein', 'meat', 'poultry', 'chicken', 'organ_meat', 'liver'],
  },
  tilapia: {
    allergens: ['fish'],
    categories: ['animal_protein', 'seafood', 'fish', 'white_fish', 'tilapia', 'lean_protein'],
  },
  white_fish: {
    allergens: ['fish'],
    categories: ['animal_protein', 'seafood', 'fish', 'white_fish', 'lean_protein'],
  },
  tuna_canned: {
    allergens: ['fish'],
    categories: ['animal_protein', 'seafood', 'fish', 'tuna', 'canned_fish', 'lean_protein'],
  },
  shrimp: {
    allergens: ['shellfish', 'crustacean'],
    categories: ['animal_protein', 'seafood', 'shellfish', 'crustacean', 'shrimp', 'lean_protein'],
  },
  sardines: {
    allergens: ['fish'],
    categories: ['animal_protein', 'seafood', 'fish', 'sardines', 'canned_fish'],
  },
  whole_eggs: {
    allergens: ['egg'],
    categories: ['animal_protein', 'eggs', 'egg', 'breakfast_protein'],
  },
  egg_whites: {
    allergens: ['egg'],
    categories: ['animal_protein', 'eggs', 'egg', 'egg_whites', 'lean_protein', 'breakfast_protein'],
  },
  cottage_cheese: {
    allergens: ['milk', 'dairy', 'lactose'],
    categories: ['animal_protein', 'dairy', 'milk', 'cheese', 'cottage_cheese'],
  },
  greek_yogurt: {
    allergens: ['milk', 'dairy', 'lactose'],
    categories: ['animal_protein', 'dairy', 'milk', 'yogurt', 'greek_yogurt'],
  },
  labneh: {
    allergens: ['milk', 'dairy', 'lactose'],
    categories: ['animal_protein', 'dairy', 'milk', 'yogurt', 'labneh'],
  },
  ful_medames: {
    allergens: [],
    categories: ['plant_protein', 'legumes', 'beans', 'fava_beans', 'vegan'],
  },
  lentils_red: {
    allergens: [],
    categories: ['plant_protein', 'legumes', 'lentils', 'red_lentils', 'vegan'],
  },
  lentils_brown: {
    allergens: [],
    categories: ['plant_protein', 'legumes', 'lentils', 'brown_lentils', 'vegan'],
  },
  chickpeas: {
    allergens: [],
    categories: ['plant_protein', 'legumes', 'chickpeas', 'vegan'],
  },
  tofu: {
    allergens: ['soy'],
    categories: ['plant_protein', 'soy', 'tofu', 'vegan'],
  },
  whey_protein: {
    allergens: ['milk', 'dairy', 'lactose'],
    categories: ['animal_protein', 'dairy', 'milk', 'whey', 'protein_powder'],
  },
  white_rice: {
    allergens: [],
    categories: ['carb', 'grain', 'rice', 'white_rice', 'gluten_free'],
  },
  brown_rice: {
    allergens: [],
    categories: ['carb', 'grain', 'rice', 'brown_rice', 'whole_grain', 'gluten_free'],
  },
  oats: {
    allergens: ['gluten'],
    categories: ['carb', 'grain', 'oats', 'breakfast_cereal', 'whole_grain'],
  },
  fino_bread: {
    allergens: ['gluten', 'wheat'],
    categories: ['carb', 'grain', 'wheat', 'gluten', 'bread', 'white_bread'],
  },
  baladi_bread: {
    allergens: ['gluten', 'wheat'],
    categories: ['carb', 'grain', 'wheat', 'gluten', 'bread', 'whole_wheat', 'whole_grain'],
  },
  pasta_cooked: {
    allergens: ['gluten', 'wheat'],
    categories: ['carb', 'grain', 'wheat', 'gluten', 'pasta'],
  },
  whole_wheat_pasta: {
    allergens: ['gluten', 'wheat'],
    categories: ['carb', 'grain', 'wheat', 'gluten', 'pasta', 'whole_wheat', 'whole_grain'],
  },
  quinoa: {
    allergens: [],
    categories: ['carb', 'grain', 'quinoa', 'gluten_free', 'vegan'],
  },
  freekeh: {
    allergens: ['gluten', 'wheat'],
    categories: ['carb', 'grain', 'wheat', 'gluten', 'freekeh', 'whole_grain'],
  },
  koshari_rice_pasta: {
    allergens: ['gluten', 'wheat'],
    categories: ['carb', 'grain', 'rice', 'wheat', 'gluten', 'pasta', 'koshari'],
  },
  sweet_potato: {
    allergens: [],
    categories: ['carb', 'starchy_vegetable', 'potato', 'sweet_potato', 'root_vegetable', 'gluten_free'],
  },
  potato_boiled: {
    allergens: [],
    categories: ['carb', 'starchy_vegetable', 'potato', 'white_potato', 'root_vegetable', 'gluten_free'],
  },
  corn: {
    allergens: [],
    categories: ['carb', 'grain', 'corn', 'gluten_free', 'vegan'],
  },
  banana: {
    allergens: [],
    categories: ['carb', 'fruit', 'banana', 'gluten_free', 'vegan'],
  },
  mango: {
    allergens: [],
    categories: ['carb', 'fruit', 'mango', 'gluten_free', 'vegan'],
  },
  apple: {
    allergens: [],
    categories: ['carb', 'fruit', 'apple', 'gluten_free', 'vegan'],
  },
  orange: {
    allergens: [],
    categories: ['carb', 'fruit', 'citrus', 'orange', 'gluten_free', 'vegan'],
  },
  watermelon: {
    allergens: [],
    categories: ['carb', 'fruit', 'melon', 'watermelon', 'gluten_free', 'vegan'],
  },
  dates: {
    allergens: [],
    categories: ['carb', 'fruit', 'dried_fruit', 'dates', 'gluten_free', 'vegan'],
  },
  olive_oil: {
    allergens: [],
    categories: ['fat', 'oil', 'olive', 'olive_oil', 'plant_fat', 'vegan'],
  },
  avocado: {
    allergens: [],
    categories: ['fat', 'fruit', 'avocado', 'plant_fat', 'gluten_free', 'vegan'],
  },
  tahini: {
    allergens: ['sesame'],
    categories: ['fat', 'seed', 'sesame', 'tahini', 'plant_fat', 'vegan'],
  },
  peanut_butter: {
    allergens: ['peanut'],
    categories: ['fat', 'legumes', 'peanut', 'nut_butter', 'plant_fat', 'vegan'],
  },
  almonds: {
    allergens: ['tree_nut', 'almond'],
    categories: ['fat', 'tree_nut', 'almond', 'nuts', 'plant_fat', 'vegan'],
  },
  walnuts: {
    allergens: ['tree_nut', 'walnut'],
    categories: ['fat', 'tree_nut', 'walnut', 'nuts', 'plant_fat', 'vegan'],
  },
  flaxseeds: {
    allergens: [],
    categories: ['fat', 'seed', 'flaxseed', 'plant_fat', 'vegan'],
  },
  full_fat_cheese: {
    allergens: ['milk', 'dairy', 'lactose'],
    categories: ['fat', 'animal_fat', 'dairy', 'milk', 'cheese', 'romy_cheese'],
  },
  feta_cheese: {
    allergens: ['milk', 'dairy', 'lactose'],
    categories: ['fat', 'animal_fat', 'dairy', 'milk', 'cheese', 'feta'],
  },
  butter: {
    allergens: ['milk', 'dairy', 'lactose'],
    categories: ['fat', 'animal_fat', 'dairy', 'milk', 'butter'],
  },
  sunflower_oil: {
    allergens: [],
    categories: ['fat', 'oil', 'sunflower', 'sunflower_oil', 'plant_fat', 'vegan'],
  },
  cucumber: {
    allergens: [],
    categories: ['vegetable', 'non_starchy_vegetable', 'cucumber', 'gluten_free', 'vegan'],
  },
  tomato: {
    allergens: [],
    categories: ['vegetable', 'non_starchy_vegetable', 'nightshade', 'tomato', 'gluten_free', 'vegan'],
  },
  lettuce: {
    allergens: [],
    categories: ['vegetable', 'non_starchy_vegetable', 'leafy_greens', 'lettuce', 'gluten_free', 'vegan'],
  },
  bell_pepper: {
    allergens: [],
    categories: ['vegetable', 'non_starchy_vegetable', 'nightshade', 'pepper', 'bell_pepper', 'gluten_free', 'vegan'],
  },
  spinach: {
    allergens: [],
    categories: ['vegetable', 'non_starchy_vegetable', 'leafy_greens', 'spinach', 'gluten_free', 'vegan'],
  },
  zucchini: {
    allergens: [],
    categories: ['vegetable', 'non_starchy_vegetable', 'squash', 'zucchini', 'gluten_free', 'vegan'],
  },
  eggplant: {
    allergens: [],
    categories: ['vegetable', 'non_starchy_vegetable', 'nightshade', 'eggplant', 'gluten_free', 'vegan'],
  },
  mushrooms: {
    allergens: [],
    categories: ['vegetable', 'fungi', 'mushroom', 'gluten_free', 'vegan'],
  },
  broccoli: {
    allergens: [],
    categories: ['vegetable', 'non_starchy_vegetable', 'cruciferous', 'broccoli', 'gluten_free', 'vegan'],
  },
  carrots: {
    allergens: [],
    categories: ['vegetable', 'root_vegetable', 'carrot', 'gluten_free', 'vegan'],
  },
  green_beans: {
    allergens: [],
    categories: ['vegetable', 'legumes', 'green_beans', 'gluten_free', 'vegan'],
  },
  onion: {
    allergens: [],
    categories: ['vegetable', 'allium', 'onion', 'gluten_free', 'vegan'],
  },
  hummus: {
    allergens: ['sesame'],
    categories: ['mixed', 'dip', 'legumes', 'chickpeas', 'sesame', 'tahini', 'hummus', 'vegan'],
  },
  baba_ghanoush: {
    allergens: ['sesame'],
    categories: ['mixed', 'dip', 'vegetable', 'eggplant', 'sesame', 'tahini', 'baba_ghanoush', 'vegan'],
  },
};

const mealMetadata = {
  chicken_breast: ['lunch', 'dinner', 'iftar'],
  chicken_thigh: ['lunch', 'dinner', 'iftar'],
  turkey_breast: ['lunch', 'dinner', 'iftar'],
  chicken_kofta: ['lunch', 'dinner', 'iftar'],
  beef_lean: ['lunch', 'dinner', 'iftar'],
  kofta_beef: ['lunch', 'dinner', 'iftar'],
  lamb_lean: ['lunch', 'dinner', 'iftar'],
  liver_beef: ['lunch', 'dinner', 'iftar'],
  liver_chicken: ['lunch', 'dinner', 'iftar'],
  tilapia: ['lunch', 'dinner', 'iftar'],
  white_fish: ['lunch', 'dinner', 'iftar'],
  tuna_canned: ['lunch', 'snack', 'suhoor'],
  shrimp: ['lunch', 'dinner', 'iftar'],
  sardines: ['lunch', 'snack', 'suhoor'],
  whole_eggs: ['breakfast', 'dinner', 'snack', 'suhoor'],
  egg_whites: ['breakfast', 'dinner', 'snack', 'suhoor'],
  cottage_cheese: ['breakfast', 'snack', 'suhoor'],
  greek_yogurt: ['breakfast', 'snack', 'suhoor'],
  labneh: ['breakfast', 'snack', 'suhoor'],
  ful_medames: ['breakfast', 'dinner', 'suhoor', 'iftar'],
  lentils_red: ['lunch', 'dinner', 'iftar'],
  lentils_brown: ['lunch', 'dinner', 'iftar'],
  chickpeas: ['lunch', 'dinner', 'snack', 'iftar'],
  tofu: ['lunch', 'dinner', 'snack'],
  whey_protein: ['breakfast', 'snack', 'suhoor'],
  white_rice: ['lunch', 'dinner', 'iftar'],
  brown_rice: ['lunch', 'dinner', 'iftar'],
  oats: ['breakfast', 'dinner', 'snack', 'suhoor'],
  fino_bread: ['breakfast', 'snack', 'suhoor'],
  baladi_bread: ['breakfast', 'lunch', 'dinner', 'suhoor', 'iftar'],
  pasta_cooked: ['lunch', 'dinner', 'iftar'],
  whole_wheat_pasta: ['lunch', 'dinner', 'iftar'],
  quinoa: ['lunch', 'dinner', 'iftar'],
  freekeh: ['lunch', 'dinner', 'iftar'],
  koshari_rice_pasta: ['lunch', 'dinner', 'iftar'],
  sweet_potato: ['breakfast', 'lunch', 'dinner', 'snack', 'suhoor', 'iftar'],
  potato_boiled: ['breakfast', 'lunch', 'dinner', 'snack', 'suhoor', 'iftar'],
  corn: ['snack', 'lunch', 'dinner', 'suhoor', 'iftar'],
  banana: ['breakfast', 'snack', 'suhoor', 'iftar'],
  mango: ['breakfast', 'snack', 'suhoor', 'iftar'],
  apple: ['breakfast', 'snack', 'suhoor'],
  orange: ['breakfast', 'snack', 'suhoor', 'iftar'],
  watermelon: ['snack', 'iftar'],
  dates: ['snack', 'suhoor', 'iftar'],
  olive_oil: ['breakfast', 'lunch', 'dinner', 'suhoor', 'iftar'],
  avocado: ['breakfast', 'snack', 'lunch', 'suhoor'],
  tahini: ['breakfast', 'lunch', 'dinner', 'snack', 'suhoor', 'iftar'],
  peanut_butter: ['breakfast', 'snack', 'suhoor'],
  almonds: ['snack', 'breakfast', 'suhoor'],
  walnuts: ['snack', 'breakfast', 'suhoor'],
  flaxseeds: ['breakfast', 'snack', 'suhoor'],
  full_fat_cheese: ['breakfast', 'snack', 'suhoor'],
  feta_cheese: ['breakfast', 'snack', 'suhoor'],
  butter: ['breakfast', 'suhoor'],
  sunflower_oil: ['lunch', 'dinner', 'iftar'],
  cucumber: ['breakfast', 'lunch', 'dinner', 'snack', 'suhoor', 'iftar'],
  tomato: ['breakfast', 'lunch', 'dinner', 'snack', 'suhoor', 'iftar'],
  lettuce: ['lunch', 'dinner', 'snack', 'iftar'],
  bell_pepper: ['breakfast', 'lunch', 'dinner', 'snack', 'iftar'],
  spinach: ['breakfast', 'lunch', 'dinner', 'suhoor', 'iftar'],
  zucchini: ['lunch', 'dinner', 'iftar'],
  eggplant: ['lunch', 'dinner', 'suhoor', 'iftar'],
  mushrooms: ['breakfast', 'lunch', 'dinner', 'suhoor', 'iftar'],
  broccoli: ['lunch', 'dinner', 'iftar'],
  carrots: ['lunch', 'dinner', 'snack', 'iftar'],
  green_beans: ['lunch', 'dinner', 'iftar'],
  onion: ['breakfast', 'lunch', 'dinner', 'suhoor', 'iftar'],
  hummus: ['breakfast', 'lunch', 'snack', 'suhoor', 'iftar'],
  baba_ghanoush: ['breakfast', 'lunch', 'dinner', 'snack', 'suhoor', 'iftar'],
};

const servingMetadata = {
  chicken_breast: [80, 220],
  chicken_thigh: [80, 220],
  turkey_breast: [80, 220],
  chicken_kofta: [80, 200],
  beef_lean: [80, 220],
  kofta_beef: [80, 200],
  lamb_lean: [70, 180],
  liver_beef: [70, 160],
  liver_chicken: [70, 160],
  tilapia: [100, 250],
  white_fish: [100, 250],
  tuna_canned: [60, 150],
  shrimp: [80, 220],
  sardines: [60, 140],
  whole_eggs: [50, 150],
  egg_whites: [60, 250],
  cottage_cheese: [80, 250],
  greek_yogurt: [100, 250],
  labneh: [30, 100],
  ful_medames: [120, 300],
  lentils_red: [100, 280],
  lentils_brown: [100, 280],
  chickpeas: [80, 240],
  tofu: [80, 220],
  whey_protein: [20, 40],
  white_rice: [80, 260],
  brown_rice: [80, 260],
  oats: [30, 90],
  fino_bread: [30, 100],
  baladi_bread: [35, 130],
  pasta_cooked: [80, 260],
  whole_wheat_pasta: [80, 260],
  quinoa: [80, 240],
  freekeh: [80, 240],
  koshari_rice_pasta: [100, 300],
  sweet_potato: [100, 300],
  potato_boiled: [100, 300],
  corn: [80, 220],
  banana: [80, 160],
  mango: [80, 220],
  apple: [100, 220],
  orange: [120, 240],
  watermelon: [150, 450],
  dates: [10, 45],
  olive_oil: [5, 20],
  avocado: [40, 140],
  tahini: [10, 35],
  peanut_butter: [10, 35],
  almonds: [10, 40],
  walnuts: [10, 40],
  flaxseeds: [5, 20],
  full_fat_cheese: [20, 70],
  feta_cheese: [20, 80],
  butter: [5, 20],
  sunflower_oil: [5, 20],
  cucumber: [50, 250],
  tomato: [50, 250],
  lettuce: [30, 150],
  bell_pepper: [50, 200],
  spinach: [50, 200],
  zucchini: [80, 250],
  eggplant: [80, 250],
  mushrooms: [50, 200],
  broccoli: [80, 250],
  carrots: [50, 200],
  green_beans: [80, 250],
  onion: [20, 120],
  hummus: [30, 120],
  baba_ghanoush: [30, 120],
};

const foods = JSON.parse(fs.readFileSync(foodPath, 'utf8'));
const missing = foods.filter((food) => !metadata[food.id]).map((food) => food.id);
const missingMealMetadata = foods.filter((food) => !mealMetadata[food.id]).map((food) => food.id);
const missingServingMetadata = foods.filter((food) => !servingMetadata[food.id]).map((food) => food.id);

if (missing.length > 0) {
  throw new Error(`Missing category metadata for: ${missing.join(', ')}`);
}
if (missingMealMetadata.length > 0) {
  throw new Error(`Missing meal metadata for: ${missingMealMetadata.join(', ')}`);
}
if (missingServingMetadata.length > 0) {
  throw new Error(`Missing serving metadata for: ${missingServingMetadata.join(', ')}`);
}

const enriched = foods.map((food) => ({
  ...food,
  allergens: metadata[food.id].allergens,
  categories: metadata[food.id].categories,
  meal_tags: mealMetadata[food.id],
  min_serving_g: servingMetadata[food.id][0],
  max_serving_g: servingMetadata[food.id][1],
}));

fs.writeFileSync(foodPath, `${JSON.stringify(enriched, null, 2)}\n`);
