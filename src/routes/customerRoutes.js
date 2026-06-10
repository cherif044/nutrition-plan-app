const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  listCustomers,
  createCustomerHandler,
  getCustomer,
  deleteCustomerHandler,
  listCustomerPlans,
  createCustomerPlan,
  getCustomerPlan,
  deleteCustomerPlan,
} = require('../controllers/customerController');

const router = express.Router();

router.get('/', requireAuth, listCustomers);
router.post('/', requireAuth, createCustomerHandler);
router.get('/:customerId', requireAuth, getCustomer);
router.delete('/:customerId', requireAuth, deleteCustomerHandler);
router.get('/:customerId/plans', requireAuth, listCustomerPlans);
router.post('/:customerId/plans', requireAuth, createCustomerPlan);
router.get('/:customerId/plans/:planId', requireAuth, getCustomerPlan);
router.delete('/:customerId/plans/:planId', requireAuth, deleteCustomerPlan);

module.exports = router;
