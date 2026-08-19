const { getPreferenceOptions } = require('../config/preferenceTaxonomy');
const {
  generatePlan,
  getFoods,
  rebalanceMeal,
  getProduceSwapOptions,
} = require('../services/planGenerator');

function health(_req, res) {
  res.json({ status: 'ok' });
}

function getFoodsHandler(_req, res, next) {
  try {
    res.json({ foods: getFoods() });
  } catch (error) {
    next(error);
  }
}

function getPreferences(_req, res, next) {
  try {
    res.json(getPreferenceOptions(getFoods()));
  } catch (error) {
    next(error);
  }
}

function generatePlanHandler(req, res, next) {
  try {
    res.json(generatePlan(req.body));
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
  rebalanceMealHandler,
  produceSwapOptionsHandler,
};
