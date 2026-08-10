CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  username      VARCHAR(30) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  firstname     VARCHAR(50) NOT NULL,
  lastname      VARCHAR(50) NOT NULL,
  token_version INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_login    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS folders (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id  BIGINT REFERENCES folders(id) ON DELETE CASCADE,
  name       VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_folders_user_parent ON folders(user_id, parent_id);

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

CREATE TABLE IF NOT EXISTS plans (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id  BIGINT REFERENCES folders(id) ON DELETE CASCADE,
  customer_id BIGINT REFERENCES customers(id) ON DELETE CASCADE,
  name       VARCHAR(200) NOT NULL,
  plan_data  JSONB NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT FALSE,
  last_opened_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plans_user_folder ON plans(user_id, folder_id);
CREATE INDEX IF NOT EXISTS idx_plans_folder ON plans(folder_id);
CREATE INDEX IF NOT EXISTS idx_plans_user_customer ON plans(user_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_plans_user_last_opened
  ON plans(user_id, last_opened_at DESC)
  WHERE last_opened_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_plans_one_active_per_customer
  ON plans (customer_id)
  WHERE is_active = TRUE AND customer_id IS NOT NULL;
