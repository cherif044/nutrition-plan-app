-- Least-privilege runtime role (remediation P2.2). Run once as the database
-- owner (neondb_owner), e.g.:
--   psql "$OWNER_DATABASE_URL" -v app_password="'<generated>'" -v backup_password="'<generated>'" -f db/manual/app_runtime_role.sql
-- Then set Vercel's DATABASE_URL to the app_runtime user. Keep the owner
-- connection string only for migrations (CI / your machine), never in Vercel.

CREATE ROLE app_runtime LOGIN PASSWORD :app_password
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

GRANT CONNECT ON DATABASE neondb TO app_runtime;
GRANT USAGE ON SCHEMA public TO app_runtime;
REVOKE CREATE ON SCHEMA public FROM app_runtime;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON users, folders, plans, customers, sessions, rate_limits
  TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
-- Tables and sequences created by later migrations (run as the owner).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;

-- Safety limits live on the runtime role (moved from migration 007, which
-- set them on whichever role ran it).
ALTER ROLE app_runtime SET statement_timeout = '30s';
ALTER ROLE app_runtime SET lock_timeout = '20s';
ALTER ROLE app_runtime SET idle_in_transaction_session_timeout = '60s';

-- Read-only role for the backup workflow (.github/workflows/backup.yml).
CREATE ROLE backup_reader LOGIN PASSWORD :backup_password NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE neondb TO backup_reader;
GRANT USAGE ON SCHEMA public TO backup_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO backup_reader;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO backup_reader;
