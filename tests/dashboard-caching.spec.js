const { test, expect } = require('@playwright/test');

const customer = {
  id: 1, name: 'QA Customer', age: 35, sex: 'female', weight: 68, height: 169, activity_level: 'moderate', planCount: 1,
};
const plan = { id: 2, name: 'QA Plan', customer_id: 1, goal: 'maintain', updated_at: new Date().toISOString() };
const pageOf = (items, summary) => ({ items, page: 1, totalPages: 1, total: items.length, summary });
const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function mockDashboard(page, { detailDelayMs = 0 } = {}) {
  const requests = { customers: 0, plans: 0, detail: 0 };
  const json = (body) => ({ contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/auth/me', (route) => route.fulfill(json({ user: { firstname: 'QA' } })));
  await page.route('**/api/dashboard', (route) => route.fulfill(json({
    stats: { totalPlans: 1, customers: 1, plansThisWeek: 1, customersThisWeek: 1 },
    recentCustomers: [customer],
    recentPlans: [plan],
  })));
  await page.route('**/api/dashboard/customers?*', (route) => {
    requests.customers += 1;
    return route.fulfill(json(pageOf([customer], { totalCustomers: 1, assignedPlans: 1 })));
  });
  await page.route('**/api/dashboard/plans?*', (route) => {
    requests.plans += 1;
    return route.fulfill(json(pageOf([], {
      totalGeneralPlans: 0, assignedPlans: 1, newestAt: null, goalCounts: {}, calorieRangeCounts: {},
    })));
  });
  await page.route('**/api/customers/1/plans?*', async (route) => {
    requests.detail += 1;
    await delay(detailDelayMs);
    return route.fulfill(json({ customer, plans: [plan], pagination: { page: 1, totalPages: 1, total: 1 } }));
  });
  return requests;
}

test('customer and plan lists are prefetched and render from cache', async ({ page }) => {
  const requests = await mockDashboard(page);
  await page.goto('/dashboard');
  await expect.poll(() => requests.customers + requests.plans).toBe(2);

  await page.evaluate(() => { location.hash = '#/customers'; });
  await expect(page.locator('#customers-list .pc-row__name')).toHaveText('QA Customer', { timeout: 100 });
  await expect(page.locator('#customers-list .list-skeleton')).toHaveCount(0);
});

test('opening a customer draws the known header at once and caches the details', async ({ page }) => {
  const requests = await mockDashboard(page, { detailDelayMs: 800 });
  await page.goto('/dashboard');
  await expect(page.locator('#home-customers-list')).toContainText('QA Customer');

  await page.evaluate(() => { location.hash = '#/customers/1'; });
  // Header comes from the list row; plans show a skeleton while loading.
  await expect(page.locator('#detail-customer-title')).toHaveText('QA Customer', { timeout: 100 });
  await expect(page.locator('#detail-customer-plans .list-skeleton').first()).toBeVisible();
  await expect(page.locator('#detail-customer-plans')).toContainText('QA Plan');

  await page.evaluate(() => { location.hash = '#/home'; });
  await page.evaluate(() => { location.hash = '#/customers/1'; });
  // Revisit renders from cache immediately, then revalidates in the background.
  await expect(page.locator('#detail-customer-plans')).toContainText('QA Plan', { timeout: 100 });
  await expect.poll(() => requests.detail).toBe(2);
});

test('hovering a customer row prefetches its details', async ({ page }) => {
  const requests = await mockDashboard(page);
  await page.goto('/dashboard');
  await page.locator('#home-customers-list .ph-row__link').first().hover();
  await expect.poll(() => requests.detail).toBe(1);

  await page.locator('#home-customers-list .ph-row__link').first().click();
  await expect(page.locator('#detail-customer-plans')).toContainText('QA Plan', { timeout: 100 });
});
