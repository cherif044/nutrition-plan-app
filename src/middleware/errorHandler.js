const { logger, serializeError } = require('../utils/logger');
const { recordError } = require('../utils/metrics');

// 5xx messages written for users (queue full, generation timeout) are safe to
// show; any other server error may leak internals such as SQL or file paths.
function isUserFacingServerError(error) {
  return error.expose === true || String(error.code || '').startsWith('generation-');
}

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

  const hideDetails = status >= 500
    && process.env.NODE_ENV === 'production'
    && !isUserFacingServerError(error);
  const message = hideDetails
    ? 'Something went wrong on our side. Please try again.'
    : (error.message || (status >= 500 ? 'Internal server error.' : 'Request failed.'));

  res.status(status).json({ error: message, requestId: req.id });
}

module.exports = {
  errorHandler,
};
