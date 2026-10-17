const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { validateBody } = require('../../middleware/validate');
const { customFoodCreateLimiter } = require('../../middleware/rateLimits');
const { customFoodBody } = require('../../validation/schemas');
const { createCustomFoodHandler, listCustomFoodsHandler } = require('./controller');

const router = express.Router();

router.get('/', requireAuth, listCustomFoodsHandler);
// Authenticated first, so the create limit is counted per account.
router.post('/', requireAuth, customFoodCreateLimiter, validateBody(customFoodBody), createCustomFoodHandler);

module.exports = router;
