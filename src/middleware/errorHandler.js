function errorHandler(error, _req, res, _next) {
  const isDatabaseError = String(error.name || '').startsWith('Sequelize');
  const status = error.status || error.statusCode || (isDatabaseError ? 500 : 400);

  res.status(status).json({
    error: status >= 500
      ? (error.message || 'Internal server error.')
      : (error.message || 'Request failed.'),
  });
}

module.exports = {
  errorHandler,
};
