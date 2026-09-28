const { getPreferenceOptions } = require('../config/preferenceTaxonomy');
const {
  getFoods,
  rebalanceMeal,
} = require('../services/planGenerator');
const { generatePlanInWorker } = require('../services/planGenerationPool');
const { getSwapSuggestions } = require('../services/foodSwapService');
const { logger } = require('../utils/logger');
const {
  recordGenerationTraceEvents,
  recordPlannerOperation,
} = require('../utils/metrics');

// The food catalog and preference taxonomy are fixed at deploy time, so both
// responses are built once per instance and cached at the edge.
const STATIC_DATA_CACHE_CONTROL =
  'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';

let preferenceOptionsCache;

function elapsedMs(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1e6;
}

function roundedMs(value) {
  return Number(value.toFixed(1));
}

function recordMetric(req, key, value) {
  req.metrics = req.metrics || {};
  req.metrics[key] = roundedMs(value);
}

function timelineIdFromRequest(req) {
  const value = req.get('x-plan-timeline-id') || req.body?.timelineId || '';
  return String(value).slice(0, 128);
}

function generationRequestIdFromRequest(req) {
  const value = req.get('x-plan-generation-request-id') || req.body?.generationRequestId || '';
  return String(value).slice(0, 128);
}

function serverTimingValue(metrics = {}) {
  return [
    ['auth', metrics.authTotalMs],
    ['auth-user', metrics.authUserLookupMs],
    ['generate', metrics.planGenerationMs],
  ]
    .filter(([, duration]) => Number.isFinite(duration))
    .map(([name, duration]) => `${name};dur=${duration}`)
    .join(', ');
}

function logGeneratorTraceEvents(events) {
  for (const event of events) {
    logger.info(event.message, event.meta);
  }
}

function getCachedPreferenceOptions() {
  if (!preferenceOptionsCache) {
    preferenceOptionsCache = getPreferenceOptions(getFoods());
  }
  return preferenceOptionsCache;
}

async function health(req, res, next) {
  if (req.query.flushMetrics === '1') {
    try {
      const otel = require('../utils/otelMetrics');
      await otel.forceFlush();
      const endpoint = String(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '').replace(/\/$/, '');
      const headerText = String(process.env.OTEL_EXPORTER_OTLP_HEADERS || '');
      const headers = Object.fromEntries(headerText.split(',').map((entry) => {
        const separator = entry.indexOf('=');
        return separator < 0 ? ['', ''] : [
          entry.slice(0, separator).trim(),
          decodeURIComponent(entry.slice(separator + 1).trim()),
        ];
      }).filter(([name]) => name));
      const probe = await fetch(`${endpoint}/v1/metrics`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/x-protobuf' },
        body: Buffer.from([0x0a, 0x00]),
      });
      res.json({
        status: 'ok',
        metricsConfigured: otel.configured,
        metricsFlushed: true,
        endpointValid: endpoint.startsWith('https://'),
        authorizationPresent: Object.keys(headers).some((name) => name.toLowerCase() === 'authorization'),
        probeStatus: probe.status,
      });
    } catch (error) {
      next(error);
    }
    return;
  }
  res.json({ status: 'ok' });
}

function getFoodsHandler(_req, res, next) {
  try {
    res.setHeader('Cache-Control', STATIC_DATA_CACHE_CONTROL);
    res.json({ foods: getFoods() });
  } catch (error) {
    next(error);
  }
}

function getPreferences(_req, res, next) {
  try {
    res.setHeader('Cache-Control', STATIC_DATA_CACHE_CONTROL);
    res.json(getCachedPreferenceOptions());
  } catch (error) {
    next(error);
  }
}

