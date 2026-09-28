const { QueryTypes } = require('sequelize');
const sequelize = require('../config/database');

// Expired rows are deleted opportunistically instead of by a scheduled job,
// which serverless deployments do not have.
const CLEANUP_PROBABILITY = 0.005;

// A fixed-window counter shared by every instance through Postgres. One
// upsert per request: it either starts a new window or increments the
// current one, atomically, so concurrent instances never lose a hit.
const INCREMENT_SQL = `
  INSERT INTO rate_limits (key, window_start, hits)
  VALUES (:key, now(), 1)
  ON CONFLICT (key) DO UPDATE SET
    hits = CASE
      WHEN rate_limits.window_start <= now() - make_interval(secs => :windowSeconds) THEN 1
      ELSE rate_limits.hits + 1
    END,
    window_start = CASE
      WHEN rate_limits.window_start <= now() - make_interval(secs => :windowSeconds) THEN now()
      ELSE rate_limits.window_start
    END
  RETURNING hits, window_start
`;

class PostgresRateLimitStore {
  constructor({ prefix }) {
    this.prefix = `${prefix}:`;
    this.localKeys = false;
    this.windowMs = 60000;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async increment(key) {
    const [row] = await sequelize.query(INCREMENT_SQL, {
      replacements: { key: this.prefix + key, windowSeconds: this.windowMs / 1000 },
      type: QueryTypes.SELECT,
    });
    if (Math.random() < CLEANUP_PROBABILITY) this.deleteExpired();
    return {
      totalHits: Number(row.hits),
      resetTime: new Date(new Date(row.window_start).getTime() + this.windowMs),
    };
  }

  async decrement(key) {
    await sequelize.query(
      'UPDATE rate_limits SET hits = GREATEST(hits - 1, 0) WHERE key = :key',
      { replacements: { key: this.prefix + key } },
    );
  }

  async resetKey(key) {
    await sequelize.query('DELETE FROM rate_limits WHERE key = :key', {
      replacements: { key: this.prefix + key },
    });
  }

  deleteExpired() {
    sequelize.query("DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'")
      .catch(() => {});
  }
}

module.exports = { PostgresRateLimitStore };
