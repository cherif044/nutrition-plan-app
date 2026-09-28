require('dotenv').config();
const app = require('./app');
const sequelize = require('./config/database');
const { closeGenerationPool } = require('./services/planGenerationPool');
const { logger } = require('./utils/logger');
const { attachHttpServerMetrics, recordError, shutdownMetrics } = require('./utils/metrics');

const port = process.env.PORT || 3000;
const shutdownTimeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10000;
let server = null;
let isShuttingDown = false;

async function startServer() {
  try {
    await sequelize.authenticate();
    logger.info('Database connected');

    server = app.listen(port, () => {
      logger.info('Nutrition Plan website started', {
        port: Number(port),
        url: `http://localhost:${port}`,
        pid: process.pid,
      });
    });
    attachHttpServerMetrics(server);

    server.on('error', (error) => {
      logger.error('HTTP server error', { error });
    });
  } catch (error) {
    recordError(error, 500);
    logger.error('Unable to start server', { error });
    process.exit(1);
  }
}

function shutdown(signal) {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress', { signal });
    return;
  }

  isShuttingDown = true;
  app.locals.isShuttingDown = true;
  logger.info('Graceful shutdown started', { signal, shutdownTimeoutMs });

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out', { signal });
    process.exit(1);
  }, shutdownTimeoutMs);
  forceExit.unref();

  const closeDatabase = async () => {
    try {
      await closeGenerationPool();
      logger.info('Plan generation workers closed');
      await shutdownMetrics();
      logger.info('Metrics exporter closed');
      await sequelize.close();
      logger.info('Database connection closed');
      clearTimeout(forceExit);
      process.exit(0);
    } catch (error) {
      logger.error('Error closing database connection', { error });
      clearTimeout(forceExit);
      process.exit(1);
    }
  };

  if (!server) {
    closeDatabase();
    return;
  }

  server.close((error) => {
    if (error) {
      logger.error('Error closing HTTP server', { error });
      clearTimeout(forceExit);
      process.exit(1);
      return;
    }

    logger.info('HTTP server closed');
    closeDatabase();
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  recordError(reason instanceof Error ? reason : new Error(String(reason)), 500);
  logger.error('Unhandled promise rejection', {
    error: reason instanceof Error ? reason : new Error(String(reason)),
  });
});

process.on('uncaughtException', (error) => {
  recordError(error, 500);
  logger.error('Uncaught exception', { error });
  shutdown('uncaughtException');
});

startServer();
