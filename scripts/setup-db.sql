-- Run as superuser: psql -U postgres -f scripts/setup-db.sql
-- Or: psql -U postgres < scripts/setup-db.sql

CREATE USER cherif WITH PASSWORD 'Basche@1172';
CREATE DATABASE nutrition_plan OWNER cherif;
GRANT ALL PRIVILEGES ON DATABASE nutrition_plan TO cherif;

\c nutrition_plan cherif

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(30) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  firstname     VARCHAR(50) NOT NULL,
  lastname      VARCHAR(50) NOT NULL,
  token_version INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_login    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS folders (
  id         SERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id  INT REFERENCES folders(id) ON DELETE CASCADE,
  name       VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_folders_user_parent ON folders(user_id, parent_id);

CREATE TABLE IF NOT EXISTS plans (
  id         SERIAL PRIMARY KEY,
  folder_id  INT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  name       VARCHAR(200) NOT NULL,
  plan_data  JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plans_folder ON plans(folder_id);
