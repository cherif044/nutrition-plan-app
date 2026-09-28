const { QueryTypes } = require('sequelize');
const sequelize = require('../config/database');
const { Folder, Plan } = require('../models');
const { INPUT_LIMITS } = require('../config/inputLimits');
const { assertCanAddFolder } = require('./accountQuotas');

// Listings are bounded by the account quotas; the explicit limits keep them
// bounded even if a quota is raised later.
const MAX_LISTED_FOLDERS = INPUT_LIMITS.account.folders;
const MAX_LISTED_PLANS = INPUT_LIMITS.account.plans;

async function createFolder(userId, { name, parentId = null }) {
  return sequelize.transaction(async (transaction) => {
    if (parentId !== null) {
      const parent = await Folder.findOne({ where: { id: parentId, user_id: userId }, transaction });
      if (!parent) throw Object.assign(new Error('Parent folder not found.'), { status: 404 });
    }
    await assertCanAddFolder(userId, parentId, transaction);
    return Folder.create({ user_id: userId, parent_id: parentId || null, name: name.trim() }, { transaction });
  });
}

async function getFolderById(folderId, userId) {
  return Folder.findOne({ where: { id: folderId, user_id: userId } });
}

async function getRootContents(userId) {
  const [subfolders, plans] = await Promise.all([
    Folder.findAll({
      where: { parent_id: null, user_id: userId },
      order: [['name', 'ASC']],
      limit: MAX_LISTED_FOLDERS,
    }),
    Plan.findAll({
      where: { user_id: userId, folder_id: null },
      attributes: ['id', 'folder_id', 'customer_id', 'name', 'created_at', 'updated_at'],
      order: [['created_at', 'DESC']],
      limit: MAX_LISTED_PLANS,
    }),
  ]);
  return { folder: null, subfolders, plans };
}

async function getFolderContents(folderId, userId) {
  const folder = await getFolderById(folderId, userId);
  if (!folder) return null;

  const [subfolders, plans] = await Promise.all([
    Folder.findAll({
      where: { parent_id: folderId, user_id: userId },
      order: [['name', 'ASC']],
      limit: MAX_LISTED_FOLDERS,
    }),
    Plan.findAll({
      where: { user_id: userId, folder_id: folderId },
      attributes: ['id', 'folder_id', 'customer_id', 'name', 'created_at', 'updated_at'],
      order: [['created_at', 'DESC']],
      limit: MAX_LISTED_PLANS,
    }),
  ]);

  return { folder, subfolders, plans };
}

// One query for the whole path, stopped at the maximum nesting depth.
async function getBreadcrumb(folderId, userId) {
  const rows = await sequelize.query(`
    WITH RECURSIVE chain AS (
      SELECT id, name, parent_id, 1 AS depth FROM folders WHERE id = :folderId AND user_id = :userId
      UNION ALL
      SELECT f.id, f.name, f.parent_id, c.depth + 1
      FROM folders f JOIN chain c ON f.id = c.parent_id
      WHERE f.user_id = :userId AND c.depth < :maxDepth
    )
    SELECT id, name FROM chain ORDER BY depth DESC
  `, {
    replacements: { folderId, userId, maxDepth: INPUT_LIMITS.account.folderDepth + 1 },
    type: QueryTypes.SELECT,
  });
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

async function getFolderTree(userId) {
  const folders = await Folder.findAll({
    where: { user_id: userId },
    attributes: ['id', 'name', 'parent_id'],
    order: [['name', 'ASC']],
    limit: MAX_LISTED_FOLDERS,
  });
  return buildTree(folders.map((f) => f.toJSON()), null);
}

function buildTree(folders, parentId) {
  return folders
    .filter((f) => f.parent_id === parentId)
    .map((f) => ({ id: f.id, name: f.name, children: buildTree(folders, f.id) }));
}

async function renameFolder(folderId, userId, name) {
  const [count] = await Folder.update({ name: name.trim() }, { where: { id: folderId, user_id: userId } });
  return count > 0;
}

async function deleteFolder(folderId, userId) {
  const count = await Folder.destroy({ where: { id: folderId, user_id: userId } });
  return count > 0;
}

module.exports = {
  createFolder,
  getFolderById,
  getRootContents,
  getFolderContents,
  getBreadcrumb,
  getFolderTree,
  renameFolder,
  deleteFolder,
};
