const { timingSafeEqual } = require('crypto');
const {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} = require('@prometheus-io/client');
const otel = require('./otelMetrics');

const registry = new Registry();
const serviceName = 'nutrition-plan-app';
const environment = String(process.env.NODE_ENV || 'development').slice(0, 32);

registry.setDefaultLabels({ service: serviceName, environment });
collectDefaultMetrics({
  register: registry,
  prefix: 'nutrition_nodejs_',
  eventLoopMonitoringPrecision: 10,
});

function counter(config) {
  const metric = new Counter({ ...config, registers: [registry] });
  const otelMetric = otel.createCounter(config);
  if (!otelMetric) return metric;
  const increment = metric.inc.bind(metric);
  metric.inc = (labelsOrValue, maybeValue) => {
    increment(labelsOrValue, maybeValue);
    const hasLabels = labelsOrValue && typeof labelsOrValue === 'object';
    const value = Number(hasLabels ? maybeValue ?? 1 : labelsOrValue ?? 1);
    if (Number.isFinite(value)) otelMetric.add(value, hasLabels ? labelsOrValue : {});
  };
  return metric;
}

function gauge(config) {
  const metric = new Gauge({ ...config, registers: [registry] });
  const otelMetric = otel.createGauge(config);
  if (!otelMetric) return metric;
  const values = new Map();
  const labelsAndValue = (labelsOrValue, maybeValue, fallback) => {
    const hasLabels = labelsOrValue && typeof labelsOrValue === 'object';
    const labels = hasLabels ? labelsOrValue : {};
    const key = JSON.stringify(labels);
    const supplied = hasLabels ? maybeValue : labelsOrValue;
    return { labels, key, value: Number(supplied ?? fallback(values.get(key))) };
  };
  const set = metric.set.bind(metric);
  const increment = metric.inc.bind(metric);
  const decrement = metric.dec.bind(metric);
  metric.set = (labelsOrValue, maybeValue) => {
    set(labelsOrValue, maybeValue);
    const entry = labelsAndValue(labelsOrValue, maybeValue, () => 0);
    if (Number.isFinite(entry.value)) {
      values.set(entry.key, entry.value);
      otelMetric.record(entry.value, entry.labels);
    }
  };
  metric.inc = (labelsOrValue, maybeValue) => {
    increment(labelsOrValue, maybeValue);
    const entry = labelsAndValue(labelsOrValue, maybeValue, (current) => (current || 0) + 1);
    const current = values.get(entry.key) || 0;
    const delta = Number((labelsOrValue && typeof labelsOrValue === 'object') ? maybeValue ?? 1 : labelsOrValue ?? 1);
    entry.value = current + delta;
    if (Number.isFinite(entry.value)) {
      values.set(entry.key, entry.value);
      otelMetric.record(entry.value, entry.labels);
    }
  };
  metric.dec = (labelsOrValue, maybeValue) => {
    decrement(labelsOrValue, maybeValue);
    const entry = labelsAndValue(labelsOrValue, maybeValue, (current) => (current || 0) - 1);
    const current = values.get(entry.key) || 0;
    const delta = Number((labelsOrValue && typeof labelsOrValue === 'object') ? maybeValue ?? 1 : labelsOrValue ?? 1);
    entry.value = current - delta;
    if (Number.isFinite(entry.value)) {
      values.set(entry.key, entry.value);
      otelMetric.record(entry.value, entry.labels);
    }
  };
  return metric;
}

function histogram(config) {
  const metric = new Histogram({ ...config, registers: [registry] });
  const otelMetric = otel.createHistogram(config);
  if (!otelMetric) return metric;
  const observe = metric.observe.bind(metric);
  metric.observe = (labelsOrValue, maybeValue) => {
    observe(labelsOrValue, maybeValue);
    const hasLabels = labelsOrValue && typeof labelsOrValue === 'object';
    const value = Number(hasLabels ? maybeValue : labelsOrValue);
    if (Number.isFinite(value)) otelMetric.record(value, hasLabels ? labelsOrValue : {});
  };
  return metric;
}

