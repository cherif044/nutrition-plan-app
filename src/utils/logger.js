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

// Every log line passes through here before it reaches the console or OTLP,
// so a secret handed to the logger by mistake is removed in one place.
const SECRET_KEY_PATTERN = /token|secret|password|authorization|cookie|idtoken|private_?key|api_?key/i;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const MAX_STRING_LENGTH = 2000;
const MAX_DEPTH = 6;
// Counters and ids that merely mention "token" in their name.
const SAFE_KEYS = new Set(['tokenVersion', 'token_version']);

function redactString(value) {
  const text = value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]` : value;
  return text.replace(JWT_PATTERN, '[redacted-jwt]').replace(BEARER_PATTERN, 'Bearer [redacted]');
}

function redact(value, depth = 0, seen = new WeakSet()) {
  if (typeof value === 'string') return redactString(value);
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (depth >= MAX_DEPTH) return '[depth-limit]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1, seen));
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = SECRET_KEY_PATTERN.test(key) && !SAFE_KEYS.has(key)
      ? '[redacted]'
      : redact(child, depth + 1, seen);
  }
  return result;
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

  const line = stringify(redact(payload));
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
  redact,
  serializeError,
};
