const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30_000,
  webServer: {
    command: 'node scripts/servePublicForTests.js',
    url: 'http://127.0.0.1:3000/healthz',
    reuseExistingServer: true,
  },
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
  },
});
