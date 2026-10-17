const { test, expect } = require('@playwright/test');

const SHOTS = process.env.QA_SCREENSHOT_DIR || '';

const chicken = {
  id: 'chicken_breast_skinless_boneless_grilled',
  name: 'Chicken breast, skinless, boneless, grilled',
  macroRole: 'protein',
  caloriesPer100g: 151,
  proteinGPer100g: 30.5,
  carbGPer100g: 0,
  fatGPer100g: 3.2,
  defaultServingG: 150,
  minServingG: 40,
  maxServingG: 300,
  categories: ['poultry'],
  mealTags: ['lunch', 'dinner'],
};
const savedCustomFood = {
  id: 'custom_3', name: 'Mama\'s kofta', custom: true, proteinGPer100g: 18, carbGPer100g: 6, fatGPer100g: 14, caloriesPer100g: 222,
};

// Screenshots for visual review, only when QA_SCREENSHOT_DIR is set. Pass a
// locator to capture just that element.
async function shot(page, name, target = null) {
  if (!SHOTS) return;
  await page.waitForTimeout(700); // let bar and ring transitions finish
  const path = `${SHOTS}/${name}.png`;
  if (target?.screenshot) await target.screenshot({ path });
  else await page.screenshot({ path, ...(target || {}) });
}

// A fake server: every request the planner makes, answered in memory.
async function mockApi(page, { customFoods = [] } = {}) {
  const calls = { planCreates: [], planUpdates: [], customFoodCreates: [], swaps: 0, rebalances: 0 };
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/auth/me', (route) => json(route, { user: { firstname: 'QA' } }));
  await page.route('**/api/preferences', (route) => json(route, { avoidFoodOptions: [] }));
  await page.route('**/api/customers?limit=100', (route) => json(route, { customers: [] }));
  await page.route('**/api/foods', (route) => json(route, { foods: [chicken] }));
  await page.route('**/api/generation-timeline', (route) => json(route, { ok: true }));
  await page.route('**/api/swap-suggestions', (route) => { calls.swaps += 1; return json(route, { suggestions: [] }); });
  await page.route('**/api/rebalance-meal', (route) => { calls.rebalances += 1; return json(route, {}, 422); });
  await page.route('**/api/custom-foods', async (route) => {
    if (route.request().method() === 'GET') return json(route, { foods: customFoods });
    const body = route.request().postDataJSON();
    calls.customFoodCreates.push(body);
    const food = {
      id: `custom_${40 + calls.customFoodCreates.length}`,
      custom: true,
      ...body,
      caloriesPer100g: body.proteinGPer100g * 4 + body.carbGPer100g * 4 + body.fatGPer100g * 9,
    };
    return json(route, { food }, 201);
  });
  await page.route('**/api/plans', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    calls.planCreates.push(route.request().postDataJSON());
    return json(route, { plan: { id: 555, name: 'Scratch QA', customer_id: null, version: 1 } }, 201);
  });
  await page.route('**/api/plans/555', (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    calls.planUpdates.push(route.request().postDataJSON());
    return json(route, { plan: { id: 555, name: 'Scratch QA', customer_id: null, version: 2 } });
  });
  await page.route('**/api/plans/555/opened', (route) => route.fulfill({ status: 204 }));
  return calls;
}

async function startFromScratch(page, mealCount) {
  await page.goto('/planner');
  await page.getByLabel('Plan name').fill('Scratch QA');
  const link = page.getByRole('button', { name: 'or start from scratch' });
  await expect(link).toBeVisible();
  await shot(page, '01-rail-link', page.locator('.pb-rail'));
  await link.click();
  const dialog = page.getByRole('dialog', { name: 'Start from scratch' });
  await expect(dialog).toBeVisible();
  await dialog.locator(`label:has(input[value="${mealCount}"])`).click();
  await shot(page, '02-scratch-dialog');
  await dialog.getByRole('button', { name: 'Start plan' }).click();
  await expect(dialog).toHaveCount(0);
}

