const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { rebalanceBody, swapSuggestionsBody, timelineBody } = require('../validation/schemas');
const {
  health,
  getFoodsHandler,
  getPreferences,
  generatePlanHandler,
  timelineEventHandler,
  rebalanceMealHandler,
  swapSuggestionsHandler,
} = require('../controllers/generationController');

const router = express.Router();

router.get('/health', health);
router.get('/foods', getFoodsHandler);
router.get('/preferences', getPreferences);
router.post('/generate-plan', requireAuth, generatePlanHandler);
router.post('/generation-timeline', requireAuth, validateBody(timelineBody), timelineEventHandler);
router.post('/rebalance-meal', requireAuth, validateBody(rebalanceBody), rebalanceMealHandler);
router.post('/swap-suggestions', requireAuth, validateBody(swapSuggestionsBody), swapSuggestionsHandler);

module.exports = router;
