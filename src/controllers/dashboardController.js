const {
  getDashboardSummary,
  listCustomersPage,
  listGeneralPlansPage,
} = require('../repositories/dashboardRepository');

async function getDashboard(req, res, next) {
  try {
    res.json(await getDashboardSummary(req.user.id));
  } catch (err) {
    next(err);
  }
}

async function getDashboardCustomers(req, res, next) {
  try {
    res.json(await listCustomersPage(req.user.id, {
      query: req.validatedQuery.query,
      page: req.validatedQuery.page,
      pageSize: req.validatedQuery.pageSize,
    }));
  } catch (err) {
    next(err);
  }
}

async function getDashboardPlans(req, res, next) {
  try {
    res.json(await listGeneralPlansPage(req.user.id, {
      query: req.validatedQuery.query,
      calorieRange: req.validatedQuery.calorieRange,
      page: req.validatedQuery.page,
      pageSize: req.validatedQuery.pageSize,
    }));
  } catch (err) {
    next(err);
  }
}

module.exports = { getDashboard, getDashboardCustomers, getDashboardPlans };
