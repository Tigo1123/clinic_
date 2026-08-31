#!/bin/sh
set -eu

require_value() {
  [ -n "$2" ] || { echo "$1 is required." >&2; exit 1; }
}
require_value POSTGRES_ADMIN_CONNECTION "${POSTGRES_ADMIN_CONNECTION-}"
require_value MIGRATION_DATABASE_URL "${MIGRATION_DATABASE_URL-}"
require_value DATABASE_URL "${DATABASE_URL-}"
require_value LAN_DATABASE_NAME "${LAN_DATABASE_NAME-}"
require_value SCHEMA_OWNER_ROLE "${SCHEMA_OWNER_ROLE-}"
require_value MIGRATION_LOGIN_ROLE "${MIGRATION_LOGIN_ROLE-}"
require_value MIGRATION_DATABASE_PASSWORD "${MIGRATION_DATABASE_PASSWORD-}"
require_value RUNTIME_DATABASE_ROLE "${RUNTIME_DATABASE_ROLE-}"
require_value RUNTIME_LOGIN_ROLE "${RUNTIME_LOGIN_ROLE-}"
require_value RUNTIME_DATABASE_PASSWORD "${RUNTIME_DATABASE_PASSWORD-}"
require_value CONFIRM_LAN_DATABASE_BOOTSTRAP "${CONFIRM_LAN_DATABASE_BOOTSTRAP-}"

DATABASE_SCHEMA=${DATABASE_SCHEMA:-public}
validate_identifier() {
  name=$1
  value=$2
  case "$value" in
    *[!A-Za-z0-9_]*|'') echo "$name must be a PostgreSQL identifier." >&2; exit 1 ;;
  esac
}
validate_identifier LAN_DATABASE_NAME "$LAN_DATABASE_NAME"
validate_identifier DATABASE_SCHEMA "$DATABASE_SCHEMA"
validate_identifier SCHEMA_OWNER_ROLE "$SCHEMA_OWNER_ROLE"
validate_identifier MIGRATION_LOGIN_ROLE "$MIGRATION_LOGIN_ROLE"
validate_identifier RUNTIME_DATABASE_ROLE "$RUNTIME_DATABASE_ROLE"
validate_identifier RUNTIME_LOGIN_ROLE "$RUNTIME_LOGIN_ROLE"

[ "$CONFIRM_LAN_DATABASE_BOOTSTRAP" = "$LAN_DATABASE_NAME" ] || {
  echo 'CONFIRM_LAN_DATABASE_BOOTSTRAP must exactly equal LAN_DATABASE_NAME.' >&2
  exit 1
}

[ "$SCHEMA_OWNER_ROLE" != "$MIGRATION_LOGIN_ROLE" ] &&
[ "$SCHEMA_OWNER_ROLE" != "$RUNTIME_DATABASE_ROLE" ] &&
[ "$SCHEMA_OWNER_ROLE" != "$RUNTIME_LOGIN_ROLE" ] &&
[ "$MIGRATION_LOGIN_ROLE" != "$RUNTIME_DATABASE_ROLE" ] &&
[ "$MIGRATION_LOGIN_ROLE" != "$RUNTIME_LOGIN_ROLE" ] &&
[ "$RUNTIME_DATABASE_ROLE" != "$RUNTIME_LOGIN_ROLE" ] || {
  echo 'All four database role names must be distinct.' >&2
  exit 1
}

validate_url() {
  connection_name=$1
  expected_database=$2
  expected_user=${3:-}
  node -e '
    const [name, expectedDatabase, expectedUser] = process.argv.slice(1);
    const value = process.env[name];
    let url;
    try { url = new URL(value); } catch { process.exit(2); }
    const local = new Set(["postgres", "localhost", "127.0.0.1", "::1"]);
    const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
    const user = decodeURIComponent(url.username);
    if (!local.has(url.hostname) || database !== expectedDatabase || (expectedUser && user !== expectedUser)) process.exit(3);
  ' "$connection_name" "$expected_database" "$expected_user" || {
    echo "$connection_name must target the expected local/container-only database." >&2
    exit 1
  }
}

validate_url POSTGRES_ADMIN_CONNECTION postgres
validate_url MIGRATION_DATABASE_URL "$LAN_DATABASE_NAME" "$MIGRATION_LOGIN_ROLE"
validate_url DATABASE_URL "$LAN_DATABASE_NAME" "$RUNTIME_LOGIN_ROLE"

echo 'Bootstrap administrator identity proof (no credentials):'
psql --no-psqlrc --set=ON_ERROR_STOP=1 --dbname="$POSTGRES_ADMIN_CONNECTION" \
  --command="SELECT current_database(), session_user, current_user, inet_server_addr();"

psql --no-psqlrc --set=ON_ERROR_STOP=1 \
  --set=database_name="$LAN_DATABASE_NAME" \
  --set=schema_owner_role="$SCHEMA_OWNER_ROLE" \
  --set=migration_login_role="$MIGRATION_LOGIN_ROLE" \
  --set=runtime_role="$RUNTIME_DATABASE_ROLE" \
  --set=runtime_login_role="$RUNTIME_LOGIN_ROLE" \
  --dbname="$POSTGRES_ADMIN_CONNECTION" \
  --file=/workspace/deploy/lan/sql/create-roles-and-database.sql

admin_target_connection=$(node -e '
  const url = new URL(process.env.POSTGRES_ADMIN_CONNECTION);
  url.pathname = `/${process.env.LAN_DATABASE_NAME}`;
  process.stdout.write(url.toString());
')

psql --no-psqlrc --set=ON_ERROR_STOP=1 \
  --set=database_name="$LAN_DATABASE_NAME" \
  --set=schema_name="$DATABASE_SCHEMA" \
  --set=schema_owner_role="$SCHEMA_OWNER_ROLE" \
  --set=migration_login_role="$MIGRATION_LOGIN_ROLE" \
  --set=runtime_role="$RUNTIME_DATABASE_ROLE" \
  --set=runtime_login_role="$RUNTIME_LOGIN_ROLE" \
  --dbname="$admin_target_connection" \
  --file=/workspace/deploy/lan/sql/configure-database.sql
unset admin_target_connection

echo 'Migration identity proof (no credentials):'
psql --no-psqlrc --set=ON_ERROR_STOP=1 --dbname="$MIGRATION_DATABASE_URL" \
  --set=migration_login_role="$MIGRATION_LOGIN_ROLE" \
  --set=schema_owner_role="$SCHEMA_OWNER_ROLE" \
  --file=/workspace/deploy/lan/sql/verify-migration-identity.sql

DATABASE_URL=$MIGRATION_DATABASE_URL npx prisma migrate deploy

psql --no-psqlrc --set=ON_ERROR_STOP=1 \
  --set=schema_name="$DATABASE_SCHEMA" \
  --set=runtime_role="$RUNTIME_DATABASE_ROLE" \
  --dbname="$MIGRATION_DATABASE_URL" \
  --file=/workspace/deploy/lan/sql/grant-runtime.sql

RUNTIME_DATABASE_ROLE=$RUNTIME_DATABASE_ROLE \
MIGRATION_DATABASE_URL=$MIGRATION_DATABASE_URL \
DATABASE_SCHEMA=$DATABASE_SCHEMA \
  /workspace/backend/scripts/provision-patient-mrn-sequence.sh

/workspace/deploy/lan/verify-database-privileges.sh
echo 'LAN database bootstrap and least-privilege verification completed.'
