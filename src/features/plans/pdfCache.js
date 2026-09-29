const { createHash } = require('crypto');
const { logger } = require('../../utils/logger');
const {
  isUpstashRedisConfigured,
  redisGetBuffer,
  redisSetBuffer,
} = require('../../utils/upstashRedis');

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

function cacheEnabled() {
  return process.env.PDF_CACHE_DISABLED !== 'true' && isUpstashRedisConfigured();
}

function cacheKey(plan, options = {}) {
  const clientName = String(options.clientName || '').trim();
  const nameHash = createHash('sha256').update(clientName).digest('hex').slice(0, 16);
  return [
    'pdf',
    String(plan?.user_id || 'u'),
    String(plan?.id || 'plan'),
    String(plan?.version || 1),
    nameHash,
  ].join(':');
}

async function getCachedPdf(plan, options = {}) {
  if (!cacheEnabled()) return null;
  const key = cacheKey(plan, options);
  try {
    return await redisGetBuffer(key);
  } catch (error) {
    logger.warn('PDF cache read failed', {
      planId: plan?.id,
      error: { name: error?.name, code: error?.code, status: error?.status },
    });
    return null;
  }
}

async function setCachedPdf(plan, options = {}, pdf) {
  if (!cacheEnabled()) return false;
  const maxBytes = envNumber('PDF_CACHE_MAX_BYTES', DEFAULT_MAX_BYTES);
  if (!Buffer.isBuffer(pdf) || pdf.length > maxBytes) return false;
  const ttlSeconds = envNumber('PDF_CACHE_TTL_SECONDS', DEFAULT_TTL_SECONDS);
  try {
    return await redisSetBuffer(cacheKey(plan, options), pdf, ttlSeconds);
  } catch (error) {
    logger.warn('PDF cache write failed', {
      planId: plan?.id,
      bytes: pdf?.length,
      error: { name: error?.name, code: error?.code, status: error?.status },
    });
    return false;
  }
}

async function cachedPdf(plan, options, render) {
  const cached = await getCachedPdf(plan, options);
  if (cached) return { pdf: cached, cache: 'hit' };
  const pdf = await render();
  await setCachedPdf(plan, options, pdf);
  return { pdf, cache: 'miss' };
}

module.exports = {
  cachedPdf,
  cacheKey,
};
