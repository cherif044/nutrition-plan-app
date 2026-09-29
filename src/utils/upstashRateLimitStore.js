const { redisCommand, redisPipeline } = require('./upstashRedis');

class UpstashRateLimitStore {
  constructor({ prefix }) {
    this.prefix = `${prefix}:`;
    this.localKeys = false;
    this.windowMs = 60000;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  windowId(now = Date.now()) {
    return Math.floor(now / this.windowMs);
  }

  redisKey(key, now = Date.now()) {
    return `rl:${this.prefix}${key}:${this.windowId(now)}`;
  }

  resetTime(now = Date.now()) {
    return new Date((this.windowId(now) + 1) * this.windowMs);
  }

  async increment(key) {
    const now = Date.now();
    const redisKey = this.redisKey(key, now);
    const ttlMs = this.resetTime(now).getTime() - now + 1000;
    const results = await redisPipeline([
      ['INCR', redisKey],
      ['PEXPIRE', redisKey, String(Math.max(ttlMs, 1000))],
    ]);
    return {
      totalHits: Number(results?.[0]?.result || 0),
      resetTime: this.resetTime(now),
    };
  }

  async decrement(key) {
    await redisCommand('DECR', this.redisKey(key));
  }

  async resetKey(key) {
    await redisCommand('DEL', this.redisKey(key));
  }
}

module.exports = { UpstashRateLimitStore };
