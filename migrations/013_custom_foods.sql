-- Custom foods: foods a coach adds by hand for manual-mode plans. Idempotent.
--
-- Each row is one food with its macros per 100 g; calories are derived
-- (4/4/9 kcal per gram) and never stored. They live apart from the tested
-- catalog (used_food_repository/foods.json), so plan generation, swaps and
-- rebalancing never see them. Plans keep their own copy of a custom food's
-- name and macros, so a deleted row never breaks a saved plan.
-- The 50-per-account cap is enforced by the app under the account lock.
CREATE TABLE IF NOT EXISTS custom_foods (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  name VARCHAR(60) NOT NULL,
  protein_g_per_100g NUMERIC(4, 1) NOT NULL,
  carb_g_per_100g NUMERIC(4, 1) NOT NULL,
  fat_g_per_100g NUMERIC(4, 1) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT custom_foods_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  CONSTRAINT custom_foods_protein_range CHECK (protein_g_per_100g BETWEEN 0 AND 100),
  CONSTRAINT custom_foods_carb_range CHECK (carb_g_per_100g BETWEEN 0 AND 100),
  CONSTRAINT custom_foods_fat_range CHECK (fat_g_per_100g BETWEEN 0 AND 100),
  CONSTRAINT custom_foods_macro_total CHECK (protein_g_per_100g + carb_g_per_100g + fat_g_per_100g <= 100)
);

-- One name per account (case-insensitive), and the per-account list query.
CREATE UNIQUE INDEX IF NOT EXISTS custom_foods_user_name_idx
  ON custom_foods (user_id, lower(name));
CREATE INDEX IF NOT EXISTS custom_foods_user_created_idx
  ON custom_foods (user_id, created_at DESC, id DESC);
