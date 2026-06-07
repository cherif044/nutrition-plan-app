const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  createFolder,
  getFolderById,
  getRootContents,
  getFolderContents,
  getBreadcrumb,
  getFolderTree,
  renameFolder,
  deleteFolder,
} = require('../models/Folder');
const { createPlan } = require('../models/Plan');

const router = express.Router();

// ── Folder tree (for duplicate picker) ───────────────────────────────────────

router.get('/tree', requireAuth, async (req, res, next) => {
  try {
    const tree = await getFolderTree(req.user.id);
    res.json({ tree });
  } catch (err) { next(err); }
});

// ── Root contents ─────────────────────────────────────────────────────────────

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const contents = await getRootContents(req.user.id);
    res.json(contents);
  } catch (err) { next(err); }
});

// ── Create folder ─────────────────────────────────────────────────────────────

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { name, parentId } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Folder name is required.' });
    const folder = await createFolder(req.user.id, { name, parentId: parentId || null });
    res.status(201).json({ folder });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ── Get folder breadcrumb ─────────────────────────────────────────────────────

router.get('/:id/breadcrumb', requireAuth, async (req, res, next) => {
  try {
    const crumbs = await getBreadcrumb(req.params.id, req.user.id);
    if (!crumbs.length) return res.status(404).json({ error: 'Folder not found.' });
    res.json({ breadcrumb: crumbs });
  } catch (err) { next(err); }
});

// ── Get folder contents ───────────────────────────────────────────────────────

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const contents = await getFolderContents(req.params.id, req.user.id);
    if (!contents) return res.status(404).json({ error: 'Folder not found.' });
    res.json(contents);
  } catch (err) { next(err); }
});

// ── Rename folder ─────────────────────────────────────────────────────────────

router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Folder name is required.' });
    const ok = await renameFolder(req.params.id, req.user.id, name);
    if (!ok) return res.status(404).json({ error: 'Folder not found.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Delete folder ─────────────────────────────────────────────────────────────

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const ok = await deleteFolder(req.params.id, req.user.id);
    if (!ok) return res.status(404).json({ error: 'Folder not found.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Save plan in folder ───────────────────────────────────────────────────────

router.post('/:id/plans', requireAuth, async (req, res, next) => {
  try {
    const folder = await getFolderById(req.params.id, req.user.id);
    if (!folder) return res.status(404).json({ error: 'Folder not found.' });

    const { name, planData } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Plan name is required.' });
    if (!planData) return res.status(400).json({ error: 'planData is required.' });

    const plan = await createPlan(folder.id, name, planData);
    res.status(201).json({ plan });
  } catch (err) { next(err); }
});

module.exports = router;
