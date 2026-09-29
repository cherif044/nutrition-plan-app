const { logger } = require('./logger');

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return {
    url: String(url).replace(/\/+$/, ''),
    token: String(token),
  };
}

function isUpstashRedisConfigured() {
  return Boolean(redisConfig());
}

async function redisPipeline(commands, options = {}) {
  const config = redisConfig();
  if (!config) {
    const error = new Error('Upstash Redis is not configured.');
    error.code = 'redis-not-configured';
    throw error;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 5000);
  try {
    const response = await fetch(`${config.url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = new Error(`Upstash Redis request failed with ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    const results = await response.json();
    const failed = Array.isArray(results) ? results.find((item) => item?.error) : null;
    if (failed) {
      const error = new Error(failed.error);
      error.code = 'redis-command-error';
      throw error;
    }
    return results;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('Upstash Redis request timed out.');
      timeoutError.code = 'redis-timeout';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function redisCommand(command, ...args) {
  const [result] = await redisPipeline([[command, ...args]]);
  return result?.result;
}

async function redisGetBuffer(key) {
  const value = await redisCommand('GET', key);
  if (!value) return null;
  try {
    return Buffer.from(String(value), 'base64');
  } catch (error) {
    logger.warn('Invalid base64 value in Redis cache', { key, error: { name: error.name } });
    return null;
  }
}

async function redisSetBuffer(key, buffer, ttlSeconds) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return false;
  await redisCommand('SET', key, buffer.toString('base64'), 'EX', String(ttlSeconds));
  return true;
}

module.exports = {
  isUpstashRedisConfigured,
  redisCommand,
  redisGetBuffer,
  redisPipeline,
  redisSetBuffer,
};
