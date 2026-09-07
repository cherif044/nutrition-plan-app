const { getPreferenceOptions } = require('../config/preferenceTaxonomy');
const {
  generatePlan,
  getFoods,
  rebalanceMeal,
  getProduceSwapOptions,
} = require('../services/planGenerator');
const { logger } = require('../utils/logger');

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

function generatePlanHandler(req, res, next) {
  const generatorTraceEvents = [];
  try {
    const timelineId = timelineIdFromRequest(req);
    const generationStartedAt = process.hrtime.bigint();
    const plan = generatePlan(req.body, {
      requestId: req.id,
      timelineId,
      traceEvents: generatorTraceEvents,
    });
    recordMetric(req, 'planGenerationMs', elapsedMs(generationStartedAt));
    logGeneratorTraceEvents(generatorTraceEvents);

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
  try {
    const { mealTarget, items, mealBounds, dailyContext, action, changedItemIndex } = req.body;
    if (!mealTarget || !Array.isArray(items)) {
      return res.status(400).json({ error: 'mealTarget and items are required.' });
    }
    if (!dailyContext) {
      return res.status(400).json({
        error: 'dailyContext is required to enforce the per-meal calorie, protein, and fat ranges.',
      });
    }

    return res.json(rebalanceMeal({
      mealTarget,
      items,
      mealBounds,
      dailyContext,
      action,
      changedItemIndex,
    }));
  } catch (error) {
    return next(error);
  }
}

function produceSwapOptionsHandler(req, res, next) {
  try {
    const {
      itemIndex,
      currentItems,
      mealTarget,
      dailyContext,
      userPreferences,
      limit,
    } = req.body;

    return res.json(getProduceSwapOptions({
      itemIndex,
      currentItems,
      mealTarget,
      dailyContext,
      userPreferences,
      limit,
    }));
  } catch (error) {
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
  produceSwapOptionsHandler,
};
