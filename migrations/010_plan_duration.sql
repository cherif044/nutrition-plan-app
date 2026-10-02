-- Plan duration + list-page macro columns. Idempotent.
--
-- start_date and duration_weeks drive a plan's status (ongoing, ending soon,
-- expired); the end date is derived (start_date + duration_weeks * 7), never
-- stored. protein_g, carbs_g and fat_g are copied from plan_data on every save,
-- like calories, so list pages can draw macros without reading plan_data.
-- Defaults let older clients keep saving without sending the new fields.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS start_date     DATE     NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS duration_weeks SMALLINT NOT NULL DEFAULT 4;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS protein_g      NUMERIC;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS carbs_g        NUMERIC;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS fat_g          NUMERIC;

ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_duration_weeks_range;
ALTER TABLE plans ADD  CONSTRAINT plans_duration_weeks_range CHECK (duration_weeks BETWEEN 1 AND 8);
