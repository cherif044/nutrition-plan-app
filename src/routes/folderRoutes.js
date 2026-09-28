const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { validateBody, validateIdParam } = require('../middleware/validate');
const { createPlanBody, folderBody } = require('../validation/schemas');
const {
  getTree,
  getRootContentsHandler,
  createFolderHandler,
  getBreadcrumbHandler,
  getFolderContentsHandler,
  renameFolderHandler,
  deleteFolderHandler,
  savePlanInFolder,
} = require('../controllers/folderController');

const router = express.Router();

router.param('id', validateIdParam);
router.get('/tree', requireAuth, getTree);
router.get('/', requireAuth, getRootContentsHandler);
router.post('/', requireAuth, validateBody(folderBody), createFolderHandler);
router.get('/:id/breadcrumb', requireAuth, getBreadcrumbHandler);
router.get('/:id', requireAuth, getFolderContentsHandler);
router.patch('/:id', requireAuth, validateBody(folderBody.pick({ name: true })), renameFolderHandler);
router.delete('/:id', requireAuth, deleteFolderHandler);
router.post('/:id/plans', requireAuth, validateBody(createPlanBody), savePlanInFolder);

module.exports = router;
