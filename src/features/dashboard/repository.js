const { QueryTypes } = require('sequelize');
const { likePattern } = require('../../shared/likePattern');
const sequelize = require('../../config/database');

// Every list here is paginated and reads only plans' summary columns
// (goal, calories, macros, schedule), never plan_data, so the cost of a page
// stays flat no matter how many plans a coach has saved.

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;
const HOME_LIST_SIZE = 4;
const CALORIE_RANGE_SIZE = 200;
// A plan is "ending soon" in its last few days and "expired" once its end
// date arrives. public/js/shared/planStatus.js uses the same rule.
const ENDING_SOON_DAYS = 3;
// Home's "Expiring soon" list looks this many days ahead.
const EXPIRING_WINDOW_DAYS = 14;

// The end date is derived from the plan's schedule, never stored.
const PLAN_END_SQL = '(p.start_date + p.duration_weeks * 7)';
const PLAN_EXPIRED_SQL = `(CURRENT_DATE >= ${PLAN_END_SQL})`;
const PLAN_ACTIVE_SQL = `(CURRENT_DATE < ${PLAN_END_SQL})`;
const PLAN_ENDING_SOON_SQL = `(${PLAN_END_SQL} - CURRENT_DATE BETWEEN 1 AND ${ENDING_SOON_DAYS})`;
const SEX_FILTERS = new Set(['female', 'male', 'unset']);

function normalizeSearch(value) {
  return String(value || '').trim().toLowerCase().slice(0, 100);
}


