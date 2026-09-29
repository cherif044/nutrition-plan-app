const { getPreferenceOptions } = require('../../config/preferenceTaxonomy');
const {
  getFoods,
  rebalanceMeal,
} = require('./generator');
const { generatePlanInWorker } = require('./generationPool');
const { generationAdmission } = require('./generationAdmission');
const { getSwapSuggestions } = require('./swapService');
const { logger } = require('../../utils/logger');
const { INPUT_LIMITS } = require('../../config/inputLimits');
const {
  recordGenerationTraceEvents,
  recordPlannerOperation,
} = require('../../utils/metrics');

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
  return String(value).replace(/[^A-Za-z0-9-]/g, '').slice(0, 128);
}

function generationRequestIdFromRequest(req) {
  const value = req.get('x-plan-generation-request-id') || req.body?.generationRequestId || '';
  return String(value).replace(/[^A-Za-z0-9-]/g, '').slice(0, 128);
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

function health(_req, res) {
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
  let admission;
  try {
    const timelineId = timelineIdFromRequest(req);
    admission = await generationAdmission.acquire(req.user.id);
    if (admission.globalCount !== undefined) {
      req.metrics = req.metrics || {};
      req.metrics.generationGlobalInflight = admission.globalCount;
      req.metrics.generationAccountInflight = admission.accountCount;
    }
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
  } finally {
    if (admission) await admission.release();
  }
}

// Browser-reported timings are logged, so only known fields of the expected
// type are kept; anything else a client adds never reaches the logs.
const TIMELINE_NUMBER_FIELDS = [
  'validationMs', 'generateRoundTripMs', 'responseParseMs', 'renderMs', 'saveRoundTripMs', 'saveStatus', 'status',
];
const TIMELINE_TEXT_FIELDS = ['serverTiming', 'saveRequestId', 'planId', 'error'];

function sanitizedTimings(timings = {}) {
  const result = {};
  for (const key of TIMELINE_NUMBER_FIELDS) {
    const value = Number(timings[key]);
    if (timings[key] !== undefined && Number.isFinite(value)) result[key] = value;
  }
  for (const key of TIMELINE_TEXT_FIELDS) {
    if (timings[key] !== undefined && timings[key] !== null) result[key] = String(timings[key]).slice(0, 200);
  }
  return result;
}

function timelineEventHandler(req, res, next) {
  try {
    logger.info('Plan timeline: browser event', {
      requestId: req.id,
      timelineId: timelineIdFromRequest(req),
      generationRequestId: generationRequestIdFromRequest(req),
      event: req.body.event,
      elapsedMs: Number(req.body.elapsedMs),
      timings: sanitizedTimings(req.body.timings),
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
      deadlineAt: performance.now() + INPUT_LIMITS.rebalanceSearchMs,
    });
    if (result.searchLimited) {
      logger.warn('Rebalance search limit reached', {
        requestId: req.id,
        itemCount: items.length,
        action: action || null,
      });
    }
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
      foodId, userPreferences, limit, mealContext, cursor,
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
      foodId, userPreferences, limit, mealContext, cursor,
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
