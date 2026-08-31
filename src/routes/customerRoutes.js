const express = require('express');
const { requireAuth } = require('../middleware/auth');
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

router.get('/', requireAuth, listCustomersHandler);
router.post('/', requireAuth, createCustomerHandler);
router.get('/match', requireAuth, matchCustomerHandler);
router.get('/:id/plans', requireAuth, getCustomerPlansHandler);
router.get('/:id', requireAuth, getCustomerHandler);
router.put('/:id', requireAuth, updateCustomerHandler);
router.delete('/:id', requireAuth, deleteCustomerHandler);

module.exports = router;
