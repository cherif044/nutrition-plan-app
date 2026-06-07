const { pool } = require('../config/db');

async function createFolder(userId, { name, parentId = null }) {
  if (parentId !== null) {
    const parent = await getFolderById(parentId, userId);
    if (!parent) throw Object.assign(new Error('Parent folder not found.'), { status: 404 });
  }
  const { rows } = await pool.query(
    `INSERT INTO folders (user_id, parent_id, name)
     VALUES ($1, $2, $3)
     RETURNING id, user_id, parent_id, name, created_at`,
    [userId, parentId || null, name.trim()],
  );
  return rows[0];
}

async function getFolderById(folderId, userId) {
  const { rows } = await pool.query(
    `SELECT id, user_id, parent_id, name, created_at
     FROM folders WHERE id = $1 AND user_id = $2`,
    [folderId, userId],
  );
  return rows[0] || null;
}

async function getRootContents(userId) {
  const { rows } = await pool.query(
    `SELECT id, name, parent_id, created_at
     FROM folders WHERE parent_id IS NULL AND user_id = $1 ORDER BY name`,
    [userId],
  );
  return { folder: null, subfolders: rows, plans: [] };
}

async function getFolderContents(folderId, userId) {
  const folder = await getFolderById(folderId, userId);
  if (!folder) return null;

  const [foldersResult, plansResult] = await Promise.all([
    pool.query(
      `SELECT id, name, parent_id, created_at
       FROM folders WHERE parent_id = $1 AND user_id = $2 ORDER BY name`,
      [folderId, userId],
    ),
    pool.query(
      `SELECT id, name, created_at, updated_at
       FROM plans WHERE folder_id = $1 ORDER BY created_at DESC`,
      [folderId],
    ),
  ]);

  return { folder, subfolders: foldersResult.rows, plans: plansResult.rows };
}

async function getBreadcrumb(folderId, userId) {
  const { rows } = await pool.query(
    `WITH RECURSIVE path AS (
       SELECT id, name, parent_id, 0 AS depth
       FROM folders WHERE id = $1 AND user_id = $2
       UNION ALL
       SELECT f.id, f.name, f.parent_id, p.depth + 1
       FROM folders f JOIN path p ON f.id = p.parent_id
       WHERE f.user_id = $2
     )
     SELECT id, name FROM path ORDER BY depth DESC`,
    [folderId, userId],
  );
  return rows;
}

async function getFolderTree(userId) {
  const { rows } = await pool.query(
    `SELECT id, name, parent_id FROM folders WHERE user_id = $1 ORDER BY name`,
    [userId],
  );
  return buildTree(rows, null);
}

function buildTree(folders, parentId) {
  return folders
    .filter((f) => f.parent_id === parentId)
    .map((f) => ({ id: f.id, name: f.name, children: buildTree(folders, f.id) }));
}

async function renameFolder(folderId, userId, name) {
  const { rowCount } = await pool.query(
    `UPDATE folders SET name = $1 WHERE id = $2 AND user_id = $3`,
    [name.trim(), folderId, userId],
  );
  return rowCount > 0;
}

async function deleteFolder(folderId, userId) {
  const { rowCount } = await pool.query(
    `DELETE FROM folders WHERE id = $1 AND user_id = $2`,
    [folderId, userId],
  );
  return rowCount > 0;
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
