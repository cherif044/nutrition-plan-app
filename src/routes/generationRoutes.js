const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  health,
  getFoodsHandler,
  getPreferences,
  generatePlanHandler,
  rebalanceMealHandler,
  produceSwapOptionsHandler,
} = require('../controllers/generationController');

const router = express.Router();

router.get('/health', health);
router.get('/foods', getFoodsHandler);
router.get('/preferences', getPreferences);
router.post('/generate-plan', requireAuth, generatePlanHandler);
router.post('/rebalance-meal', requireAuth, rebalanceMealHandler);
router.post('/produce-swap-options', requireAuth, produceSwapOptionsHandler);

module.exports = router;
