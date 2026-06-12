const { getPreferenceOptions } = require('../config/preferenceTaxonomy');
const { generatePlan, getFoods, rebalanceMeal, autoBalanceMeal, computeSensitivityMatrix, checkRebalanceFeasibility } = require('../services/planGenerator');
const { loadFoods } = require('../repositories/foodRepository');

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
    const { mealTarget, items, mealBounds } = req.body;
    if (!mealTarget || !Array.isArray(items)) {
      return res.status(400).json({ error: 'mealTarget and items are required.' });
    }
    res.json(rebalanceMeal({ mealTarget, items, mealBounds }));
  } catch (error) {
    next(error);
  }
}

function checkSwapHandler(req, res, next) {
  try {
    const { mealTarget, items, mealBounds } = req.body;
    if (!mealTarget || !Array.isArray(items)) {
      return res.status(400).json({ error: 'mealTarget and items are required.' });
    }
    res.json(checkRebalanceFeasibility({ mealTarget, items, mealBounds }));
  } catch (error) {
    next(error);
  }
}

function autoBalanceMealHandler(req, res, next) {
  try {
    const { items, originalItems, mealTag } = req.body;
    if (!Array.isArray(items) || !Array.isArray(originalItems)) {
      return res.status(400).json({ error: 'items and originalItems must be arrays.' });
    }
    res.json(autoBalanceMeal({ items, originalItems, mealTag }));
  } catch (error) {
    next(error);
  }
}

function computeSensitivityHandler(req, res, next) {
  try {
    const { mealTarget, items: rawItems } = req.body;
    if (!mealTarget || !Array.isArray(rawItems)) {
      return res.status(400).json({ error: 'mealTarget and items are required.' });
    }
    const foods = loadFoods();
    const foodMap = new Map(foods.map((f) => [f.id, f]));
    const items = rawItems.map((item) => {
      const food = foodMap.get(String(item.foodId));
      if (!food) throw new Error(`Unknown food id: ${item.foodId}`);
      return { food, quantityG: Number(item.quantityG) || food.defaultServingG };
    });
    res.json({ sensitivityMatrix: computeSensitivityMatrix(items, mealTarget) });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  health,
  getFoodsHandler,
  getPreferences,
  generatePlanHandler,
  rebalanceMealHandler,
  checkSwapHandler,
  autoBalanceMealHandler,
  computeSensitivityHandler,
};
