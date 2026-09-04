function serializeError(error) {
  if (!error) return undefined;
  return {
    name: error.name,
    message: error.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
    code: error.code,
  };
}

function write(level, message, meta = {}) {
  const payload = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...meta,
  };

  if (payload.error instanceof Error) {
    payload.error = serializeError(payload.error);
  }

  const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
  console[method](JSON.stringify(payload));
}

const logger = {
  info(message, meta) {
    write('info', message, meta);
  },
  warn(message, meta) {
    write('warn', message, meta);
  },
  error(message, meta) {
    write('error', message, meta);
  },
};

module.exports = {
  logger,
  serializeError,
};
