const { existsSync, readFileSync, readdirSync } = require('fs');
const { join } = require('path');
const { test, expect } = require('@playwright/test');

const ROOT = join(__dirname, '..');
const RETIRED_RUNTIME_MARKERS = [
  '/api/folders',
  "app.get('/explorer'",
  "app.get('/customers/:id'",
  "router.get('/match'",
  "router.post('/:id/duplicate'",
];

test('only current UI pages are shipped', () => {
  for (const page of ['index.html', 'login.html', 'register.html', 'dashboard.html', 'planner.html', 'account.html']) {
    expect(existsSync(join(ROOT, 'public', page)), page).toBe(true);
  }
  for (const retiredPage of ['customer.html', 'explorer.html']) {
    expect(existsSync(join(ROOT, 'public', retiredPage)), retiredPage).toBe(false);
  }
});

test('retired product routes cannot be mounted again accidentally', () => {
  const featureRoutes = readdirSync(join(ROOT, 'src', 'features'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(ROOT, 'src', 'features', entry.name, 'routes.js'))
    .filter(existsSync);
  const runtimeSources = [
    join(ROOT, 'src', 'app.js'),
    ...featureRoutes,
  ].map((file) => readFileSync(file, 'utf8')).join('\n');

  for (const marker of RETIRED_RUNTIME_MARKERS) {
    expect(runtimeSources.includes(marker), marker).toBe(false);
  }
});
