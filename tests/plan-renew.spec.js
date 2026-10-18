const { test, expect } = require('@playwright/test');

// Renewing restarts a plan today; it must update in place, never reload the page.

const isoDaysAgo = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const today = isoDaysAgo(0);
const expiredPlan = {
  id: 31, name: 'Old Cut', customer_id: null, goal: 'lose_weight', calories: 1800, protein_g: 150, carbs_g: 160, fat_g: 60,
  meal_count: 4, start_date: isoDaysAgo(40), duration_weeks: 4, version: 5, created_at: new Date().toISOString(),
};
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function mockDashboard(page) {
  const calls = { puts: [], plansPages: 0 };
  await page.route('**/api/auth/me', (route) => json(route, { user: { firstname: 'QA' } }));
  await page.route('**/api/dashboard', (route) => json(route, {
    stats: { totalPlans: 1, customers: 0, planStatus: { onTrack: 0, endingSoon: 0, expired: 1 } },
    recentPlans: [expiredPlan],
    expiringPlans: [expiredPlan],
  }));
  await page.route('**/api/dashboard/plans?*', (route) => {
    calls.plansPages += 1;
    return json(route, {
      items: [expiredPlan], page: 1, totalPages: 1, total: 1,
      summary: { totalGeneralPlans: 1, assignedPlans: 0, newestAt: null, goalCounts: {}, calorieRangeCounts: {} },
    });
  });
  await page.route('**/api/plans/31', (route) => {
    calls.puts.push(route.request().postDataJSON());
    return json(route, { plan: { ...expiredPlan, start_date: today, version: 6 } });
  });
  return calls;
}

test('renewing from the plans list updates only that row', async ({ page }) => {
  const calls = await mockDashboard(page);
  await page.goto('/dashboard#/plans/band/1800-2000');
  const row = page.locator('tr', { hasText: 'Old Cut' }).first();
  await expect(row.getByRole('button', { name: 'Renew' })).toBeVisible();
  await page.evaluate(() => { window.__notReloaded = true; });
  const pagesBefore = calls.plansPages;

  await row.getByRole('button', { name: 'Renew' }).click();
  await expect(page.locator('tr', { hasText: 'Old Cut' }).first().getByRole('button', { name: 'Renew' })).toHaveCount(0);
  await expect(page.locator('tr', { hasText: 'Old Cut' }).first()).toContainText('Ends in 28 days');
  expect(calls.puts).toEqual([{ startDate: today }]);
  expect(calls.plansPages).toBe(pagesBefore);
  expect(await page.evaluate(() => window.__notReloaded)).toBe(true);
});

test('renewing from home takes the plan out of "ending soon" in place', async ({ page }) => {
  const calls = await mockDashboard(page);
  await page.goto('/dashboard#/home');
  const expiring = page.locator('#home-expiring-list');
  await expect(expiring.getByText('Old Cut')).toBeVisible();
  await page.evaluate(() => { window.__notReloaded = true; });

  await expiring.locator('.renew-btn:visible').first().click();
  await expect(expiring.getByText('Old Cut')).toHaveCount(0);
  await expect(expiring).toContainText('Nothing ending soon.');
  expect(calls.puts).toHaveLength(1);
  expect(await page.evaluate(() => window.__notReloaded)).toBe(true);
});

test('an expired plan shows Renew next to its Expired badge', async ({ page }) => {
  let put = null;
  await page.route('**/api/auth/me', (route) => json(route, { user: { firstname: 'QA' } }));
  await page.route('**/api/preferences', (route) => json(route, { avoidFoodOptions: [] }));
  await page.route('**/api/customers?limit=100', (route) => json(route, { customers: [] }));
  await page.route('**/api/foods', (route) => json(route, {
    foods: [{ id: 'oats_raw', name: 'Oats, raw', caloriesPer100g: 389, proteinGPer100g: 16.9, carbGPer100g: 66.3, fatGPer100g: 6.9 }],
  }));
  await page.route('**/api/plans/31/opened', (route) => route.fulfill({ status: 204 }));
  await page.route('**/api/plans/31', (route) => {
    if (route.request().method() === 'PUT') {
      put = route.request().postDataJSON();
      return json(route, { plan: { ...expiredPlan, start_date: today, version: 6 } });
    }
    const zero = { calories: 0, proteinG: 0, carbG: 0, fatG: 0 };
    return json(route, {
      plan: {
        ...expiredPlan,
        plan_data: { manualMode: true, dailyTargets: zero, meals: [{ name: 'Lunch', tag: 'lunch', target: zero, items: [] }] },
      },
    });
  });

  await page.goto('/planner?planId=31&view=plan');
  const badge = page.locator('#plan-view-badge');
  const renew = page.getByRole('button', { name: 'Renew' });
  await expect(badge).toHaveText('Expired');
  await expect(renew).toBeVisible();
  if (process.env.QA_SCREENSHOT_DIR) await page.locator('#plan-view-head').screenshot({ path: `${process.env.QA_SCREENSHOT_DIR}/14-plan-renew.png` });
  await page.evaluate(() => { window.__notReloaded = true; });

  await renew.click();
  await expect(badge).toHaveText('Ongoing');
  await expect(renew).toBeHidden();
  await expect(page.locator('#plan-view-meta')).toContainText('Ends in 28 days');
  expect(put).toEqual({ startDate: today, expectedVersion: 5 });
  expect(await page.evaluate(() => window.__notReloaded)).toBe(true);
});
