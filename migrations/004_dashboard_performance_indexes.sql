-- Run outside a transaction. CONCURRENTLY keeps reads/writes available on live systems.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_plans_user_updated_id
  ON plans (user_id, updated_at DESC, created_at DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_plans_user_customer_updated_id
  ON plans (user_id, customer_id, updated_at DESC, created_at DESC, id DESC)
  WHERE customer_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_plans_user_active_customer_updated_id
  ON plans (user_id, customer_id, updated_at DESC, created_at DESC, id DESC)
  WHERE is_active = TRUE AND customer_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_plans_user_general_updated_id
  ON plans (user_id, updated_at DESC, created_at DESC, id DESC)
  WHERE customer_id IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_plans_user_last_opened_id
  ON plans (user_id, last_opened_at DESC, id DESC)
  WHERE last_opened_at IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_folders_user_parent_name_id
  ON folders (user_id, parent_id, name, id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_user_name_id
  ON customers (user_id, lower(btrim(name)), id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_plans_general_name_trgm
  ON plans USING gin (lower(name) gin_trgm_ops)
  WHERE customer_id IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_name_trgm
  ON customers USING gin (lower(btrim(name)) gin_trgm_ops);
