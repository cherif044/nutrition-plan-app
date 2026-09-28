const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { validateQuery } = require('../../middleware/validate');
const { pagedListQuery, plansListQuery } = require('../../validation/schemas');
const {
  getDashboard,
  getDashboardCustomers,
  getDashboardPlans,
} = require('./controller');

const router = express.Router();

router.get('/', requireAuth, getDashboard);
router.get('/customers', requireAuth, validateQuery(pagedListQuery), getDashboardCustomers);
router.get('/plans', requireAuth, validateQuery(plansListQuery), getDashboardPlans);

module.exports = router;
