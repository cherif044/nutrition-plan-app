-- Migrate authentication identity to Firebase Auth while preserving users.id
-- as the internal application key referenced by folders, customers, and plans.

ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR(128);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(254);

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_firebase_uid
  ON users(firebase_uid)
  WHERE firebase_uid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email
  ON users(email)
  WHERE email IS NOT NULL;
