#!/bin/sh
set -eu

: "${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL is required}"
: "${RUNTIME_DATABASE_ROLE:?RUNTIME_DATABASE_ROLE is required}"

DATABASE_SCHEMA=${DATABASE_SCHEMA:-public}

case "$RUNTIME_DATABASE_ROLE" in
  ''|*[!A-Za-z0-9_]*) echo "RUNTIME_DATABASE_ROLE must be a PostgreSQL identifier." >&2; exit 1 ;;
esac

case "$DATABASE_SCHEMA" in
  ''|*[!A-Za-z0-9_]*) echo "DATABASE_SCHEMA must be a PostgreSQL identifier." >&2; exit 1 ;;
esac

psql \
  --no-psqlrc \
  --set=ON_ERROR_STOP=1 \
  --set=runtime_role="$RUNTIME_DATABASE_ROLE" \
  --set=schema_name="$DATABASE_SCHEMA" \
  --dbname="$MIGRATION_DATABASE_URL" \
  --file="$(dirname "$0")/sql/grant-patient-mrn-sequence.sql"
