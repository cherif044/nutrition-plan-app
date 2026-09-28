const { metrics } = require('@opentelemetry/api');
const { performance } = require('perf_hooks');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-proto');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { MeterProvider, PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { ATTR_SERVICE_NAME, ATTR_DEPLOYMENT_ENVIRONMENT_NAME } = require('@opentelemetry/semantic-conventions');

const serviceName = 'nutrition-plan-app';
const configured = Boolean(
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT && process.env.OTEL_EXPORTER_OTLP_HEADERS,
);
const flushIntervalMs = Math.max(Number(process.env.OTEL_METRIC_FLUSH_INTERVAL_MS) || 5000, 1000);
const exportTimeoutMs = Math.max(Number(process.env.OTEL_METRIC_EXPORT_TIMEOUT_MS) || 3000, 500);

let provider = null;
let meter = null;
let pendingFlush = null;
let lastFlushStartedAt = 0;

if (configured) {
  const exporter = new OTLPMetricExporter();
  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: 60000,
    exportTimeoutMillis: exportTimeoutMs,
    cardinalityLimits: { default: 500 },
  });
  provider = new MeterProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: String(process.env.NODE_ENV || 'development'),
      'cloud.platform': process.env.VERCEL ? 'vercel' : 'unknown',
      'cloud.region': process.env.VERCEL_REGION || 'unknown',
    }),
    readers: [reader],
  });
  metrics.setGlobalMeterProvider(provider);
  meter = provider.getMeter(serviceName, '1.0.0');

  const runtimeLabels = { runtime: 'nodejs' };
  const observeGauge = (name, description, read) => {
    meter.createObservableGauge(name, { description }).addCallback((result) => {
      const value = Number(read());
      if (Number.isFinite(value)) result.observe(value, runtimeLabels);
    });
  };
  observeGauge('nutrition_nodejs_process_resident_memory_bytes', 'Resident process memory.', () => process.memoryUsage().rss);
  observeGauge('nutrition_nodejs_heap_used_bytes', 'Used JavaScript heap memory.', () => process.memoryUsage().heapUsed);
  observeGauge('nutrition_nodejs_heap_total_bytes', 'Allocated JavaScript heap memory.', () => process.memoryUsage().heapTotal);
  observeGauge('nutrition_nodejs_external_memory_bytes', 'Memory used by C++ objects bound to JavaScript.', () => process.memoryUsage().external);
  observeGauge('nutrition_nodejs_process_uptime_seconds', 'Process uptime.', () => process.uptime());
  observeGauge('nutrition_nodejs_event_loop_utilization', 'Event-loop utilization from zero to one.', () => (
    performance.eventLoopUtilization().utilization
  ));

  const cpuCounter = meter.createObservableCounter('nutrition_nodejs_process_cpu_seconds_total', {
    description: 'Cumulative process CPU time.',
  });
  cpuCounter.addCallback((result) => {
    const usage = process.cpuUsage();
    result.observe(usage.user / 1e6, { ...runtimeLabels, mode: 'user' });
    result.observe(usage.system / 1e6, { ...runtimeLabels, mode: 'system' });
  });
}

function instrumentOptions(config) {
  return { description: config.help };
}

function createCounter(config) {
  return meter?.createCounter(config.name, instrumentOptions(config)) || null;
}

function createHistogram(config) {
  return meter?.createHistogram(config.name, instrumentOptions(config)) || null;
}

function createGauge(config) {
  if (!meter) return null;
  if (typeof config.collect !== 'function') {
    return meter.createGauge(config.name, instrumentOptions(config));
  }

  const observable = meter.createObservableGauge(config.name, instrumentOptions(config));
  observable.addCallback((result) => {
    const collector = {
      set(labelsOrValue, maybeValue) {
        const hasLabels = labelsOrValue && typeof labelsOrValue === 'object';
        const value = Number(hasLabels ? maybeValue : labelsOrValue);
        if (Number.isFinite(value)) result.observe(value, hasLabels ? labelsOrValue : {});
      },
    };
    config.collect.call(collector);
  });
  return null;
}

async function forceFlush() {
  if (!provider) return;
  await provider.forceFlush({ timeoutMillis: exportTimeoutMs });
}

function reportExportError(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('OTLP metric export failed', { message: message.slice(0, 300) });
}

function scheduleFlush() {
  if (!provider) return Promise.resolve();
  const now = Date.now();
  if (pendingFlush) return pendingFlush;
  if (now - lastFlushStartedAt < flushIntervalMs) return Promise.resolve();

  lastFlushStartedAt = now;
  pendingFlush = forceFlush()
    .catch(reportExportError)
    .finally(() => { pendingFlush = null; });

  return pendingFlush;
}

function registerRequestFlush(res) {
  if (!provider) return;
  try {
    const { waitUntil } = require('@vercel/functions');
    const responseFinished = new Promise((resolve) => {
      if (res.writableFinished) {
        resolve();
        return;
      }
      const finish = () => resolve();
      res.once('finish', finish);
      res.once('close', finish);
    });
    // Register while Vercel's request context is active, then export after
    // Express has recorded the completed request metrics.
    waitUntil(responseFinished.then(() => scheduleFlush()));
  } catch (error) {
    // Local and long-running servers have no Vercel request context. Their
    // periodic reader remains active, so this is only actionable in production.
    if (process.env.NODE_ENV === 'production') reportExportError(error);
  }
}

async function shutdown() {
  if (!provider) return;
  if (pendingFlush) await pendingFlush;
  await provider.shutdown({ timeoutMillis: exportTimeoutMs });
}

module.exports = {
  configured,
  createCounter,
  createGauge,
  createHistogram,
  forceFlush,
  registerRequestFlush,
  scheduleFlush,
  shutdown,
};
