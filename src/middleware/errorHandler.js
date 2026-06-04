function errorHandler(error, _req, res, _next) {
  const status = error.statusCode || 400;

  res.status(status).json({
    error: error.message || 'Unable to generate a nutrition plan.',
  });
}

module.exports = {
  errorHandler,
};
