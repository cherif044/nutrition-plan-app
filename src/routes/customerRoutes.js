const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { validateBody, validateIdParam, validateQuery } = require('../middleware/validate');
const {
  customerBody, customerMatchQuery, customersListQuery, pagedListQuery,
} = require('../validation/schemas');
const {
  listCustomersHandler,
  matchCustomerHandler,
  createCustomerHandler,
  getCustomerHandler,
  updateCustomerHandler,
  getCustomerPlansHandler,
  deleteCustomerHandler,
} = require('../controllers/customerController');

const router = express.Router();

router.param('id', validateIdParam);
router.get('/', requireAuth, validateQuery(customersListQuery), listCustomersHandler);
router.post('/', requireAuth, validateBody(customerBody), createCustomerHandler);
router.get('/match', requireAuth, validateQuery(customerMatchQuery), matchCustomerHandler);
router.get('/:id/plans', requireAuth, validateQuery(pagedListQuery), getCustomerPlansHandler);
router.get('/:id', requireAuth, getCustomerHandler);
router.put('/:id', requireAuth, validateBody(customerBody), updateCustomerHandler);
router.delete('/:id', requireAuth, deleteCustomerHandler);

module.exports = router;
