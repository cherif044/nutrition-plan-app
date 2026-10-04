-- Plan meal count + newest-first plan lists. Idempotent.
--
-- meal_count is copied from plan_data on every save, like goal and calories,
-- so list pages can show "4 meals" without reading plan_data. The UPDATE
-- fills it in once for plans saved before this column existed.
-- Plan lists sort by created_at (newest first); these indexes match those
-- queries the way the updated_at ones in 007 did.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS meal_count SMALLINT;

UPDATE plans
SET meal_count = jsonb_array_length(plan_data->'meals')
WHERE meal_count IS NULL AND jsonb_typeof(plan_data->'meals') = 'array';

CREATE INDEX IF NOT EXISTS plans_user_general_created_idx
  ON plans (user_id, created_at DESC, id DESC)
  WHERE customer_id IS NULL;
CREATE INDEX IF NOT EXISTS plans_user_customer_created_idx
  ON plans (user_id, customer_id, created_at DESC, id DESC);
