const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

test('pushes application metrics to the configured OTLP endpoint', async () => {
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      received.push({
        path: req.url,
        authorization: req.headers.authorization,
        body: Buffer.concat(chunks),
      });
      res.writeHead(200).end();
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const childCode = `
    const metrics = require('./src/utils/metrics');
    const otel = require('./src/utils/otelMetrics');
    metrics.recordRateLimit('api');
    otel.forceFlush()
      .then(() => otel.shutdown())
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  `;

  try {
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', childCode], {
        cwd: path.join(__dirname, '..'),
        env: {
          ...process.env,
          OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
          OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic test-credential',
          OTEL_METRIC_EXPORT_TIMEOUT_MS: '2000',
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code !== 0) reject(new Error(stderr || `Exporter exited with code ${code}`));
        else resolve(code);
      });
    });

    expect(exitCode).toBe(0);
    expect(received.length).toBeGreaterThan(0);
    expect(received[0].path).toBe('/v1/metrics');
    expect(received[0].authorization).toBe('Basic test-credential');
    expect(received[0].body.includes(Buffer.from('nutrition_rate_limit_exceeded_total'))).toBe(true);
    expect(received[0].body.includes(Buffer.from('nutrition_nodejs_heap_used_bytes'))).toBe(true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
