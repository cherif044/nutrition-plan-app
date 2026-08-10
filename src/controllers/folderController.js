const {
  createFolder,
  getFolderById,
  getRootContents,
  getFolderContents,
  getBreadcrumb,
  getFolderTree,
  renameFolder,
  deleteFolder,
} = require('../repositories/folderRepository');
const { createPlan } = require('../repositories/planRepository');

async function getTree(req, res, next) {
  try {
    const tree = await getFolderTree(req.user.id);
    res.json({ tree });
  } catch (err) { next(err); }
}

async function getRootContentsHandler(req, res, next) {
  try {
    const contents = await getRootContents(req.user.id);
    res.json(contents);
  } catch (err) { next(err); }
}

async function createFolderHandler(req, res, next) {
  try {
    const { name, parentId } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Folder name is required.' });
    const folder = await createFolder(req.user.id, { name, parentId: parentId || null });
    res.status(201).json({ folder });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

async function getBreadcrumbHandler(req, res, next) {
  try {
    const crumbs = await getBreadcrumb(req.params.id, req.user.id);
    if (!crumbs.length) return res.status(404).json({ error: 'Folder not found.' });
    res.json({ breadcrumb: crumbs });
  } catch (err) { next(err); }
}

async function getFolderContentsHandler(req, res, next) {
  try {
    const contents = await getFolderContents(req.params.id, req.user.id);
    if (!contents) return res.status(404).json({ error: 'Folder not found.' });
    res.json(contents);
  } catch (err) { next(err); }
}

async function renameFolderHandler(req, res, next) {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Folder name is required.' });
    const ok = await renameFolder(req.params.id, req.user.id, name);
    if (!ok) return res.status(404).json({ error: 'Folder not found.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function deleteFolderHandler(req, res, next) {
  try {
    const ok = await deleteFolder(req.params.id, req.user.id);
    if (!ok) return res.status(404).json({ error: 'Folder not found.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function savePlanInFolder(req, res, next) {
  try {
    const folder = await getFolderById(req.params.id, req.user.id);
    if (!folder) return res.status(404).json({ error: 'Folder not found.' });

    const { name, planData, customer = null, isActive = false } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Plan name is required.' });
    if (!planData) return res.status(400).json({ error: 'planData is required.' });

    const plan = await createPlan(req.user.id, folder.id, name, planData, { customer, isActive });
    res.status(201).json({ plan });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

module.exports = {
  getTree,
  getRootContentsHandler,
  createFolderHandler,
  getBreadcrumbHandler,
  getFolderContentsHandler,
  renameFolderHandler,
  deleteFolderHandler,
  savePlanInFolder,
};
