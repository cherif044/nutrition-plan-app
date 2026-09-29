const { logger } = require('../../utils/logger');
const {
  isUpstashRedisConfigured,
  redisCommand,
  redisPipeline,
} = require('../../utils/upstashRedis');

function envNumber(name, fallback, { allowZero = false } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  const ok = Number.isFinite(value) && (allowZero ? value >= 0 : value > 0);
  return ok ? value : fallback;
}

function overloaded(message) {
  return Object.assign(new Error(message), {
    status: 503,
    code: 'generation-overloaded',
    expose: true,
  });
}

class GenerationAdmission {
  constructor() {
    this.enabled = process.env.GENERATION_GLOBAL_ADMISSION_DISABLED !== 'true'
      && isUpstashRedisConfigured();
    this.globalMax = envNumber('GENERATION_GLOBAL_INFLIGHT_MAX', 20);
    this.accountMax = envNumber('GENERATION_ACCOUNT_INFLIGHT_MAX', 2);
    this.ttlSeconds = envNumber('GENERATION_ADMISSION_TTL_SECONDS', 120);
  }

  async acquire(userId) {
    if (!this.enabled) return { release: async () => {} };
    const globalKey = 'generation:inflight:global';
    const accountKey = `generation:inflight:user:${userId}`;
    let acquiredGlobal = false;
    let acquiredAccount = false;
    try {
      const results = await redisPipeline([
        ['INCR', globalKey],
        ['EXPIRE', globalKey, String(this.ttlSeconds)],
        ['INCR', accountKey],
        ['EXPIRE', accountKey, String(this.ttlSeconds)],
      ]);
      acquiredGlobal = true;
      acquiredAccount = true;
      const globalCount = Number(results?.[0]?.result || 0);
      const accountCount = Number(results?.[2]?.result || 0);
      if (globalCount > this.globalMax || accountCount > this.accountMax) {
        await this.release({ globalKey, accountKey, acquiredGlobal, acquiredAccount });
        throw overloaded('Plan generation is busy. Please try again shortly.');
      }
      return {
        globalCount,
        accountCount,
        release: () => this.release({ globalKey, accountKey, acquiredGlobal, acquiredAccount }),
      };
    } catch (error) {
      if (error.code === 'generation-overloaded') throw error;
      logger.warn('Generation admission check failed; falling back to local queue', {
        userId,
        error: { name: error?.name, code: error?.code, status: error?.status },
      });
      return { release: async () => {} };
    }
  }

  async release({
    globalKey, accountKey, acquiredGlobal, acquiredAccount,
  }) {
    const commands = [];
    if (acquiredGlobal) commands.push(['DECR', globalKey]);
    if (acquiredAccount) commands.push(['DECR', accountKey]);
    if (!commands.length) return;
    try {
      await redisPipeline(commands);
    } catch (error) {
      logger.warn('Generation admission release failed', {
        error: { name: error?.name, code: error?.code, status: error?.status },
      });
    }
  }

  async snapshot(userId) {
    if (!this.enabled) return null;
    try {
      const [globalCount, accountCount] = await Promise.all([
        redisCommand('GET', 'generation:inflight:global'),
        redisCommand('GET', `generation:inflight:user:${userId}`),
      ]);
      return {
        globalCount: Number(globalCount || 0),
        accountCount: Number(accountCount || 0),
        globalMax: this.globalMax,
        accountMax: this.accountMax,
      };
    } catch {
      return null;
    }
  }
}

const generationAdmission = new GenerationAdmission();

module.exports = { generationAdmission };
