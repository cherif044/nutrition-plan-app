const { test, expect } = require('@playwright/test');

const customer = {
  id: 1, name: 'QA Customer', sex: 'female', age: 30, weight: 60, height: 165, activity_level: 'light', planCount: 1,
};
const plan = {
  id: 2, name: 'QA Plan', customer_id: null, goal: 'maintain', calories: 1900, protein_g: 120, carbs_g: 210, fat_g: 60,
  start_date: '2026-01-01', duration_weeks: 4, updated_at: new Date().toISOString(),
};
const pageOf = (items, summary) => ({ items, page: 1, totalPages: 1, total: items.length, summary });

test('list rows omit arrows and the plan three-dot menu toggles closed on a second press', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const json = (body) => ({ contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/auth/me', (route) => route.fulfill(json({ user: { firstname: 'QA' } })));
  await page.route('**/api/dashboard', (route) => route.fulfill(json({
    stats: {
      totalPlans: 1,
      customers: 1,
      plansThisWeek: 1,
      customersThisWeek: 1,
      planStatus: { onTrack: 0, endingSoon: 0, expired: 1 },
      activeCalorieRanges: [],
      customersBySex: { female: { total: 1, ongoing: 0 } },
    },
    recentPlans: [plan],
    expiringPlans: [plan],
  })));
  await page.route('**/api/dashboard/customers?*', (route) => route.fulfill(json(
    pageOf([customer], { totalCustomers: 1, assignedPlans: 0 }),
  )));
  await page.route('**/api/dashboard/plans?*', (route) => route.fulfill(json(pageOf([plan], {
    totalGeneralPlans: 1,
    assignedPlans: 0,
    newestAt: null,
    goalCounts: {},
    calorieRangeCounts: { '1800-2000': 1 },
    calorieRangeActiveCounts: {},
  }))));

  await page.goto('/dashboard#/customers/group/female');
  await expect(page.locator('.ph-row__chevron, .pc-row__chevron, .dashboard-row-chevron')).toHaveCount(0);

  await expect(page.locator('#group-customers-list')).toContainText('QA Customer');

  await page.goto('/dashboard#/plans/band/1800-2000');
  const planMenuButton = page.getByRole('button', { name: 'More actions for QA Plan' });
  await planMenuButton.click();
  await expect(page.locator('.dashboard-context-menu')).toBeVisible();
  await planMenuButton.click();
  await expect(page.locator('.dashboard-context-menu')).toBeHidden();
});
