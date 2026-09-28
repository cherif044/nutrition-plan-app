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
      query: req.query.query,
      page: req.query.page,
      pageSize: req.query.pageSize,
    }));
  } catch (err) {
    next(err);
  }
}

async function getDashboardPlans(req, res, next) {
  try {
    res.json(await listGeneralPlansPage(req.user.id, {
      query: req.query.query,
      calorieRange: req.query.calorieRange,
      page: req.query.page,
      pageSize: req.query.pageSize,
    }));
  } catch (err) {
    next(err);
  }
}

module.exports = { getDashboard, getDashboardCustomers, getDashboardPlans };