const httpRequests = counter({
  name: 'nutrition_http_requests_total',
  help: 'Completed HTTP requests.',
  labelNames: ['method', 'route', 'status_class'],
});
const httpDuration = histogram({
  name: 'nutrition_http_request_duration_seconds',
  help: 'End-to-end HTTP request duration.',
  labelNames: ['method', 'route', 'status_class'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
});
const httpTimeToFirstByte = histogram({
  name: 'nutrition_http_time_to_first_byte_seconds',
  help: 'Time until the first HTTP response bytes are written.',
  labelNames: ['method', 'route'],
  buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
});
const httpRequestSize = histogram({
  name: 'nutrition_http_request_size_bytes',
  help: 'HTTP request body size from Content-Length.',
  labelNames: ['method', 'route'],
  buckets: [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000, 2000000],
});
const httpResponseSize = histogram({
  name: 'nutrition_http_response_size_bytes',
  help: 'HTTP response bytes written to the network.',
  labelNames: ['method', 'route', 'status_class'],
  buckets: [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000, 2000000, 5000000],
});
const httpInFlight = gauge({
  name: 'nutrition_http_requests_in_flight',
  help: 'HTTP requests currently being handled.',
});
const httpAborted = counter({
  name: 'nutrition_http_aborted_total',
  help: 'HTTP responses closed before completion.',
  labelNames: ['method', 'route'],
});
const httpConnections = gauge({
  name: 'nutrition_http_connections_active',
  help: 'Currently open HTTP connections.',
});
const httpConnectionsTotal = counter({
  name: 'nutrition_http_connections_total',
  help: 'Accepted HTTP connections.',
});
const coldStarts = counter({
  name: 'nutrition_cold_starts_total',
  help: 'Process cold starts observed by the first request.',
});
const rateLimitExceeded = counter({
  name: 'nutrition_rate_limit_exceeded_total',
  help: 'Requests rejected by rate limiting.',
  labelNames: ['scope'],
});

const appErrors = counter({
  name: 'nutrition_errors_total',
  help: 'Application errors grouped without sensitive messages.',
  labelNames: ['category', 'status_class'],
});
const appPhaseDuration = histogram({
  name: 'nutrition_app_phase_duration_seconds',
  help: 'Duration of important application request phases.',
  labelNames: ['phase'],
  buckets: [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
});

const databaseQueries = counter({
  name: 'nutrition_database_queries_total',
  help: 'Database queries completed.',
  labelNames: ['operation', 'model', 'transactional'],
});
const databaseQueryDuration = histogram({
  name: 'nutrition_database_query_duration_seconds',
  help: 'Database query duration.',
  labelNames: ['operation', 'model', 'transactional'],
  buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
});
const databasePoolAcquireDuration = histogram({
  name: 'nutrition_database_pool_acquire_duration_seconds',
  help: 'Time spent waiting to acquire a database connection.',
  buckets: [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 5, 15, 30],
});

let databasePoolProvider = null;
function poolValue(name) {
  try {
    const value = databasePoolProvider?.()?.[name];
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  } catch {
    return 0;
  }
}

gauge({
  name: 'nutrition_database_pool_size',
  help: 'Total database connections in the local pool.',
  collect() { this.set(poolValue('size')); },
});
gauge({
  name: 'nutrition_database_pool_available',
  help: 'Available database connections in the local pool.',
  collect() { this.set(poolValue('available')); },
});
gauge({
  name: 'nutrition_database_pool_in_use',
  help: 'Database connections currently in use.',
  collect() { this.set(poolValue('using')); },
});
gauge({
  name: 'nutrition_database_pool_waiting',
  help: 'Requests waiting for a database connection.',
  collect() { this.set(poolValue('waiting')); },
});

const generationJobs = counter({
  name: 'nutrition_generation_jobs_total',
  help: 'Plan generation jobs by outcome and bounded input dimensions.',
  labelNames: ['outcome', 'diet', 'meal_count', 'ramadan'],
});
const generationDuration = histogram({
  name: 'nutrition_generation_duration_seconds',
  help: 'Plan generation duration split into queue, worker, and total stages.',
  labelNames: ['stage', 'outcome'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15, 30, 60],
});
const generationRestrictions = histogram({
  name: 'nutrition_generation_restrictions',
  help: 'Number of restrictions supplied to generation requests.',
  buckets: [0, 1, 2, 3, 5, 10, 20, 50, 100],
});
const generationResultItems = histogram({
  name: 'nutrition_generation_result_items',
  help: 'Food item count in generated plans.',
  buckets: [1, 5, 10, 15, 20, 30, 50, 100],
});
const generationResultAlternatives = histogram({
  name: 'nutrition_generation_result_alternatives',
  help: 'Alternate meal count returned in generated plans.',
  buckets: [0, 5, 10, 25, 50, 75, 100, 150, 250],
});
const generationWorkerRestarts = counter({
  name: 'nutrition_generation_worker_restarts_total',
  help: 'Generation worker restarts.',
  labelNames: ['reason'],
});
const generationWorkers = gauge({
  name: 'nutrition_generation_workers',
  help: 'Generation workers by state.',
  labelNames: ['state'],
});
const generationQueueDepth = gauge({
  name: 'nutrition_generation_queue_depth',
  help: 'Generation jobs currently waiting.',
});
const generationQueueCapacity = gauge({
  name: 'nutrition_generation_queue_capacity',
  help: 'Maximum generation queue depth.',
});

const solverSlotDuration = histogram({
  name: 'nutrition_solver_slot_duration_seconds',
  help: 'Time spent solving one meal slot.',
  labelNames: ['meal_tag'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});
const solverTemplateDuration = histogram({
  name: 'nutrition_solver_template_duration_seconds',
  help: 'Aggregated template-solving time per meal slot.',
  labelNames: ['meal_tag'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});
const solverGridVisits = histogram({
  name: 'nutrition_solver_grid_visits',
  help: 'Portion-grid nodes visited while solving a meal slot.',
  labelNames: ['meal_tag', 'scope'],
  buckets: [10, 100, 1000, 10000, 100000, 1000000, 10000000, 100000000],
});
const solverCandidates = histogram({
  name: 'nutrition_solver_candidates',
  help: 'Template candidate counts during meal solving.',
  labelNames: ['meal_tag', 'kind'],
  buckets: [0, 1, 5, 10, 25, 50, 100, 150, 250, 500],
});

const plannerOperations = counter({
  name: 'nutrition_planner_operations_total',
  help: 'Interactive planner operations.',
  labelNames: ['operation', 'outcome'],
});
const plannerOperationDuration = histogram({
  name: 'nutrition_planner_operation_duration_seconds',
  help: 'Interactive planner operation duration.',
  labelNames: ['operation', 'outcome'],
  buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});
const plannerOperationItems = histogram({
  name: 'nutrition_planner_operation_items',
  help: 'Items or returned candidates involved in planner operations.',
  labelNames: ['operation', 'kind'],
  buckets: [0, 1, 2, 3, 5, 10, 20, 50, 100, 250],
});

const pdfExports = counter({
  name: 'nutrition_pdf_exports_total',
  help: 'PDF exports by outcome.',
  labelNames: ['outcome'],
});
const pdfDuration = histogram({
  name: 'nutrition_pdf_export_duration_seconds',
  help: 'PDF generation duration.',
  labelNames: ['outcome'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
});
const pdfSize = histogram({
  name: 'nutrition_pdf_export_size_bytes',
  help: 'Generated PDF size.',
  buckets: [1000, 10000, 50000, 100000, 250000, 500000, 1000000, 5000000, 10000000],
});

const dependencyCalls = counter({
  name: 'nutrition_dependency_calls_total',
  help: 'External dependency calls by operation and outcome.',
  labelNames: ['dependency', 'operation', 'outcome'],
});
const dependencyDuration = histogram({
  name: 'nutrition_dependency_call_duration_seconds',
  help: 'External dependency call duration.',
  labelNames: ['dependency', 'operation', 'outcome'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
});

const webVitalDuration = histogram({
  name: 'nutrition_web_vital_seconds',
  help: 'Real-user page timing from the browser (LCP, FCP, TTFB, INP, page load).',
  labelNames: ['metric', 'page'],
  buckets: [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10, 20],
});
const webVitalLayoutShift = histogram({
  name: 'nutrition_web_vital_cls',
  help: 'Real-user cumulative layout shift score.',
  labelNames: ['page'],
  buckets: [0, 0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 1],
});

const METRIC_PHASES = Object.freeze({
  authJwtMs: 'auth_jwt',
  authUserLookupMs: 'auth_user_lookup',
  authTotalMs: 'auth_total',
  planGenerationMs: 'plan_generation_total',
  planSaveDbMs: 'plan_save_database',
});
const VALID_DIETS = new Set(['standard', 'vegetarian', 'vegan']);
const VALID_MEAL_TAGS = new Set(['breakfast', 'snack', 'lunch', 'dinner', 'iftar', 'suhoor', 'main', 'main_meal']);
const VALID_DB_OPERATIONS = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'UPSERT', 'BULKUPDATE', 'BULKDELETE', 'RAW']);
const VALID_DB_MODELS = new Set(['User', 'Customer', 'Folder', 'Plan']);
const KNOWN_HTTP_ROUTES = new Set([
  '/', '/login', '/register', '/dashboard', '/planner', '/explorer',
  '/livez', '/readyz', '/metrics',
  '/api/health', '/api/foods', '/api/preferences', '/api/generate-plan',
  '/api/generation-timeline', '/api/rebalance-meal', '/api/swap-suggestions',
  '/api/dashboard/customers', '/api/dashboard/plans',
  '/api/auth/firebase-config', '/api/auth/session', '/api/auth/register',
  '/api/auth/login', '/api/auth/logout', '/api/auth/me', '/api/dashboard',
  '/api/customers', '/api/customers/match', '/api/folders', '/api/folders/tree',
  '/api/plans', '/api/vitals',
]);
const WEB_VITAL_TIMINGS = Object.freeze({
  lcp: 'lcp', fcp: 'fcp', ttfb: 'ttfb', inp: 'inp', load: 'load',
});
const WEB_VITAL_PAGES = new Set(['/', '/login', '/register', '/dashboard', '/planner', '/explorer']);
const DB_QUERY_STARTED_AT = Symbol('metricsDbQueryStartedAt');
const DB_POOL_STARTED_AT = Symbol('metricsDbPoolStartedAt');

function elapsedSeconds(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1e9;
}

function observeMilliseconds(metric, labels, milliseconds) {
  const value = Number(milliseconds);
  if (!Number.isFinite(value) || value < 0) return;
  metric.observe(labels, value / 1000);
}

function chunkSize(chunk, encoding) {
  if (chunk === undefined || chunk === null) return 0;
  if (Buffer.isBuffer(chunk)) return chunk.length;
  if (typeof chunk === 'string') {
    return Buffer.byteLength(chunk, typeof encoding === 'string' ? encoding : undefined);
  }
  if (ArrayBuffer.isView(chunk)) return chunk.byteLength;
  return 0;
}

function statusClass(statusCode) {
  const status = Number(statusCode);
  return Number.isFinite(status) ? `${Math.floor(status / 100)}xx` : 'unknown';
}

function normalizeRoute(req) {
  const pathname = String(req.originalUrl || req.url || req.path || '/').split('?')[0] || '/';
  if (KNOWN_HTTP_ROUTES.has(pathname)) return pathname;
  const patterns = [
    [/^\/api\/plans\/[^/]+\/export\.pdf$/, '/api/plans/:id/export.pdf'],
    [/^\/api\/plans\/[^/]+\/duplicate$/, '/api/plans/:id/duplicate'],
    [/^\/api\/plans\/[^/]+$/, '/api/plans/:id'],
    [/^\/api\/customers\/[^/]+\/plans$/, '/api/customers/:id/plans'],
    [/^\/api\/customers\/[^/]+$/, '/api/customers/:id'],
    [/^\/api\/folders\/[^/]+\/breadcrumb$/, '/api/folders/:id/breadcrumb'],
    [/^\/api\/folders\/[^/]+\/plans$/, '/api/folders/:id/plans'],
    [/^\/api\/folders\/[^/]+$/, '/api/folders/:id'],
    [/^\/customers\/[^/]+$/, '/customers/:id'],
  ];
  for (const [pattern, normalized] of patterns) {
    if (pattern.test(pathname)) return normalized;
  }
  if (pathname.startsWith('/food-icons/')) return '/food-icons/:asset';
  if (pathname.startsWith('/css/')) return '/static/css';
  if (pathname.startsWith('/js/')) return '/static/js';
  if (/\.html?$/i.test(pathname)) return '/static/html';
  return '/unmatched';
}

function recordRequestPhases(metrics = {}) {
  for (const [key, phase] of Object.entries(METRIC_PHASES)) {
    observeMilliseconds(appPhaseDuration, { phase }, metrics[key]);
  }
  if (metrics.coldStart === true) coldStarts.inc();
}

function httpMetricsMiddleware(req, res, next) {
  const startedAt = process.hrtime.bigint();
  const requestBytes = Number(req.get('content-length'));
  let responseBytes = 0;
  let finished = false;
  let firstByteRecorded = false;
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);

  otel.registerRequestFlush(res);
  httpInFlight.inc();
  const recordFirstByte = () => {
    if (firstByteRecorded) return;
    firstByteRecorded = true;
    httpTimeToFirstByte.observe({
      method: String(req.method || 'UNKNOWN').toUpperCase(),
      route: normalizeRoute(req),
    }, elapsedSeconds(startedAt));
  };
  res.write = (chunk, encoding, callback) => {
    recordFirstByte();
    responseBytes += chunkSize(chunk, encoding);
    return originalWrite(chunk, encoding, callback);
  };
  res.end = (chunk, encoding, callback) => {
    recordFirstByte();
    responseBytes += chunkSize(chunk, encoding);
    return originalEnd(chunk, encoding, callback);
  };

  const finish = (aborted = false) => {
    if (finished) return;
    finished = true;
    httpInFlight.dec();
    const method = String(req.method || 'UNKNOWN').toUpperCase();
    const route = normalizeRoute(req);
    const status = statusClass(res.statusCode);
    const labels = { method, route, status_class: status };
    if (aborted) httpAborted.inc({ method, route });
    httpRequests.inc(labels);
    httpDuration.observe(labels, elapsedSeconds(startedAt));
    if (Number.isFinite(requestBytes) && requestBytes >= 0) {
      httpRequestSize.observe({ method, route }, requestBytes);
    }
    httpResponseSize.observe(labels, responseBytes);
    recordRequestPhases(req.metrics);
    otel.scheduleFlush();
  };

  res.once('finish', () => finish(false));
  res.once('close', () => finish(!res.writableFinished));
  next();
}

function attachHttpServerMetrics(server) {
  server.on('connection', (socket) => {
    httpConnections.inc();
    httpConnectionsTotal.inc();
    let closed = false;
    socket.once('close', () => {
      if (closed) return;
      closed = true;
      httpConnections.dec();
    });
  });
}

function normalizeGenerationDimensions(input = {}) {
  const diet = String(input.dietType || 'standard').toLowerCase();
  const mealCount = Number(input.numberOfMeals);
  return {
    diet: VALID_DIETS.has(diet) ? diet : 'unknown',
    meal_count: [2, 3, 4, 5].includes(mealCount) ? String(mealCount) : 'other',
    ramadan: input.ramadanMode ? 'true' : 'false',
  };
}

function restrictionCount(input = {}) {
  return ['allergies', 'dislikes', 'avoidFoods'].reduce((total, key) => (
    total + (Array.isArray(input[key]) ? input[key].length : 0)
  ), 0);
}

function normalizeOutcome(value) {
  const outcome = String(value || 'unknown').toLowerCase();
  const allowed = new Set([
    'success', 'warning', 'impossible', 'validation_error', 'worker_error',
    'worker_exit', 'timeout', 'queue_timeout', 'overloaded', 'shutdown', 'error',
  ]);
  return allowed.has(outcome) ? outcome : 'other';
}

function recordGenerationQueueWait(milliseconds) {
  observeMilliseconds(generationDuration, { stage: 'queue', outcome: 'started' }, milliseconds);
}

function recordGenerationFinished({ input, outcome, totalMs, workerMs, plan }) {
  const normalizedOutcome = normalizeOutcome(outcome);
  generationJobs.inc({ outcome: normalizedOutcome, ...normalizeGenerationDimensions(input) });
  generationRestrictions.observe(restrictionCount(input));
  observeMilliseconds(generationDuration, { stage: 'total', outcome: normalizedOutcome }, totalMs);
  observeMilliseconds(generationDuration, { stage: 'worker', outcome: normalizedOutcome }, workerMs);
  if (plan?.meals) {
    generationResultItems.observe(plan.meals.reduce((total, meal) => total + (meal.items?.length || 0), 0));
    generationResultAlternatives.observe(
      plan.meals.reduce((total, meal) => total + (meal.mealOptions?.length || 0), 0),
    );
  }
}

function recordGenerationWorkerRestart(reason) {
  const safeReason = ['error', 'exit', 'timeout'].includes(reason) ? reason : 'other';
  generationWorkerRestarts.inc({ reason: safeReason });
}

function setGenerationPoolMetrics(stats = {}) {
  generationWorkers.set({ state: 'configured' }, Number(stats.workers) || 0);
  generationWorkers.set({ state: 'ready' }, Number(stats.ready) || 0);
  generationWorkers.set({ state: 'busy' }, Number(stats.busy) || 0);
  generationQueueDepth.set(Number(stats.queued) || 0);
  generationQueueCapacity.set(Number(stats.maxQueue) || 0);
}

function safeMealTag(value) {
  const tag = String(value || '').toLowerCase();
  return VALID_MEAL_TAGS.has(tag) ? tag : 'other';
}

function recordGenerationTraceEvents(events = []) {
  for (const event of events) {
    if (event?.meta?.phase !== 'ready_meal_candidates') continue;
    const meta = event.meta;
    const labels = { meal_tag: safeMealTag(meta.mealTag) };
    observeMilliseconds(solverSlotDuration, labels, meta.slotMs);
    observeMilliseconds(solverTemplateDuration, labels, meta.totalSolveMs);
    if (Number.isFinite(meta.totalGridVisited)) {
      solverGridVisits.observe({ ...labels, scope: 'total' }, meta.totalGridVisited);
    }
    if (Number.isFinite(meta.maxGridVisited)) {
      solverGridVisits.observe({ ...labels, scope: 'maximum' }, meta.maxGridVisited);
    }
    const counts = {
      templates: meta.matchingTemplateCount,
      solved: meta.solvedCandidateCount,
      accepted: meta.acceptedCandidateCount,
      failed: meta.failedSolveCount,
      rejected: meta.rejectedAfterSolveCount,
    };
    for (const [kind, value] of Object.entries(counts)) {
      if (Number.isFinite(value)) solverCandidates.observe({ ...labels, kind }, value);
    }
  }
}

function recordPlannerOperation({ operation, outcome, durationMs, inputItems, resultItems }) {
  const safeOperation = ['rebalance', 'swap_suggestions'].includes(operation) ? operation : 'other';
  const safeOutcome = ['success', 'no_result', 'validation_error', 'error'].includes(outcome)
    ? outcome
    : 'other';
  const labels = { operation: safeOperation, outcome: safeOutcome };
  plannerOperations.inc(labels);
  observeMilliseconds(plannerOperationDuration, labels, durationMs);
  if (Number.isFinite(inputItems)) {
    plannerOperationItems.observe({ operation: safeOperation, kind: 'input' }, inputItems);
  }
  if (Number.isFinite(resultItems)) {
    plannerOperationItems.observe({ operation: safeOperation, kind: 'result' }, resultItems);
  }
}

function recordPdfExport({ outcome, durationMs, bytes }) {
  const safeOutcome = outcome === 'success' ? 'success' : 'error';
  pdfExports.inc({ outcome: safeOutcome });
  observeMilliseconds(pdfDuration, { outcome: safeOutcome }, durationMs);
  if (safeOutcome === 'success' && Number.isFinite(bytes)) pdfSize.observe(bytes);
}

function recordDependencyCall({ dependency, operation, outcome, durationMs }) {
  const safeDependency = dependency === 'firebase' ? 'firebase' : 'other';
  const safeOperation = ['verify_token', 'delete_user'].includes(operation) ? operation : 'other';
  const safeOutcome = outcome === 'success' ? 'success' : 'error';
  const labels = { dependency: safeDependency, operation: safeOperation, outcome: safeOutcome };
  dependencyCalls.inc(labels);
  observeMilliseconds(dependencyDuration, labels, durationMs);
}

function errorCategory(error) {
  if (String(error?.name || '').startsWith('Sequelize')) return 'database';
  if (error?.code === 'generation-overloaded') return 'overload';
  if (String(error?.code || '').includes('timeout')) return 'timeout';
  if (String(error?.code || '').startsWith('auth/')) return 'authentication';
  const status = Number(error?.status || error?.statusCode);
  if (status >= 400 && status < 500) return 'validation';
  return 'internal';
}

function recordError(error, statusCode = 500) {
  appErrors.inc({
    category: errorCategory(error),
    status_class: statusClass(statusCode),
  });
}

function webVitalPage(value) {
  const page = String(value || '').split('?')[0];
  if (WEB_VITAL_PAGES.has(page)) return page;
  if (/^\/customers\/[^/]+$/.test(page)) return '/customers/:id';
  return 'other';
}

// Browser beacons are unauthenticated, so only known metric names and
// plausible values are accepted; anything else is silently dropped.
function recordWebVitals(body = {}) {
  const page = webVitalPage(body.page);
  const values = body.metrics && typeof body.metrics === 'object' ? body.metrics : {};
  let recorded = 0;
  for (const [key, metric] of Object.entries(WEB_VITAL_TIMINGS)) {
    const milliseconds = Number(values[key]);
    if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 120000) continue;
    webVitalDuration.observe({ metric, page }, milliseconds / 1000);
    recorded += 1;
  }
  const cls = Number(values.cls);
  if (Number.isFinite(cls) && cls >= 0 && cls <= 10) {
    webVitalLayoutShift.observe({ page }, cls);
    recorded += 1;
  }
  return recorded;
}

function recordRateLimit(scope) {
  const safeScope = ['api', 'auth', 'generation', 'pdf'].includes(scope) ? scope : 'other';
  rateLimitExceeded.inc({ scope: safeScope });
}

function normalizeDbOperation(options = {}) {
  const operation = String(options.type || 'RAW').toUpperCase();
  return VALID_DB_OPERATIONS.has(operation) ? operation : 'OTHER';
}

function normalizeDbModel(options = {}) {
  const model = String(options.model?.name || 'raw');
  return VALID_DB_MODELS.has(model) ? model.toLowerCase() : 'raw';
}

function dbLabels(options = {}) {
  return {
    operation: normalizeDbOperation(options),
    model: normalizeDbModel(options),
    transactional: options.transaction ? 'true' : 'false',
  };
}

function attachDatabaseMetrics(sequelize) {
  databasePoolProvider = () => sequelize.connectionManager?.pool;
  sequelize.addHook('beforeQuery', 'metrics-query-start', (options) => {
    options[DB_QUERY_STARTED_AT] = process.hrtime.bigint();
  });
  sequelize.addHook('afterQuery', 'metrics-query-end', (options) => {
    const startedAt = options[DB_QUERY_STARTED_AT];
    if (!startedAt) return;
    const labels = dbLabels(options);
    databaseQueries.inc(labels);
    databaseQueryDuration.observe(labels, elapsedSeconds(startedAt));
  });
  sequelize.addHook('beforePoolAcquire', 'metrics-pool-start', (options) => {
    options[DB_POOL_STARTED_AT] = process.hrtime.bigint();
  });
  sequelize.addHook('afterPoolAcquire', 'metrics-pool-end', (_connection, options) => {
    const startedAt = options?.[DB_POOL_STARTED_AT];
    if (startedAt) databasePoolAcquireDuration.observe(elapsedSeconds(startedAt));
  });
}

function presentedMetricsToken(req) {
  const authorization = String(req.get('authorization') || '');
  if (authorization.startsWith('Bearer ')) return authorization.slice(7);
  return String(req.get('x-metrics-token') || '');
}

function tokensMatch(expected, actual) {
  const expectedBuffer = Buffer.from(String(expected));
  const actualBuffer = Buffer.from(String(actual));
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

async function metricsHandler(req, res, next) {
  try {
    if (process.env.METRICS_ENABLED === 'false') return res.status(404).end();
    const expectedToken = process.env.METRICS_TOKEN;
    if (process.env.NODE_ENV === 'production' && !expectedToken) return res.status(404).end();
    if (expectedToken && !tokensMatch(expectedToken, presentedMetricsToken(req))) {
      return res.status(401).json({ error: 'Metrics authentication required.' });
    }
    res.setHeader('Content-Type', registry.contentType);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(await registry.metrics());
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  attachDatabaseMetrics,
  attachHttpServerMetrics,
  httpMetricsMiddleware,
  metricsHandler,
  normalizeRoute,
  recordDependencyCall,
  recordError,
  recordGenerationFinished,
  recordGenerationQueueWait,
  recordGenerationTraceEvents,
  recordGenerationWorkerRestart,
  recordPdfExport,
  recordPlannerOperation,
  recordRateLimit,
  recordWebVitals,
  registry,
  setGenerationPoolMetrics,
  shutdownMetrics: otel.shutdown,
};
