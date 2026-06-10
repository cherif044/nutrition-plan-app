const express = require('express');
const { requireAuth } = require('../middleware/auth');
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

router.get('/tree', requireAuth, getTree);
router.get('/', requireAuth, getRootContentsHandler);
router.post('/', requireAuth, createFolderHandler);
router.get('/:id/breadcrumb', requireAuth, getBreadcrumbHandler);
router.get('/:id', requireAuth, getFolderContentsHandler);
router.patch('/:id', requireAuth, renameFolderHandler);
router.delete('/:id', requireAuth, deleteFolderHandler);
router.post('/:id/plans', requireAuth, savePlanInFolder);

module.exports = router;
