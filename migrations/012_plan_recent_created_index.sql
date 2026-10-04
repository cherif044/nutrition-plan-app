-- Home's "Recent plans" lists a coach's newest plans, general or assigned,
-- so it sorts every plan by created_at. Idempotent.
CREATE INDEX IF NOT EXISTS plans_user_created_idx
  ON plans (user_id, created_at DESC, id DESC);
