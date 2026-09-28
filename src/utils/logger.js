const { emitLog } = require('./otelMetrics');

function serializeError(error) {
  if (!error) return undefined;
  return {
    name: error.name,
    message: error.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
    code: error.code,
  };
}

// Circular references or BigInts in meta must never turn a log call into a
// request failure, so fall back to a minimal line instead of throwing.
function stringify(payload) {
  try {
    return JSON.stringify(payload);
  } catch {
    return JSON.stringify({
      level: payload.level,
      message: payload.message,
      timestamp: payload.timestamp,
      requestId: payload.requestId,
      logSerializationFailed: true,
    });
  }
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

  const line = stringify(payload);
  const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
  console[method](line);

  // The JSON line is the body so Loki's `| json` parser exposes every field.
  const attributes = {};
  if (typeof payload.requestId === 'string') attributes.request_id = payload.requestId;
  emitLog(level, line, attributes);
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
