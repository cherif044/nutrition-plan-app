-- Account deletion tombstone (security remediation P2.1). Idempotent.
--
-- DELETE /api/auth/me first marks the user, then deletes the Firebase account,
-- then the database rows. If a step fails part-way, the marked row blocks
-- every session and a retry (cron or the next delete attempt) finishes it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_pending_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS users_deletion_pending_idx
  ON users (deletion_pending_at)
  WHERE deletion_pending_at IS NOT NULL;
