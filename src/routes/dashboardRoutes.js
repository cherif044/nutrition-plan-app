const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getDashboard } = require('../controllers/dashboardController');

const router = express.Router();

router.get('/', requireAuth, getDashboard);

module.exports = router;
