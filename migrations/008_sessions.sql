-- Revocable server-side sessions (security remediation P1.1). Run once, before
-- deploying the matching app code. Every statement is idempotent.
--
-- The session cookie now carries a signed JWT whose `sid` points at a row
-- here. Logging out revokes the row, so a copied cookie stops working
-- immediately instead of living until the JWT expires.

CREATE TABLE IF NOT EXISTS sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ,
  firebase_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_agent          VARCHAR(200),
  ip_hash             TEXT
);

CREATE INDEX IF NOT EXISTS sessions_user_active_idx
  ON sessions (user_id)
  WHERE revoked_at IS NULL;

-- Expired and revoked rows are removed opportunistically by the app; this
-- index keeps that delete cheap.
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);
