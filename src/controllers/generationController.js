const { getPreferenceOptions } = require('../config/preferenceTaxonomy');
const {
  generatePlan,
  generatePlanFreeform,
  getFoods,
  rebalanceMeal,
  getProduceSwapOptions,
  generateAlternateMealOptions,
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

function generatePlanFreeformHandler(req, res, next) {
  try {
    res.json(generatePlanFreeform(req.body));
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

function mealOptionsHandler(req, res, next) {
  try {
    const {
      mealTag,
      mealTarget,
      currentItems,
      templateId,
      userPreferences,
      dailyContext,
      limit,
    } = req.body;

    if (!mealTarget || !Array.isArray(currentItems) || !dailyContext) {
      return res.status(400).json({
        error: 'mealTarget, currentItems, and dailyContext are required.',
      });
    }

    return res.json({
      mealOptions: generateAlternateMealOptions({
        mealTag,
        mealTarget,
        currentItems,
        templateId,
        userPreferences,
        dailyContext,
        limit,
      }),
    });
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

function mealChatHandler(_req, res) {
  return res.status(410).json({
    error: 'meal-chat is disabled. Meal changes must use deterministic range-checked endpoints.',
  });
}

function guidedMealSuggestionHandler(_req, res) {
  return res.status(410).json({
    error: 'guided-meal-suggestion is disabled. Meal changes must use deterministic range-checked endpoints.',
  });
}

module.exports = {
  health,
  getFoodsHandler,
  getPreferences,
  generatePlanHandler,
  generatePlanFreeformHandler,
  rebalanceMealHandler,
  mealOptionsHandler,
  produceSwapOptionsHandler,
  mealChatHandler,
  guidedMealSuggestionHandler,
};
