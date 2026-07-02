require('dotenv').config();

const { Op } = require('sequelize');
const sequelize = require('../src/config/database');
const { User } = require('../src/models');
const { loadFoods } = require('../src/repositories/foodRepository');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const TEST_PASSWORD = 'StrongPass123!';

const foods = loadFoods();
const foodById = new Map(foods.map((food) => [food.id, food]));

function item(foodId, grams) {
  const food = foodById.get(foodId);
  if (!food) throw new Error(`Unknown food id: ${foodId}`);
  const factor = grams / 100;
  return {
    name: food.name,
    grams,
    foodId: food.id,
    macroRole: food.macroRole,
    categories: food.categories || [],
    calories: parseFloat(((food.caloriesPer100g || 0) * factor).toFixed(1)),
    proteinG: parseFloat(((food.proteinGPer100g || 0) * factor).toFixed(1)),
    carbG: parseFloat(((food.carbGPer100g || 0) * factor).toFixed(1)),
    fatG: parseFloat(((food.fatGPer100g || 0) * factor).toFixed(1)),
  };
}

function totals(items) {
  return items.reduce(
    (acc, current) => ({
      calories: parseFloat((acc.calories + current.calories).toFixed(1)),
      proteinG: parseFloat((acc.proteinG + current.proteinG).toFixed(1)),
      carbG: parseFloat((acc.carbG + current.carbG).toFixed(1)),
      fatG: parseFloat((acc.fatG + current.fatG).toFixed(1)),
    }),
    { calories: 0, proteinG: 0, carbG: 0, fatG: 0 },
  );
}

function pctGap(actual, target) {
  return Math.abs((Number(actual) || 0) - (Number(target) || 0)) / Math.max(1, Number(target) || 0);
}

function targetReport(proposedTotals, target) {
  return {
    calories: pctGap(proposedTotals.calories, target.calories),
    proteinG: pctGap(proposedTotals.proteinG, target.proteinG),
    carbG: pctGap(proposedTotals.carbG, target.carbG),
    fatG: pctGap(proposedTotals.fatG, target.fatG),
  };
}

function hasRawEgg(proposedItems) {
  return proposedItems.some((proposed) => {
    const food = foodById.get(proposed.foodId);
    const name = String(proposed.name || '').toLowerCase();
    const categories = new Set(food?.categories || []);
    return name.includes('raw') && (name.includes('egg') || categories.has('egg') || categories.has('eggs'));
  });
}

function addedDuplicateSubcategory(currentItems, proposedItems) {
  const currentIds = new Set(currentItems.map((current) => current.foodId));
  const proposedIds = new Set(proposedItems.map((proposed) => proposed.foodId));
  const currentSubcategories = new Set(
    currentItems
      .filter((current) => proposedIds.has(current.foodId))
      .map((current) => foodById.get(current.foodId)?.subCategory)
      .filter(Boolean),
  );

  return proposedItems.some((proposed) => {
    if (currentIds.has(proposed.foodId)) return false;
    const subcategory = foodById.get(proposed.foodId)?.subCategory;
    return subcategory && currentSubcategories.has(subcategory);
  });
}

function outOfBounds(proposedItems) {
  return proposedItems.filter((proposed) => {
    const food = foodById.get(proposed.foodId);
    if (!food) return true;
    const min = Number.isFinite(food.minServingG) ? food.minServingG : 1;
    const max = Number.isFinite(food.maxServingG) ? food.maxServingG : 500;
    return proposed.grams < min - 0.1 || proposed.grams > max + 0.1;
  });
}

function removedCurrentFood(currentItems, proposedItems) {
  const proposedIds = new Set(proposedItems.map((proposed) => proposed.foodId));
  return currentItems.filter((current) => !proposedIds.has(current.foodId));
}

async function registerTestUser() {
  const username = `mealchat_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const response = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: TEST_PASSWORD,
      firstname: 'Meal',
      lastname: 'Chat',
    }),
  });

  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!response.ok || !cookie) {
    throw new Error(`Failed to register test user: ${response.status} ${await response.text()}`);
  }

  return { username, cookie };
}

async function runCase(cookie, testCase) {
  const currentTotals = totals(testCase.currentItems);
  const response = await fetch(`${BASE_URL}/api/meal-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      mealTag: testCase.mealTag,
      mealTarget: testCase.target,
      currentItems: testCase.currentItems,
      currentTotals,
      userPreferences: testCase.userPreferences || { dietType: 'standard', avoidFoods: [] },
      conversationHistory: [],
      userMessage: testCase.message,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  const payload = await response.json();
  const result = {
    name: testCase.name,
    status: response.status,
    payloadStatus: payload.status,
    message: payload.message,
    proposedTotals: payload.proposedTotals,
    proposedItems: payload.proposedItems || [],
    failures: [],
  };

  if (!response.ok) result.failures.push(`HTTP ${response.status}`);
  if (testCase.expectDraft && payload.status !== 'ready') result.failures.push('expected ready draft');

  if (payload.proposedItems?.length) {
    const gaps = targetReport(payload.proposedTotals, testCase.target);
    for (const [key, gap] of Object.entries(gaps)) {
      if (gap > (testCase.maxGap || 0.10)) result.failures.push(`${key} gap ${(gap * 100).toFixed(1)}%`);
    }

    if (!testCase.allowRemoveCurrent && removedCurrentFood(testCase.currentItems, payload.proposedItems).length) {
      result.failures.push('removed a current food');
    }
    if (hasRawEgg(payload.proposedItems)) result.failures.push('suggested raw egg');
    if (addedDuplicateSubcategory(testCase.currentItems, payload.proposedItems)) {
      result.failures.push('added duplicate subcategory');
    }

    const boundsFailures = outOfBounds(payload.proposedItems);
    if (boundsFailures.length) {
      result.failures.push(`portion out of bounds: ${boundsFailures.map((f) => f.name).join(', ')}`);
    }

    for (const avoid of testCase.mustNotInclude || []) {
      if (payload.proposedItems.some((proposed) => proposed.name.toLowerCase().includes(avoid.toLowerCase()))) {
        result.failures.push(`included avoided food text: ${avoid}`);
      }
    }

    for (const required of testCase.mustInclude || []) {
      if (!payload.proposedItems.some((proposed) => proposed.name.toLowerCase().includes(required.toLowerCase()))) {
        result.failures.push(`missing required food text: ${required}`);
      }
    }
  }

  return result;
}

