const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { validateBody, validateIdParam, validateQuery } = require('../../middleware/validate');
const {
  createPlanBody, pdfExportQuery, updatePlanBody,
} = require('../../validation/schemas');
const {
  createPlanHandler,
  getPlan,
  markPlanOpenedHandler,
  exportPlanPdfHandler,
  updatePlanHandler,
  deletePlanHandler,
} = require('./controller');

const router = express.Router();

router.param('id', validateIdParam);
router.post('/', requireAuth, validateBody(createPlanBody), createPlanHandler);
router.get('/:id/export.pdf', requireAuth, validateQuery(pdfExportQuery), exportPlanPdfHandler);
router.get('/:id', requireAuth, getPlan);
router.post('/:id/opened', requireAuth, markPlanOpenedHandler);
router.put('/:id', requireAuth, validateBody(updatePlanBody), updatePlanHandler);
router.delete('/:id', requireAuth, deletePlanHandler);

module.exports = router;
