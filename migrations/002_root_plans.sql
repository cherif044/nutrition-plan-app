-- Allow meal plans to live at Home/root instead of inside a folder.
-- Existing folder plans inherit their user_id from their folder.

ALTER TABLE plans ADD COLUMN IF NOT EXISTS user_id BIGINT;

UPDATE plans
SET user_id = folders.user_id
FROM folders
WHERE plans.folder_id = folders.id
  AND plans.user_id IS NULL;

ALTER TABLE plans ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE plans
  DROP CONSTRAINT IF EXISTS plans_user_id_fkey,
  ADD CONSTRAINT plans_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE plans ALTER COLUMN folder_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_plans_user_folder ON plans(user_id, folder_id);
