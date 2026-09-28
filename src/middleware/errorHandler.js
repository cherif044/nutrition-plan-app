const { logger, serializeError } = require('../utils/logger');
const { recordError } = require('../utils/metrics');

function errorHandler(error, req, res, _next) {
  const isDatabaseError = String(error.name || '').startsWith('Sequelize');
  const status = error.status || error.statusCode || (isDatabaseError ? 500 : 400);
  recordError(error, status);

  if (status >= 500) {
    // Server logs are private, so keep the stack even in production: it is
    // the only way to tell why a 5xx happened from Grafana.
    logger.error('Request failed', {
      requestId: req.id,
      method: req.method,
      path: String(req.originalUrl || req.url || '').split('?')[0],
      statusCode: status,
      error: { ...serializeError(error), stack: error.stack },
    });
  }

  res.status(status).json({
    error: status >= 500
      ? (error.message || 'Internal server error.')
      : (error.message || 'Request failed.'),
  });
}

module.exports = {
  errorHandler,
};
