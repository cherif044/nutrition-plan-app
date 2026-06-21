const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  health,
  getFoodsHandler,
  getPreferences,
  generatePlanHandler,
  generatePlanFreeformHandler,
  rebalanceMealHandler,
  checkSwapHandler,
  autoBalanceMealHandler,
  computeSensitivityHandler,
  mealChatHandler,
  validateMealChangesHandler,
} = require('../controllers/generationController');

const router = express.Router();

router.get('/health', health);
router.get('/foods', getFoodsHandler);
router.get('/preferences', getPreferences);
router.post('/generate-plan', requireAuth, generatePlanHandler);
router.post('/generate-plan-freeform', requireAuth, generatePlanFreeformHandler);
router.post('/rebalance-meal', requireAuth, rebalanceMealHandler);
router.post('/check-swap', requireAuth, checkSwapHandler);
router.post('/auto-balance-meal', requireAuth, autoBalanceMealHandler);
router.post('/compute-sensitivity', requireAuth, computeSensitivityHandler);
router.post('/meal-chat', requireAuth, mealChatHandler);
router.post('/validate-meal-changes', requireAuth, validateMealChangesHandler);

module.exports = router;
