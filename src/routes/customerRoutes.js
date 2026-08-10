const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  listCustomersHandler,
  matchCustomerHandler,
  getCustomerPlansHandler,
  deleteCustomerHandler,
} = require('../controllers/customerController');

const router = express.Router();

router.get('/', requireAuth, listCustomersHandler);
router.get('/match', requireAuth, matchCustomerHandler);
router.get('/:id/plans', requireAuth, getCustomerPlansHandler);
router.delete('/:id', requireAuth, deleteCustomerHandler);

module.exports = router;
