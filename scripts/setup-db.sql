-- Run as superuser: psql -U postgres -f scripts/setup-db.sql
-- Or: psql -U postgres < scripts/setup-db.sql

CREATE USER cherif WITH PASSWORD 'Basche@1172';
CREATE DATABASE nutrition_plan OWNER cherif;
GRANT ALL PRIVILEGES ON DATABASE nutrition_plan TO cherif;
