const { test, expect } = require('@playwright/test');

test('dashboard rows omit arrows and three-dot menus toggle closed on a second press', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ user: { firstname: 'QA' } }),
  }));
  await page.route('**/api/dashboard?limit=100', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      stats: { totalPlans: 1, customers: 1, activePlans: 1, plansThisWeek: 1, customersThisWeek: 1 },
      customers: [{ id: 1, name: 'QA Customer', planCount: 1, activePlan: { id: 2, name: 'QA Plan' } }],
      generalPlans: [],
      recentPlans: [{ id: 2, name: 'QA Plan', customer_id: 1, goal: 'maintain', updated_at: new Date().toISOString() }],
    }),
  }));

  await page.goto('/dashboard');
  await expect(page.locator('.ph-row__chevron, .pc-row__chevron, .dashboard-row-chevron')).toHaveCount(0);

  const customerMenuButton = page.getByRole('button', { name: 'More actions for QA Customer' });
  await customerMenuButton.click();
  await expect(page.locator('.dashboard-context-menu')).toBeVisible();
  await customerMenuButton.click();
  await expect(page.locator('.dashboard-context-menu')).toBeHidden();

  const planMenuButton = page.getByRole('button', { name: 'More actions for QA Plan' });
  await planMenuButton.click();
  await expect(page.locator('.dashboard-context-menu')).toBeVisible();
  await planMenuButton.click();
  await expect(page.locator('.dashboard-context-menu')).toBeHidden();
});
