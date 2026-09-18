\getenv migration_password MIGRATION_DATABASE_PASSWORD
\getenv runtime_password RUNTIME_DATABASE_PASSWORD
\getenv backup_password BACKUP_DATABASE_PASSWORD

SELECT format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE', :'schema_owner_role')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'schema_owner_role') \gexec
SELECT format('ALTER ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', :'schema_owner_role') \gexec

SELECT format('CREATE ROLE %I LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'migration_login_role', :'migration_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'migration_login_role') \gexec
SELECT format('ALTER ROLE %I LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'migration_login_role', :'migration_password') \gexec

SELECT format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE', :'runtime_role')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'runtime_role') \gexec
SELECT format('ALTER ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', :'runtime_role') \gexec

SELECT format('CREATE ROLE %I LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'runtime_login_role', :'runtime_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'runtime_login_role') \gexec
SELECT format('ALTER ROLE %I LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'runtime_login_role', :'runtime_password') \gexec

SELECT format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', :'backup_role')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'backup_role') \gexec
SELECT format('ALTER ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', :'backup_role') \gexec
SELECT format('CREATE ROLE %I LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'backup_login_role', :'backup_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'backup_login_role') \gexec
SELECT format('ALTER ROLE %I LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'backup_login_role', :'backup_password') \gexec

SELECT format('GRANT %I TO %I', :'schema_owner_role', :'migration_login_role') \gexec
SELECT format('GRANT %I TO %I', :'runtime_role', :'runtime_login_role') \gexec
SELECT format('GRANT %I TO %I', :'backup_role', :'backup_login_role') \gexec

SELECT format('CREATE DATABASE %I', :'database_name')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'database_name') \gexec
