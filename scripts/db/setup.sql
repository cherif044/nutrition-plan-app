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

CREATE TABLE IF NOT EXISTS plans (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id  BIGINT REFERENCES folders(id) ON DELETE CASCADE,
  name       VARCHAR(200) NOT NULL,
  plan_data  JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plans_user_folder ON plans(user_id, folder_id);
CREATE INDEX IF NOT EXISTS idx_plans_folder ON plans(folder_id);