async function generatePlanHandler(req, res, next) {
  const generatorTraceEvents = [];
  try {
    const timelineId = timelineIdFromRequest(req);
    const generationStartedAt = process.hrtime.bigint();
    const plan = await generatePlanInWorker(req.body, {
      requestId: req.id,
      timelineId,
      traceEvents: generatorTraceEvents,
    });
    recordMetric(req, 'planGenerationMs', elapsedMs(generationStartedAt));
    logGeneratorTraceEvents(generatorTraceEvents);
    recordGenerationTraceEvents(generatorTraceEvents);

    const timing = serverTimingValue(req.metrics);
    if (timing) res.setHeader('Server-Timing', timing);

    logger.info('Plan timeline: server generated plan', {
      requestId: req.id,
      timelineId,
      status: plan.status || 'ok',
      numberOfMeals: plan.input?.numberOfMeals,
      mealDistribution: plan.input?.mealDistribution,
      dietType: plan.input?.dietType,
      ramadanMode: Boolean(plan.input?.ramadanMode),
      mealCount: Array.isArray(plan.meals) ? plan.meals.length : 0,
      metrics: req.metrics,
    });

    res.json(plan);
  } catch (error) {
    logGeneratorTraceEvents(generatorTraceEvents);
    recordGenerationTraceEvents(generatorTraceEvents);
    if (error.code === 'generation-overloaded' || error.code === 'generation-queue-timeout') {
      res.setHeader('Retry-After', '1');
    }
    next(error);
  }
}

function timelineEventHandler(req, res, next) {
  try {
    logger.info('Plan timeline: browser event', {
      requestId: req.id,
      timelineId: timelineIdFromRequest(req),
      generationRequestId: generationRequestIdFromRequest(req),
      event: String(req.body?.event || 'unknown').slice(0, 80),
      elapsedMs: Number(req.body?.elapsedMs),
      timings: req.body?.timings || {},
      metrics: req.metrics,
    });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

function rebalanceMealHandler(req, res, next) {
  const startedAt = process.hrtime.bigint();
  try {
    const { mealTarget, items, mealBounds, dailyContext, action, changedItemIndex } = req.body;
    if (!mealTarget || !Array.isArray(items)) {
      recordPlannerOperation({
        operation: 'rebalance',
        outcome: 'validation_error',
        durationMs: elapsedMs(startedAt),
        inputItems: Array.isArray(items) ? items.length : 0,
      });
      return res.status(400).json({ error: 'mealTarget and items are required.' });
    }
    if (!dailyContext) {
      recordPlannerOperation({
        operation: 'rebalance',
        outcome: 'validation_error',
        durationMs: elapsedMs(startedAt),
        inputItems: items.length,
      });
      return res.status(400).json({
        error: 'dailyContext is required to enforce the per-meal calorie, protein, and fat ranges.',
      });
    }

    const result = rebalanceMeal({
      mealTarget,
      items,
      mealBounds,
      dailyContext,
      action,
      changedItemIndex,
    });
    recordPlannerOperation({
      operation: 'rebalance',
      outcome: result.success ? 'success' : 'no_result',
      durationMs: elapsedMs(startedAt),
      inputItems: items.length,
      resultItems: result.items?.length || 0,
    });
    return res.json(result);
  } catch (error) {
    recordPlannerOperation({
      operation: 'rebalance',
      outcome: 'error',
      durationMs: elapsedMs(startedAt),
      inputItems: Array.isArray(req.body?.items) ? req.body.items.length : 0,
    });
    return next(error);
  }
}

function swapSuggestionsHandler(req, res, next) {
  const startedAt = process.hrtime.bigint();
  try {
    const {
      foodId, userPreferences, limit, mealContext,
    } = req.body;

    if (!foodId) {
      recordPlannerOperation({
        operation: 'swap_suggestions',
        outcome: 'validation_error',
        durationMs: elapsedMs(startedAt),
      });
      return res.status(400).json({ error: 'foodId is required.' });
    }

    const result = getSwapSuggestions({
      foodId, userPreferences, limit, mealContext,
    });
    recordPlannerOperation({
      operation: 'swap_suggestions',
      outcome: result.options.length ? 'success' : 'no_result',
      durationMs: elapsedMs(startedAt),
      inputItems: Array.isArray(mealContext?.currentItems) ? mealContext.currentItems.length : 0,
      resultItems: result.options.length,
    });
    return res.json(result);
  } catch (error) {
    recordPlannerOperation({
      operation: 'swap_suggestions',
      outcome: 'error',
      durationMs: elapsedMs(startedAt),
      inputItems: Array.isArray(req.body?.mealContext?.currentItems)
        ? req.body.mealContext.currentItems.length
        : 0,
    });
    return next(error);
  }
}

module.exports = {
  health,
  getFoodsHandler,
  getPreferences,
  generatePlanHandler,
  timelineEventHandler,
  rebalanceMealHandler,
  swapSuggestionsHandler,
};
