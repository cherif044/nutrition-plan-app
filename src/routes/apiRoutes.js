const express = require('express');

const { getPreferenceOptions } = require('../config/preferenceTaxonomy');
const { generatePlan, getFoods } = require('../services/planGenerator');

const router = express.Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

router.get('/foods', (_req, res, next) => {
  try {
    res.json({ foods: getFoods() });
  } catch (error) {
    next(error);
  }
});

router.get('/preferences', (_req, res, next) => {
  try {
    res.json(getPreferenceOptions(getFoods()));
  } catch (error) {
    next(error);
  }
});

router.post('/generate-plan', (req, res, next) => {
  try {
    res.json(generatePlan(req.body));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