test('start from scratch opens empty meals in manual mode and saves like any plan', async ({ page }) => {
  const calls = await mockApi(page);
  await startFromScratch(page, 5);

  await expect(page.locator('.meal-card')).toHaveCount(5);
  await expect(page.locator('.meal-card .food-item:not(.food-item--pending-add)')).toHaveCount(0);
  await expect(page.locator('.manual-mode-toggle')).toBeChecked();
  await expect(page.locator('.manual-mode-toggle')).toBeDisabled();
  await expect(page.locator('.summary .metric--empty')).toHaveCount(4);
  await expect.poll(() => calls.planCreates.length).toBe(1);
  const created = calls.planCreates[0];
  expect(created.name).toBe('Scratch QA');
  expect(created.planData.manualMode).toBe(true);
  expect(created.planData.meals.map((meal) => meal.name)).toEqual(['Breakfast', 'Snack 1', 'Lunch', 'Snack 2', 'Dinner']);
  expect(created.planData.meals.every((meal) => meal.items.length === 0)).toBe(true);
  await shot(page, '03-scratch-plan', { fullPage: true });
});

test('custom food is created from manual-mode search and saved with its own macros', async ({ page }) => {
  const calls = await mockApi(page, { customFoods: [savedCustomFood] });
  await startFromScratch(page, 3);

  const lunch = page.locator('.meal-card').nth(1);
  await lunch.getByRole('button', { name: 'Add food' }).click();
  const search = lunch.locator('.pending-food-search__input');

  // Existing custom foods are searchable, tagged "Custom".
  await search.fill('kofta');
  const results = lunch.locator('.pending-food-search__results');
  await expect(results.getByText('Mama\'s kofta')).toBeVisible();
  await expect(results.locator('.custom-food-badge')).toHaveText('Custom');
  await search.fill('Grilled halloumi');
  await expect(results.getByText('No foods match that search.')).toBeVisible();
  const createRow = results.getByRole('button', { name: /Create custom food/ });
  await expect(createRow).toBeVisible();
  await shot(page, '04-search-create-row', lunch);

  await createRow.click();
  const dialog = page.getByRole('dialog', { name: 'Create custom food' });
  await expect(dialog.getByLabel('Food name')).toHaveValue('Grilled halloumi');
  // Over 100 g of macros per 100 g is refused before anything is sent.
  await dialog.getByLabel('Protein').fill('60');
  await dialog.getByLabel('Carbs').fill('30');
  await dialog.getByLabel('Fat').fill('20');
  await dialog.getByRole('button', { name: 'Create and add' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Protein, carbs and fat together cannot be more than 100 g per 100 g.');
  await shot(page, '05-dialog-error');
  expect(calls.customFoodCreates).toHaveLength(0);

  await dialog.getByLabel('Protein').fill('21');
  await dialog.getByLabel('Carbs').fill('2.5');
  await dialog.getByLabel('Fat').fill('25');
  await expect(dialog.locator('[data-custom-food-kcal]')).toHaveText('319');
  await shot(page, '06-dialog-filled');
  await dialog.getByRole('button', { name: 'Create and add' }).click();
  await expect(dialog).toHaveCount(0);
  expect(calls.customFoodCreates).toEqual([{ name: 'Grilled halloumi', proteinGPer100g: 21, carbGPer100g: 2.5, fatGPer100g: 25 }]);

  const row = lunch.locator('.food-item', { hasText: 'Grilled halloumi' });
  await expect(row).toBeVisible();
  await expect(row.locator('.food-icon')).toHaveAttribute('data-tone', 'custom');
  await expect(row.locator('.food-cell--cal')).toHaveText('319');
  const grams = row.locator('.manual-grams-input');
  expect(await grams.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await shot(page, '07-custom-row', lunch);

  await page.getByRole('button', { name: 'Save plan' }).click();
  await expect.poll(() => calls.planUpdates.length).toBeGreaterThan(0);
  const savedLunch = calls.planUpdates.at(-1).planData.meals[1];
  expect(savedLunch.items).toEqual([{
    foodId: 'custom_41',
    quantityG: 100,
    customFood: { name: 'Grilled halloumi', proteinGPer100g: 21, carbGPer100g: 2.5, fatGPer100g: 25 },
  }]);
  expect(calls.swaps + calls.rebalances).toBe(0);
});

test('custom foods are not offered outside manual mode', async ({ page }) => {
  await mockApi(page, { customFoods: [savedCustomFood] });
  const generated = {
    input: { goal: 'maintain', numberOfMeals: '3' },
    dailyTargets: { calories: 1800, proteinG: 140, carbG: 170, fatG: 60 },
    meals: [{
      name: 'Lunch', tag: 'lunch', target: { calories: 450, proteinG: 35 },
      items: [{ food: chicken, quantityG: 150 }], originalItems: [{ food: chicken, quantityG: 150 }], mealOptions: [],
    }],
  };
  await page.route('**/api/generate-plan', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(generated) }));
  let customFoodRequests = 0;
  page.on('request', (request) => { if (request.url().includes('/api/custom-foods')) customFoodRequests += 1; });

  await page.goto('/planner');
  await page.getByLabel('Plan name').fill('Generated QA');
  await page.locator('#plan-form button[type="submit"]').click();
  await expect(page.locator('#plan-form')).toBeHidden();
  await expect(page.getByRole('button', { name: 'or start from scratch' })).toBeHidden();
  await page.locator('.edit-mode-switch').click();
  await page.getByRole('button', { name: 'Add food' }).click();
  await page.locator('.pending-food-search__input').fill('kofta');
  const results = page.locator('.pending-food-search__results');
  await expect(results.getByText('No allowed foods match that search.')).toBeVisible();
  await expect(results.getByRole('button', { name: /Create custom food/ })).toHaveCount(0);
  expect(customFoodRequests).toBe(0);
});

test('scratch and custom food dialogs fit a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await startFromScratch(page, 4);
  await expect(page.locator('.meal-card')).toHaveCount(4);
  await page.locator('.meal-card').first().getByRole('button', { name: 'Add food' }).click();
  await page.locator('.pending-food-search__input').fill('Labneh balls');
  await page.getByRole('button', { name: /Create custom food/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Create custom food' });
  await dialog.getByLabel('Protein').fill('9');
  await dialog.getByLabel('Carbs').fill('4');
  await dialog.getByLabel('Fat').fill('18');
  const box = await dialog.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(page, '08-mobile-dialog');
  await dialog.getByRole('button', { name: 'Create and add' }).click();
  const row = page.locator('.food-item', { hasText: 'Labneh balls' });
  await expect(row).toBeVisible();
  const card = await page.locator('.meal-card').first().boundingBox();
  const plus = await row.getByRole('button', { name: 'Increase' }).boundingBox();
  expect(plus.x + plus.width).toBeLessThanOrEqual(card.x + card.width);
  await shot(page, '09-mobile-row', page.locator('.meal-card').first());
});

test('dialogs follow dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await mockApi(page);
  await page.goto('/planner');
  await page.getByLabel('Plan name').fill('Dark QA');
  await page.getByRole('button', { name: 'or start from scratch' }).click();
  await expect(page.getByRole('dialog', { name: 'Start from scratch' })).toBeVisible();
  await shot(page, '10-dark-scratch-dialog');
});

test('a saved plan shows its custom foods from the copy stored in the plan', async ({ page }) => {
  await mockApi(page);
  const zero = { calories: 0, proteinG: 0, carbG: 0, fatG: 0 };
  await page.route('**/api/plans/777', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      plan: {
        id: 777,
        name: 'Saved scratch',
        version: 3,
        customer_id: null,
        start_date: '2026-10-16',
        duration_weeks: 4,
        plan_data: {
          manualMode: true,
          dailyTargets: zero,
          meals: [{
            name: 'Lunch',
            tag: 'lunch',
            target: zero,
            items: [
              { foodId: chicken.id, quantityG: 150 },
              { foodId: 'custom_9', quantityG: 80, customFood: { name: 'Deleted kofta', proteinGPer100g: 18, carbGPer100g: 6, fatGPer100g: 14 } },
            ],
          }],
        },
      },
    }),
  }));
  await page.route('**/api/plans/777/opened', (route) => route.fulfill({ status: 204 }));
  await page.goto('/planner?planId=777');
  const row = page.locator('.food-item', { hasText: 'Deleted kofta' });
  await expect(row).toBeVisible();
  await expect(row.locator('.food-icon')).toHaveAttribute('data-tone', 'custom');
  // 80 g of 18/6/14 per 100 g: (18*4 + 6*4 + 14*9) * 0.8 = 177.6
  await expect(row.locator('.food-cell--cal')).toHaveText('178');
  await expect(page.locator('.manual-mode-toggle')).toBeChecked();
});
