const { test, expect } = require('@playwright/test');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ||= 'postgres://user:pass@127.0.0.1:5432/test';
process.env.METRICS_ENABLED = 'true';
process.env.METRICS_TOKEN = 'test-metrics-token';

const app = require('../src/app');
const { closeGenerationPool } = require('../src/services/planGenerationPool');
const {
  attachDatabaseMetrics,
  normalizeRoute,
  registry,
} = require('../src/utils/metrics');

let server;
let baseUrl;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeGenerationPool();
});

test('normalizes identifiers and removes query strings from route labels', () => {
  expect(normalizeRoute({
    originalUrl: '/api/plans/123/export.pdf?clientName=Private Name',
  })).toBe('/api/plans/:id/export.pdf');
  expect(normalizeRoute({ originalUrl: '/food-icons/private-file.png' }))
    .toBe('/food-icons/:asset');
  expect(normalizeRoute({ originalUrl: '/attacker-controlled-label' })).toBe('/unmatched');
});

test('protects the metrics endpoint with a token', async () => {
  const response = await fetch(`${baseUrl}/metrics`);
  expect(response.status).toBe(401);
});

test('does not expose metrics in production when no token is configured', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousToken = process.env.METRICS_TOKEN;
  process.env.NODE_ENV = 'production';
  delete process.env.METRICS_TOKEN;
  try {
    const response = await fetch(`${baseUrl}/metrics`);
    expect(response.status).toBe(404);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    process.env.METRICS_TOKEN = previousToken;
  }
});

test('exports application, worker, database, and Node metrics', async () => {
  await fetch(`${baseUrl}/api/health`);
  const response = await fetch(`${baseUrl}/metrics`, {
    headers: { Authorization: 'Bearer test-metrics-token' },
  });
  const body = await response.text();

  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/plain');
  expect(body).toContain('nutrition_http_requests_total');
  expect(body).toContain('nutrition_generation_queue_depth');
  expect(body).toContain('nutrition_database_pool_size');
  expect(body).toContain('nutrition_nodejs_');
  expect(body).not.toContain('Private Name');
  expect(body).not.toContain('test-metrics-token');
});

test('records query and connection-pool metrics without SQL labels', async () => {
  const hooks = {};
  const fakeSequelize = {
    connectionManager: {
      pool: { size: 5, available: 3, using: 2, waiting: 0 },
    },
    addHook(type, _name, callback) {
      hooks[type] = callback;
    },
  };
  attachDatabaseMetrics(fakeSequelize);

  const queryOptions = { type: 'SELECT', model: { name: 'Plan' } };
  hooks.beforeQuery(queryOptions);
  hooks.afterQuery(queryOptions);
  const poolOptions = {};
  hooks.beforePoolAcquire(poolOptions);
  hooks.afterPoolAcquire({}, poolOptions);

  const output = await registry.metrics();
  expect(output).toContain('nutrition_database_queries_total');
  expect(output).toContain('operation="SELECT"');
  expect(output).toContain('model="plan"');
  expect(output).toContain('nutrition_database_pool_size');
  expect(output).not.toContain('SELECT *');
});
