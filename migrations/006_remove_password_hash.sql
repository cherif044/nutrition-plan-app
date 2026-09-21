-- Firebase owns password storage and verification. Remove the unused legacy
-- application-side password hash column from the users table.
ALTER TABLE users
  DROP COLUMN IF EXISTS password_hash;
