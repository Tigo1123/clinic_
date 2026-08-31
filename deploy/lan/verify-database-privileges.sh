#!/bin/sh
set -eu

: "${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL is required}"
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${LAN_DATABASE_NAME:?LAN_DATABASE_NAME is required}"
: "${DATABASE_SCHEMA:?DATABASE_SCHEMA is required}"
: "${SCHEMA_OWNER_ROLE:?SCHEMA_OWNER_ROLE is required}"
: "${MIGRATION_LOGIN_ROLE:?MIGRATION_LOGIN_ROLE is required}"
: "${RUNTIME_DATABASE_ROLE:?RUNTIME_DATABASE_ROLE is required}"
: "${RUNTIME_LOGIN_ROLE:?RUNTIME_LOGIN_ROLE is required}"

echo 'Runtime identity and privilege proof (no credentials):'
psql --no-psqlrc --set=ON_ERROR_STOP=1 \
  --set=database_name="$LAN_DATABASE_NAME" \
  --set=schema_name="$DATABASE_SCHEMA" \
  --set=schema_owner_role="$SCHEMA_OWNER_ROLE" \
  --set=migration_login_role="$MIGRATION_LOGIN_ROLE" \
  --set=runtime_role="$RUNTIME_DATABASE_ROLE" \
  --set=runtime_login_role="$RUNTIME_LOGIN_ROLE" \
  --dbname="$DATABASE_URL" \
  --file=/workspace/deploy/lan/sql/verify-runtime.sql
