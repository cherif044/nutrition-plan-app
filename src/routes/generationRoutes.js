const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
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
} = require('../controllers/generationController');

const router = express.Router();

router.get('/health', health);
router.get('/foods', getFoodsHandler);
router.get('/preferences', getPreferences);
router.post('/generate-plan', requireAuth, generatePlanHandler);
router.post('/generate-plan-freeform', requireAuth, generatePlanFreeformHandler);
router.post('/rebalance-meal', requireAuth, rebalanceMealHandler);
router.post('/meal-options', requireAuth, mealOptionsHandler);
router.post('/produce-swap-options', requireAuth, produceSwapOptionsHandler);
router.post('/meal-chat', requireAuth, mealChatHandler);
router.post('/guided-meal-suggestion', requireAuth, guidedMealSuggestionHandler);

module.exports = router;
