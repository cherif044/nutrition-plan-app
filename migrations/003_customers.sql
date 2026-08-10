-- Add customer management while keeping folder organization independent.

CREATE TABLE IF NOT EXISTS customers (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           VARCHAR(200) NOT NULL,
  age            INTEGER,
  sex            VARCHAR(20),
  weight         NUMERIC,
  height         NUMERIC,
  activity_level VARCHAR(50),
  goal           VARCHAR(50),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_user_normalized_name
  ON customers (user_id, lower(btrim(name)));

ALTER TABLE plans ADD COLUMN IF NOT EXISTS customer_id BIGINT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE plans
  DROP CONSTRAINT IF EXISTS plans_customer_id_fkey,
  ADD CONSTRAINT plans_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_plans_user_customer ON plans(user_id, customer_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_plans_one_active_per_customer
  ON plans (customer_id)
  WHERE is_active = TRUE AND customer_id IS NOT NULL;
