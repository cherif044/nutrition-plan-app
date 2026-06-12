-- Migration: Replace UUID with BIGSERIAL/BIGINT across all tables
-- WARNING: This drops and recreates all tables. Back up any data first.

DROP TABLE IF EXISTS plans CASCADE;
DROP TABLE IF EXISTS folders CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
  id            BIGSERIAL     PRIMARY KEY,
  username      VARCHAR(30)   UNIQUE NOT NULL,
  password_hash VARCHAR       NOT NULL,
  firstname     VARCHAR(50)   NOT NULL,
  lastname      VARCHAR(50)   NOT NULL,
  token_version INTEGER       NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  last_login    TIMESTAMPTZ
);

CREATE TABLE folders (
  id        BIGSERIAL   PRIMARY KEY,
  user_id   BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id BIGINT      REFERENCES folders(id) ON DELETE CASCADE,
  name      VARCHAR     NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE plans (
  id         BIGSERIAL   PRIMARY KEY,
  folder_id  BIGINT      NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  name       VARCHAR     NOT NULL,
  plan_data  JSONB       NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
