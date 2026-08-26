const { QueryTypes } = require('sequelize');
const sequelize = require('../config/database');

const DEFAULT_DASHBOARD_LIMIT = 50;
const MAX_DASHBOARD_LIMIT = 100;

function normalizeSearch(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeLimit(value) {
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_DASHBOARD_LIMIT;
  return Math.min(Math.floor(limit), MAX_DASHBOARD_LIMIT);
}

function folderPathFor(folderId, foldersById) {
  if (!folderId) return [];

  const path = [];
  const seen = new Set();
  let current = foldersById.get(String(folderId));

  while (current && !seen.has(String(current.id))) {
    seen.add(String(current.id));
    path.unshift({ id: current.id, name: current.name });
    current = current.parent_id ? foldersById.get(String(current.parent_id)) : null;
  }

  return path;
}

function folderPathFromArrays(ids = [], names = []) {
  return ids.map((id, index) => ({ id, name: names[index] })).filter((item) => item.id && item.name);
}

function planRowToSummary(row) {
  return {
    id: row.id,
    folder_id: row.folder_id,
    customer_id: row.customer_id,
    name: row.name,
    is_active: row.is_active,
    last_opened_at: row.last_opened_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    folderPath: folderPathFromArrays(row.folder_path_ids, row.folder_path_names),
    status: row.status || row.diagnostic_status || null,
    goal: row.goal || null,
    dietType: row.diet_type || null,
  };
}

function customerRowToSummary(row) {
  return {
    id: row.id,
    name: row.name,
    age: row.age,
    sex: row.sex,
    weight: row.weight,
    height: row.height,
    activity_level: row.activity_level,
    goal: row.goal,
    created_at: row.created_at,
    updated_at: row.updated_at,
    planCount: Number(row.plan_count || 0),
    activePlan: row.active_plan_id
      ? { id: row.active_plan_id, name: row.active_plan_name }
      : null,
  };
}

async function getStats(userId) {
  const [row] = await sequelize.query(`
    SELECT
      COUNT(*)::int AS "totalPlans",
      COUNT(*) FILTER (WHERE is_active = TRUE)::int AS "activePlans",
      (SELECT COUNT(*)::int FROM customers WHERE user_id = :userId) AS customers
    FROM plans
    WHERE user_id = :userId
  `, {
    replacements: { userId },
    type: QueryTypes.SELECT,
  });

  return {
    totalPlans: Number(row?.totalPlans || 0),
    customers: Number(row?.customers || 0),
    activePlans: Number(row?.activePlans || 0),
  };
}

async function listDashboardCustomers(userId, { query = '', limit = DEFAULT_DASHBOARD_LIMIT } = {}) {
  const normalized = normalizeSearch(query);
  const rows = await sequelize.query(`
    WITH matching_customers AS (
      SELECT id, name, age, sex, weight, height, activity_level, goal, created_at, updated_at
      FROM customers
      WHERE user_id = :userId
        AND (:query = '' OR lower(btrim(name)) LIKE :likeQuery)
      ORDER BY name ASC, id ASC
      LIMIT :limit
    ),
    plan_counts AS (
      SELECT customer_id, COUNT(*)::int AS plan_count
      FROM plans
      WHERE user_id = :userId
        AND customer_id IN (SELECT id FROM matching_customers)
      GROUP BY customer_id
    ),
    active_plans AS (
      SELECT DISTINCT ON (customer_id)
        customer_id,
        id AS active_plan_id,
        name AS active_plan_name
      FROM plans
      WHERE user_id = :userId
        AND is_active = TRUE
        AND customer_id IN (SELECT id FROM matching_customers)
      ORDER BY customer_id, updated_at DESC, created_at DESC, id DESC
    )
    SELECT
      c.*,
      COALESCE(pc.plan_count, 0) AS plan_count,
      ap.active_plan_id,
      ap.active_plan_name
    FROM matching_customers c
    LEFT JOIN plan_counts pc ON pc.customer_id = c.id
    LEFT JOIN active_plans ap ON ap.customer_id = c.id
    ORDER BY c.name ASC, c.id ASC
  `, {
    replacements: {
      userId,
      query: normalized,
      likeQuery: `%${normalized}%`,
      limit: normalizeLimit(limit),
    },
    type: QueryTypes.SELECT,
  });

  return rows.map(customerRowToSummary);
}

async function listGeneralPlans(userId, { query = '', limit = DEFAULT_DASHBOARD_LIMIT } = {}) {
  const normalized = normalizeSearch(query);
  const rows = await sequelize.query(`
    WITH RECURSIVE folder_paths AS (
      SELECT
        id,
        parent_id,
        ARRAY[id::text] AS folder_path_ids,
        ARRAY[name::text] AS folder_path_names
      FROM folders
      WHERE user_id = :userId
        AND parent_id IS NULL

      UNION ALL

      SELECT
        f.id,
        f.parent_id,
        fp.folder_path_ids || f.id::text,
        fp.folder_path_names || f.name::text
      FROM folders f
      JOIN folder_paths fp ON fp.id = f.parent_id
      WHERE f.user_id = :userId
    )
    SELECT
      p.id,
      p.folder_id,
      p.customer_id,
      p.name,
      p.is_active,
      p.last_opened_at,
      p.created_at,
      p.updated_at,
      p.plan_data->>'status' AS status,
      p.plan_data#>>'{diagnostics,status}' AS diagnostic_status,
      p.plan_data#>>'{input,goal}' AS goal,
      p.plan_data#>>'{input,dietType}' AS diet_type,
      COALESCE(fp.folder_path_ids, ARRAY[]::text[]) AS folder_path_ids,
      COALESCE(fp.folder_path_names, ARRAY[]::text[]) AS folder_path_names
    FROM plans p
    LEFT JOIN folder_paths fp ON fp.id = p.folder_id
    WHERE p.user_id = :userId
      AND p.customer_id IS NULL
      AND (
        :query = ''
        OR lower(p.name) LIKE :likeQuery
        OR lower(array_to_string(COALESCE(fp.folder_path_names, ARRAY[]::text[]), ' ')) LIKE :likeQuery
      )
    ORDER BY p.updated_at DESC, p.created_at DESC, p.id DESC
    LIMIT :limit
  `, {
    replacements: {
      userId,
      query: normalized,
      likeQuery: `%${normalized}%`,
      limit: normalizeLimit(limit),
    },
    type: QueryTypes.SELECT,
  });

  return rows.map(planRowToSummary);
}

async function listRecentPlans(userId) {
  const rows = await sequelize.query(`
    WITH RECURSIVE folder_paths AS (
      SELECT
        id,
        parent_id,
        ARRAY[id::text] AS folder_path_ids,
        ARRAY[name::text] AS folder_path_names
      FROM folders
      WHERE user_id = :userId
        AND parent_id IS NULL

      UNION ALL

      SELECT
        f.id,
        f.parent_id,
        fp.folder_path_ids || f.id::text,
        fp.folder_path_names || f.name::text
      FROM folders f
      JOIN folder_paths fp ON fp.id = f.parent_id
      WHERE f.user_id = :userId
    )
    SELECT
      p.id,
      p.folder_id,
      p.customer_id,
      p.name,
      p.is_active,
      p.last_opened_at,
      p.created_at,
      p.updated_at,
      p.plan_data->>'status' AS status,
      p.plan_data#>>'{diagnostics,status}' AS diagnostic_status,
      p.plan_data#>>'{input,goal}' AS goal,
      p.plan_data#>>'{input,dietType}' AS diet_type,
      COALESCE(fp.folder_path_ids, ARRAY[]::text[]) AS folder_path_ids,
      COALESCE(fp.folder_path_names, ARRAY[]::text[]) AS folder_path_names
    FROM plans p
    LEFT JOIN folder_paths fp ON fp.id = p.folder_id
    WHERE p.user_id = :userId
      AND p.last_opened_at IS NOT NULL
    ORDER BY p.last_opened_at DESC, p.id DESC
    LIMIT 3
  `, {
    replacements: { userId },
    type: QueryTypes.SELECT,
  });

  return rows.map(planRowToSummary);
}

async function getDashboardSummary(userId, options = {}) {
  const limit = normalizeLimit(options.limit);
  const [stats, customers, generalPlans, recentPlans] = await Promise.all([
    getStats(userId),
    listDashboardCustomers(userId, { query: options.customerQuery, limit }),
    listGeneralPlans(userId, { query: options.generalQuery, limit }),
    listRecentPlans(userId),
  ]);

  return {
    stats,
    recentPlans,
    generalPlans,
    customers,
    limits: {
      customers: limit,
      generalPlans: limit,
    },
  };
}

module.exports = {
  folderPathFor,
  getDashboardSummary,
  listDashboardCustomers,
  listGeneralPlans,
};
