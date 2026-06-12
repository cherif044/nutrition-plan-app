const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  health,
  getFoodsHandler,
  getPreferences,
  generatePlanHandler,
  rebalanceMealHandler,
  checkSwapHandler,
  autoBalanceMealHandler,
  computeSensitivityHandler,
} = require('../controllers/generationController');

const router = express.Router();

router.get('/health', health);
router.get('/foods', getFoodsHandler);
router.get('/preferences', getPreferences);
router.post('/generate-plan', requireAuth, generatePlanHandler);
router.post('/rebalance-meal', requireAuth, rebalanceMealHandler);
router.post('/check-swap', requireAuth, checkSwapHandler);
router.post('/auto-balance-meal', requireAuth, autoBalanceMealHandler);
router.post('/compute-sensitivity', requireAuth, computeSensitivityHandler);

module.exports = router;
