const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  createPlanHandler,
  getPlan,
  exportPlanPdfHandler,
  updatePlanHandler,
  deletePlanHandler,
  duplicatePlanHandler,
} = require('../controllers/planController');

const router = express.Router();

router.post('/', requireAuth, createPlanHandler);
router.get('/:id/export.pdf', requireAuth, exportPlanPdfHandler);
router.get('/:id', requireAuth, getPlan);
router.put('/:id', requireAuth, updatePlanHandler);
router.delete('/:id', requireAuth, deletePlanHandler);
router.post('/:id/duplicate', requireAuth, duplicatePlanHandler);

module.exports = router;
