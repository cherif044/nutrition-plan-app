const { Folder, Plan } = require('../models');

async function createFolder(userId, { name, parentId = null }) {
  if (parentId !== null) {
    const parent = await Folder.findOne({ where: { id: parentId, user_id: userId } });
    if (!parent) throw Object.assign(new Error('Parent folder not found.'), { status: 404 });
  }
  return Folder.create({ user_id: userId, parent_id: parentId || null, name: name.trim() });
}

async function getFolderById(folderId, userId) {
  return Folder.findOne({ where: { id: folderId, user_id: userId } });
}

async function getRootContents(userId) {
  const [subfolders, plans] = await Promise.all([
    Folder.findAll({
      where: { parent_id: null, user_id: userId },
      order: [['name', 'ASC']],
    }),
    Plan.findAll({
      where: { user_id: userId, folder_id: null },
      attributes: ['id', 'folder_id', 'name', 'created_at', 'updated_at'],
      order: [['created_at', 'DESC']],
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
    }),
    Plan.findAll({
      where: { user_id: userId, folder_id: folderId },
      attributes: ['id', 'folder_id', 'name', 'created_at', 'updated_at'],
      order: [['created_at', 'DESC']],
    }),
  ]);

  return { folder, subfolders, plans };
}

async function getBreadcrumb(folderId, userId) {
  const path = [];
  let currentId = folderId;
  while (currentId != null) {
    const folder = await Folder.findOne({
      where: { id: currentId, user_id: userId },
      attributes: ['id', 'name', 'parent_id'],
    });
    if (!folder) break;
    path.unshift({ id: folder.id, name: folder.name });
    currentId = folder.parent_id;
  }
  return path;
}

async function getFolderTree(userId) {
  const folders = await Folder.findAll({
    where: { user_id: userId },
    attributes: ['id', 'name', 'parent_id'],
    order: [['name', 'ASC']],
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
