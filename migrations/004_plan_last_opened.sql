-- Track which saved plans were opened most recently in the editor.

ALTER TABLE plans ADD COLUMN IF NOT EXISTS last_opened_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_plans_user_last_opened
  ON plans(user_id, last_opened_at DESC)
  WHERE last_opened_at IS NOT NULL;
