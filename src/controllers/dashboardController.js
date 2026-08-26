const { getDashboardSummary } = require('../repositories/dashboardRepository');

async function getDashboard(req, res, next) {
  try {
    const dashboard = await getDashboardSummary(req.user.id, {
      customerQuery: req.query.customerQuery || '',
      generalQuery: req.query.generalQuery || '',
      limit: req.query.limit,
    });
    res.json(dashboard);
  } catch (err) {
    next(err);
  }
}

module.exports = { getDashboard };