function normalizePaging({ page, pageSize } = {}) {
  const size = Number(pageSize);
  const safeSize = Number.isInteger(size) && size > 0 ? Math.min(size, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  const pageNumber = Number(page);
  const safePage = Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1;
  return { page: safePage, pageSize: safeSize, offset: (safePage - 1) * safeSize };
}

function pageResult(items, total, { page, pageSize }) {
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

// "1800-2000" -> 1800; anything else means "no calorie filter".
function calorieRangeStart(value) {
  const match = /^(\d{1,5})-(\d{1,5})$/.exec(String(value || ''));
  if (!match) return null;
  const start = Number(match[1]);
  return start % CALORIE_RANGE_SIZE === 0 && Number(match[2]) === start + CALORIE_RANGE_SIZE ? start : null;
}

function toNumberOrNull(value) {
  const number = Number(value);
  return value !== null && value !== undefined && Number.isFinite(number) && number > 0 ? number : null;
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function planRowToSummary(row) {
  const summary = {
    id: row.id,
    customer_id: row.customer_id,
    name: row.name,
    last_opened_at: row.last_opened_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    goal: row.goal || null,
    calories: toNumberOrNull(row.calories),
    protein_g: toNumberOrNull(row.protein_g),
    carbs_g: toNumberOrNull(row.carbs_g),
    fat_g: toNumberOrNull(row.fat_g),
    start_date: dateOnly(row.start_date),
    duration_weeks: Number(row.duration_weeks) || null,
  };
  if (row.customer_name !== undefined) summary.customer_name = row.customer_name || null;
  return summary;
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
    created_at: row.created_at,
    updated_at: row.updated_at,
    planCount: Number(row.plan_count || 0),
  };
}

const PLAN_SUMMARY_COLUMNS = `
  p.id, p.customer_id, p.name, p.last_opened_at,
  p.created_at, p.updated_at, p.goal, p.calories,
  p.protein_g, p.carbs_g, p.fat_g, p.start_date, p.duration_weeks
`;

// Only the customer's name rides along with a home-list plan.
const PLAN_CUSTOMER_JOIN = `
  LEFT JOIN customers c ON c.id = p.customer_id AND c.user_id = p.user_id
`;

// Counts only; every number on the home page and the client folders comes
// from this one round trip.
async function getStats(userId) {
  const [row] = await sequelize.query(`
    SELECT
      (SELECT COUNT(*)::int FROM plans WHERE user_id = :userId) AS "totalPlans",
      (
        SELECT COUNT(*)::int FROM plans
        WHERE user_id = :userId AND created_at >= date_trunc('week', now())
      ) AS "plansThisWeek",
      (SELECT COUNT(*)::int FROM customers WHERE user_id = :userId) AS customers,
      (
        SELECT COUNT(*)::int FROM customers
        WHERE user_id = :userId AND created_at >= date_trunc('week', now())
      ) AS "customersThisWeek",
      (
        SELECT json_build_object(
          'onTrack', COUNT(*) FILTER (WHERE ${PLAN_ACTIVE_SQL} AND NOT ${PLAN_ENDING_SOON_SQL}),
          'endingSoon', COUNT(*) FILTER (WHERE ${PLAN_ENDING_SOON_SQL}),
          'expired', COUNT(*) FILTER (WHERE ${PLAN_EXPIRED_SQL})
        )
        FROM plans p WHERE p.user_id = :userId
      ) AS "planStatus",
      (
        SELECT COALESCE(json_agg(json_build_object('start', r.range_start, 'n', r.n)), '[]'::json)
        FROM (
          SELECT (floor(p.calories / ${CALORIE_RANGE_SIZE}) * ${CALORIE_RANGE_SIZE})::int AS range_start,
            COUNT(*)::int AS n
          FROM plans p
          WHERE p.user_id = :userId AND p.calories > 0 AND ${PLAN_ACTIVE_SQL}
          GROUP BY 1
          ORDER BY n DESC, range_start ASC
          LIMIT 3
        ) r
      ) AS "activeCalorieRanges",
      (
        SELECT COALESCE(json_agg(json_build_object('sex', g.sex, 'n', g.n, 'ongoing', g.ongoing)), '[]'::json)
        FROM (
          SELECT COALESCE(c.sex, 'unset') AS sex,
            COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM plans p
              WHERE p.user_id = :userId AND p.customer_id = c.id AND ${PLAN_ACTIVE_SQL}
            ))::int AS ongoing
          FROM customers c
          WHERE c.user_id = :userId
          GROUP BY 1
        ) g
      ) AS "customersBySex"
  `, {
    replacements: { userId },
    type: QueryTypes.SELECT,
  });

  const status = row?.planStatus || {};
  const customersBySex = {};
  for (const group of row?.customersBySex || []) {
    customersBySex[group.sex] = { total: Number(group.n || 0), ongoing: Number(group.ongoing || 0) };
  }

  return {
    totalPlans: Number(row?.totalPlans || 0),
    customers: Number(row?.customers || 0),
    plansThisWeek: Number(row?.plansThisWeek || 0),
    customersThisWeek: Number(row?.customersThisWeek || 0),
    planStatus: {
      onTrack: Number(status.onTrack || 0),
      endingSoon: Number(status.endingSoon || 0),
      expired: Number(status.expired || 0),
    },
    activeCalorieRanges: (row?.activeCalorieRanges || []).map((range) => ({
      key: `${range.start}-${Number(range.start) + CALORIE_RANGE_SIZE}`,
      count: Number(range.n || 0),
    })),
    customersBySex,
  };
}

// Recently opened plans; a coach who has never opened one sees their newest
// general plans instead.
async function listRecentPlans(userId) {
  const rows = await sequelize.query(`
    (
      SELECT ${PLAN_SUMMARY_COLUMNS}, c.name AS customer_name, 0 AS source_rank, p.last_opened_at AS sort_at
      FROM plans p
      ${PLAN_CUSTOMER_JOIN}
      WHERE p.user_id = :userId AND p.last_opened_at IS NOT NULL
      ORDER BY p.last_opened_at DESC, p.id DESC
      LIMIT :limit
    )
    UNION ALL
    (
      SELECT ${PLAN_SUMMARY_COLUMNS}, NULL AS customer_name, 1 AS source_rank, p.updated_at AS sort_at
      FROM plans p
      WHERE p.user_id = :userId AND p.customer_id IS NULL
      ORDER BY p.updated_at DESC, p.id DESC
      LIMIT :limit
    )
    ORDER BY source_rank, sort_at DESC
  `, {
    replacements: { userId, limit: HOME_LIST_SIZE },
    type: QueryTypes.SELECT,
  });

  const opened = rows.filter((row) => Number(row.source_rank) === 0);
  return (opened.length ? opened : rows).slice(0, HOME_LIST_SIZE).map(planRowToSummary);
}

// Plans that already ended, then plans ending within the window, soonest
// first. Metadata only, at most HOME_LIST_SIZE rows.
async function listExpiringPlans(userId) {
  const rows = await sequelize.query(`
    SELECT ${PLAN_SUMMARY_COLUMNS}, c.name AS customer_name
    FROM plans p
    ${PLAN_CUSTOMER_JOIN}
    WHERE p.user_id = :userId AND ${PLAN_END_SQL} - CURRENT_DATE <= ${EXPIRING_WINDOW_DAYS}
    ORDER BY ${PLAN_EXPIRED_SQL} DESC,
      CASE WHEN ${PLAN_EXPIRED_SQL} THEN CURRENT_DATE - ${PLAN_END_SQL} ELSE ${PLAN_END_SQL} - CURRENT_DATE END ASC,
      p.id DESC
    LIMIT :limit
  `, {
    replacements: { userId, limit: HOME_LIST_SIZE },
    type: QueryTypes.SELECT,
  });
  return rows.map(planRowToSummary);
}

async function listRecentCustomers(userId) {
  const rows = await sequelize.query(`
    SELECT
      c.id, c.name, c.age, c.sex, c.weight, c.height, c.activity_level,
      c.created_at, c.updated_at,
      (SELECT COUNT(*)::int FROM plans p WHERE p.user_id = :userId AND p.customer_id = c.id) AS plan_count
    FROM customers c
    WHERE c.user_id = :userId
    ORDER BY c.updated_at DESC, c.name ASC
    LIMIT :limit
  `, {
    replacements: { userId, limit: HOME_LIST_SIZE },
    type: QueryTypes.SELECT,
  });
  return rows.map(customerRowToSummary);
}

async function getDashboardSummary(userId) {
  const [stats, recentPlans, expiringPlans, recentCustomers] = await Promise.all([
    getStats(userId),
    listRecentPlans(userId),
    listExpiringPlans(userId),
    listRecentCustomers(userId),
  ]);
  return {
    stats, recentPlans, expiringPlans, recentCustomers,
  };
}

async function listCustomersPage(userId, options = {}) {
  const paging = normalizePaging(options);
  const query = normalizeSearch(options.query);
  const sex = SEX_FILTERS.has(options.sex) ? options.sex : '';
  const replacements = {
    userId,
    query,
    likeQuery: likePattern(query),
    sex,
    limit: paging.pageSize,
    offset: paging.offset,
  };
  const matchClause = `(:query = '' OR lower(btrim(c.name)) LIKE :likeQuery)
    AND (:sex = '' OR COALESCE(c.sex, 'unset') = :sex)`;

  const [rows, [totals]] = await Promise.all([
    sequelize.query(`
      WITH page AS (
        SELECT c.id, c.name, c.age, c.sex, c.weight, c.height, c.activity_level, c.created_at, c.updated_at
        FROM customers c
        WHERE c.user_id = :userId AND ${matchClause}
        ORDER BY c.name ASC, c.id ASC
        LIMIT :limit OFFSET :offset
      )
      SELECT page.*, COALESCE(pc.plan_count, 0) AS plan_count
      FROM page
      LEFT JOIN (
        SELECT customer_id, COUNT(*)::int AS plan_count
        FROM plans
        WHERE user_id = :userId AND customer_id IN (SELECT id FROM page)
        GROUP BY customer_id
      ) pc ON pc.customer_id = page.id
      ORDER BY page.name ASC, page.id ASC
    `, { replacements, type: QueryTypes.SELECT }),
    sequelize.query(`
      SELECT
        (SELECT COUNT(*)::int FROM customers c WHERE c.user_id = :userId AND ${matchClause}) AS matching,
        (SELECT COUNT(*)::int FROM customers WHERE user_id = :userId) AS total_customers,
        (
          SELECT COUNT(*)::int FROM plans
          WHERE user_id = :userId AND customer_id IS NOT NULL
        ) AS assigned_plans
    `, { replacements, type: QueryTypes.SELECT }),
  ]);

  return {
    ...pageResult(rows.map(customerRowToSummary), Number(totals.matching || 0), paging),
    summary: {
      totalCustomers: Number(totals.total_customers || 0),
      assignedPlans: Number(totals.assigned_plans || 0),
    },
  };
}

function generalPlanSearchClause(query) {
  if (!query) return '';
  return `
    AND (
      lower(p.name) LIKE :likeQuery
      OR replace(COALESCE(p.goal, 'unknown'), '_', ' ') LIKE :likeQuery
      OR (
        p.calories IS NOT NULL
        AND (floor(p.calories / ${CALORIE_RANGE_SIZE}) * ${CALORIE_RANGE_SIZE})::int::text || '-'
          || ((floor(p.calories / ${CALORIE_RANGE_SIZE}) + 1) * ${CALORIE_RANGE_SIZE})::int::text
          || ' calories' LIKE :likeQuery
      )
    )
  `;
}

async function listGeneralPlansPage(userId, options = {}) {
  const paging = normalizePaging(options);
  const query = normalizeSearch(options.query);
  const rangeStart = calorieRangeStart(options.calorieRange);
  const searchClause = generalPlanSearchClause(query);
  const rangeClause = rangeStart === null
    ? ''
    : `AND p.calories >= :rangeStart AND p.calories < :rangeStart + ${CALORIE_RANGE_SIZE}`;
  const replacements = {
    userId,
    likeQuery: likePattern(query),
    rangeStart,
    limit: paging.pageSize,
    offset: paging.offset,
  };
  const filteredFrom = `
    FROM plans p
    WHERE p.user_id = :userId
      AND p.customer_id IS NULL
      ${rangeClause}
      ${searchClause}
  `;

  const [rows, [countRow], [summaryRow]] = await Promise.all([
    sequelize.query(`
      SELECT ${PLAN_SUMMARY_COLUMNS}
      ${filteredFrom}
      ORDER BY p.updated_at DESC, p.id DESC
      LIMIT :limit OFFSET :offset
    `, { replacements, type: QueryTypes.SELECT }),
    sequelize.query(`
      SELECT COUNT(*)::int AS matching
      ${filteredFrom}
    `, { replacements, type: QueryTypes.SELECT }),
    // Chip and goal counts cover all general plans, independent of the
    // current search and filter, so the chips always show the full picture.
    sequelize.query(`
      WITH general AS (
        SELECT
          COALESCE(p.goal, 'unknown') AS goal,
          CASE WHEN p.calories > 0
            THEN (floor(p.calories / ${CALORIE_RANGE_SIZE}) * ${CALORIE_RANGE_SIZE})::int
          END AS range_start,
          ${PLAN_ACTIVE_SQL} AS active,
          p.updated_at
        FROM plans p
        WHERE p.user_id = :userId AND p.customer_id IS NULL
      )
      SELECT
        (SELECT COUNT(*)::int FROM general) AS total_general,
        (SELECT MAX(updated_at) FROM general) AS newest_at,
        (
          SELECT COUNT(*)::int FROM plans
          WHERE user_id = :userId AND customer_id IS NOT NULL
        ) AS assigned_plans,
        (
          SELECT COALESCE(json_object_agg(range_start, n), '{}'::json)
          FROM (
            SELECT range_start, COUNT(*)::int AS n
            FROM general
            WHERE range_start IS NOT NULL AND active
            GROUP BY range_start
          ) a
        ) AS range_active_counts,
        (
          SELECT COALESCE(json_object_agg(goal, n), '{}'::json)
          FROM (SELECT goal, COUNT(*)::int AS n FROM general GROUP BY goal) g
        ) AS goal_counts,
        (
          SELECT COALESCE(json_object_agg(range_start, n), '{}'::json)
          FROM (
            SELECT range_start, COUNT(*)::int AS n
            FROM general
            WHERE range_start IS NOT NULL
            GROUP BY range_start
          ) r
        ) AS range_counts
    `, { replacements: { userId }, type: QueryTypes.SELECT }),
  ]);

  const calorieRangeCounts = {};
  for (const [start, count] of Object.entries(summaryRow.range_counts || {})) {
    calorieRangeCounts[`${start}-${Number(start) + CALORIE_RANGE_SIZE}`] = Number(count);
  }
  const calorieRangeActiveCounts = {};
  for (const [start, count] of Object.entries(summaryRow.range_active_counts || {})) {
    calorieRangeActiveCounts[`${start}-${Number(start) + CALORIE_RANGE_SIZE}`] = Number(count);
  }

  return {
    ...pageResult(rows.map(planRowToSummary), Number(countRow.matching || 0), paging),
    summary: {
      totalGeneralPlans: Number(summaryRow.total_general || 0),
      assignedPlans: Number(summaryRow.assigned_plans || 0),
      newestAt: summaryRow.newest_at || null,
      goalCounts: summaryRow.goal_counts || {},
      calorieRangeCounts,
      calorieRangeActiveCounts,
    },
  };
}

module.exports = {
  getDashboardSummary,
  listCustomersPage,
  listGeneralPlansPage,
  normalizePaging,
  pageResult,
  planRowToSummary,
};
