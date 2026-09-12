const { test, expect } = require('@playwright/test');

const food = {
  id: 'chicken_breast_skinless_boneless_grilled',
  name: 'Chicken breast, skinless, boneless, grilled',
  macroRole: 'protein',
  caloriesPer100g: 165,
  proteinGPer100g: 31,
  carbGPer100g: 0,
  fatGPer100g: 3.6,
  defaultServingG: 100,
  minServingG: 40,
  maxServingG: 300,
  categories: ['poultry'],
  mealTags: ['lunch'],
};

const generatedPlan = {
  input: {
    weightKg: '78',
    heightCm: '178',
    age: '29',
    sex: 'male',
    activityLevel: 'moderate',
    goal: 'lose_weight',
    numberOfMeals: '4',
    mealDistribution: 'balanced',
    dietType: 'standard',
    avoidFoods: [],
    ramadanMode: false,
  },
  dailyTargets: {
    calories: 1800,
    proteinG: 140,
    carbG: 170,
    fatG: 60,
    macroRanges: {
      calories: { min: 1710, max: 1890 },
      proteinG: { min: 126, max: 154 },
      carbG: { min: 120, max: 220 },
      fatG: { min: 45, max: 75 },
    },
  },
  diagnostics: {
    bounds: {
      calories: { min: 1710, max: 1890 },
      proteinG: { min: 126, max: 154 },
      carbG: { min: 120, max: 220 },
      fatG: { min: 45, max: 75 },
    },
  },
  allowedProduceFoods: [],
  meals: [
    {
      name: 'Lunch',
      tag: 'lunch',
      target: {
        calories: 450,
        proteinG: 35,
        carbG: 42,
        fatG: 15,
        macroWindows: {
          calories: { min: 100, max: 480 },
          proteinG: { min: 0, max: 100 },
          carbG: { min: 0, max: 60 },
          fatG: { min: 0, max: 20 },
        },
      },
      items: [{ food, quantityG: 100 }],
      originalItems: [{ food, quantityG: 100 }],
      mealOptions: [{
        templateName: 'Alternate lunch',
        items: [{ food, quantityG: 260 }],
        totals: {
          calories: 429,
          proteinG: 80.6,
          carbG: 0,
          fatG: 9.4,
        },
      }],
      totals: {
        calories: 165,
        proteinG: 31,
        carbG: 0,
        fatG: 3.6,
      },
    },
  ],
};

test('autosaved generated plan replaces transient URL with a durable plan URL', async ({ page }) => {
  await page.route('**/api/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ user: { firstname: 'QA' } }),
  }));
  await page.route('**/api/preferences', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ allergyOptions: [] }),
  }));
  await page.route('**/api/customers?limit=100', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ customers: [] }),
  }));
  await page.route('**/api/generation-timeline', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true }),
  }));
  await page.route('**/api/generate-plan', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(generatedPlan),
      headers: { 'x-request-id': 'qa-generate-1' },
    });
  });
  await page.route('**/api/plans', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        plan: {
          id: 987,
          name: 'QA Regression Plan',
          customer_id: null,
        },
      }),
    });
  });

  await page.goto('/planner');
  await page.getByLabel('Plan name').fill('QA Regression Plan');
  const generateButton = page.locator('#plan-form button[type="submit"]');
  await generateButton.click();

  await expect(generateButton).toBeDisabled();
  await expect.poll(() => {
    const url = new URL(page.url());
    return {
      pathname: url.pathname,
      planId: url.searchParams.get('planId'),
      view: url.searchParams.get('view'),
      customerId: url.searchParams.get('customerId'),
    };
  }).toEqual({
    pathname: '/planner',
    planId: '987',
    view: 'plan',
    customerId: null,
  });
  await expect(page.getByRole('button', { name: 'Discard plan' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save plan' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export plan' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save & export' })).toHaveCount(0);
  await expect(page.locator('#folder-save-bar .save-action-bar__status')).toHaveCount(0);
});

test('customer-linked saved plan opens without being marked dirty', async ({ page }) => {
  await page.route('**/api/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ user: { firstname: 'QA' } }),
  }));
  await page.route('**/api/preferences', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ allergyOptions: [] }),
  }));
  await page.route('**/api/customers?limit=100', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ customers: [] }),
  }));
  const savedPlanPayload = {
    plan: {
      id: 123,
      name: 'Saved Customer Plan',
      customer_id: 45,
      is_active: true,
      customer: {
        id: 45,
        name: 'QA Customer',
        age: 35,
        sex: 'female',
        weight: 68,
        height: 169,
        activity_level: 'moderate',
      },
      plan_data: generatedPlan,
    },
  };
  let putCount = 0;
  await page.route('**/api/plans/123', async (route) => {
    if (route.request().method() === 'PUT') {
      putCount += 1;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(savedPlanPayload),
      });
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(savedPlanPayload),
    });
  });

  await page.goto('/planner?planId=123&view=plan');

  await expect(page.locator('#edit-bar .save-action-bar__status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export plan' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Revert all changes' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Next ready meal' }).click();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revert all changes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export plan' })).toBeVisible();

  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Changes saved')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Revert all changes' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export plan' })).toBeVisible();
  await expect(page.getByText('Plan changes saved.')).toHaveCount(0);
  expect(putCount).toBe(1);

  await page.getByRole('button', { name: 'Next ready meal' }).click();
  await expect(page.getByRole('button', { name: 'Revert all changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Revert all changes' }).click();
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Revert all changes' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export plan' })).toBeVisible();
});