const cases = [
  {
    name: 'breakfast underfed bread milk cheddar',
    mealTag: 'breakfast',
    target: { calories: 652, proteinG: 34, carbG: 93, fatG: 17 },
    currentItems: [
      item('bread_brown_whole_grain', 30),
      item('skimmed_milk_fat_free', 250),
      item('cheese_cheddar', 45),
    ],
    message: "Auto-balance couldn't fully hit the targets for this meal. Can you suggest a change?",
    expectDraft: true,
  },
  {
    name: 'lunch low protein rice tilapia oil',
    mealTag: 'lunch',
    target: { calories: 690, proteinG: 45, carbG: 82, fatG: 18 },
    currentItems: [
      item('rice_basmati_cooked', 260),
      item('fish_tilapia_cooked', 55),
      item('oil_olive_salad_or_cooking', 8),
    ],
    message: 'Please fix this meal without changing the food style too much.',
    expectDraft: true,
  },
  {
    name: 'dinner high fat needs leaner balance',
    mealTag: 'dinner',
    target: { calories: 720, proteinG: 52, carbG: 85, fatG: 20 },
    currentItems: [
      item('beef_ground_80_lean_cooked_broiled', 180),
      item('rice_white_long_grain_cooked', 160),
      item('oil_olive_salad_or_cooking', 10),
    ],
    message: 'Can you make this closer to target?',
    expectDraft: true,
    allowRemoveCurrent: true,
  },
  {
    name: 'explicit bread swap baladi to toast',
    mealTag: 'dinner',
    target: { calories: 761, proteinG: 53, carbG: 81, fatG: 25 },
    currentItems: [
      item('bread_egyptian_baladi_eish_baladi', 150),
      item('beef_ground_95_lean_cooked_broiled', 100),
      item('cheese_cheddar', 50),
    ],
    message: 'swap baladi with toast bread',
    expectDraft: true,
    allowRemoveCurrent: true,
    mustInclude: ['Bread, white'],
    mustNotInclude: ['Bread, Egyptian baladi'],
  },
  {
    name: 'snack avoid nuts',
    mealTag: 'snack',
    target: { calories: 380, proteinG: 25, carbG: 40, fatG: 10 },
    currentItems: [
      item('yogurt_greek_plain_whole_milk', 100),
      item('bananas_raw', 80),
    ],
    userPreferences: { dietType: 'standard', avoidFoods: ['nuts'] },
    message: 'Balance this snack, but no nuts.',
    expectDraft: true,
    mustNotInclude: ['nuts', 'almond', 'cashew', 'hazelnut', 'pecan'],
  },
  {
    name: 'question no change',
    mealTag: 'breakfast',
    target: { calories: 652, proteinG: 34, carbG: 93, fatG: 17 },
    currentItems: [
      item('bread_brown_whole_grain', 143),
      item('skimmed_milk_fat_free', 390),
      item('cheese_cheddar', 38),
    ],
    message: 'Does this meal hit the targets?',
    expectDraft: false,
  },
];

(async () => {
  const { username, cookie } = await registerTestUser();
  const results = [];

  try {
    for (const testCase of cases) {
      results.push(await runCase(cookie, testCase));
    }
  } finally {
    await User.destroy({ where: { username: { [Op.like]: 'mealchat_%' } } });
    await sequelize.close();
  }

  for (const result of results) {
    const verdict = result.failures.length ? 'FAIL' : 'PASS';
    console.log(`\n[${verdict}] ${result.name}`);
    console.log(`status=${result.status} payload=${result.payloadStatus}`);
    console.log(`message=${result.message}`);
    if (result.proposedTotals) console.log(`totals=${JSON.stringify(result.proposedTotals)}`);
    if (result.proposedItems.length) {
      console.log(`items=${result.proposedItems.map((i) => `${i.name} ${i.grams}g`).join(' | ')}`);
    }
    if (result.failures.length) console.log(`failures=${result.failures.join('; ')}`);
  }

  const failed = results.filter((result) => result.failures.length);
  if (failed.length) process.exit(1);
})().catch(async (error) => {
  console.error(error);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
