-- Scalability hardening. Run once, before deploying the matching app code.
-- Every statement is idempotent, so re-running the file is safe.

-- Shared rate-limit counters (one row per limiter + client). Replaces the
-- per-instance in-memory counters, which multiply by the number of Vercel
-- instances and reset on every cold start.
CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  hits         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limits_window_start_idx ON rate_limits (window_start);

-- Optimistic concurrency: every successful plan update increments version.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Idempotent plan creation: a retried or double-submitted save carries the
-- same client_request_id and resolves to the plan that was already created.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS client_request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS plans_user_client_request_id_key
  ON plans (user_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

-- Summary columns copied out of plan_data on every save. List pages read
-- these instead of plan_data, which is a large JSONB document that Postgres
-- would otherwise decompress per row just to read three small fields.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS goal TEXT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS diet_type TEXT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS calories NUMERIC;

UPDATE plans p SET
  goal = p.plan_data #>> '{input,goal}',
  diet_type = p.plan_data #>> '{input,dietType}',
  calories = CASE WHEN s.raw_calories ~ '^[0-9]+(\.[0-9]+)?$' THEN s.raw_calories::numeric END
FROM (
  SELECT id, COALESCE(
    plan_data #>> '{dailyActuals,calories}',
    plan_data #>> '{dailyTargets,calories}',
    plan_data #>> '{nutritionCalculation,targetCalories}'
  ) AS raw_calories
  FROM plans
) s
WHERE s.id = p.id
  AND p.goal IS NULL AND p.diet_type IS NULL AND p.calories IS NULL;

-- Indexes matching the paginated dashboard queries.
CREATE INDEX IF NOT EXISTS plans_user_general_updated_idx
  ON plans (user_id, updated_at DESC, id DESC)
  WHERE customer_id IS NULL;
CREATE INDEX IF NOT EXISTS plans_user_customer_updated_idx
  ON plans (user_id, customer_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS plans_user_last_opened_idx
  ON plans (user_id, last_opened_at DESC)
  WHERE last_opened_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS customers_user_name_idx
  ON customers (user_id, name, id);
CREATE INDEX IF NOT EXISTS customers_user_updated_idx
  ON customers (user_id, updated_at DESC);

-- Safety nets for runaway database work. Set on the application role so they
-- apply through Neon's connection pooler. Generous on purpose: they only stop
-- extreme cases, never normal traffic.
ALTER ROLE CURRENT_USER SET statement_timeout = '30s';
ALTER ROLE CURRENT_USER SET lock_timeout = '20s';
ALTER ROLE CURRENT_USER SET idle_in_transaction_session_timeout = '60s';
