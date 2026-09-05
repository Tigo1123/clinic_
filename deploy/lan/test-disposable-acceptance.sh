#!/bin/sh
set -eu
umask 077

suffix="$(date -u +%Y%m%d%H%M%S)_$$"
project="clinic-lan-phase1a7-$suffix"
database="clinic_lan_phase1a7_$suffix"
acceptance_confirmation="PHASE1A7-$suffix"
reference_marker="Phase1A7 Laboratory Test $suffix"
owner="p1a7_owner_$suffix"
migration="p1a7_migration_$suffix"
runtime_role="p1a7_runtime_role_$suffix"
runtime_login="p1a7_runtime_login_$suffix"
backup_role="p1a7_backup_role_$suffix"
backup_login="p1a7_backup_login_$suffix"
admin_password="p1a7-admin-$suffix-Aa9"
migration_password="p1a7-migration-$suffix"
runtime_password="p1a7-runtime-$suffix"
backup_password="p1a7-backup-$suffix"
test_root=$(mktemp -d "$PWD/.local/clinic-lan-phase1a7-XXXXXX")
compose_file="$test_root/compose.yml"
password_file="$test_root/first-admin-password"
printf '%s\n' "$admin_password" > "$password_file"
chmod 600 "$password_file"

cleanup() {
  docker compose -p "$project" -f "$compose_file" down --remove-orphans >/dev/null 2>&1 || true
  for volume in $(docker volume ls --filter "label=com.docker.compose.project=$project" --format '{{.Name}}'); do
    case "$volume" in "$project"*) [ "$(docker volume inspect --format '{{index .Labels "com.docker.compose.project"}}' "$volume")" = "$project" ] && docker volume rm "$volume" >/dev/null 2>&1 || true;; esac
  done
  for image in "$project-bootstrap" "$project-backend" "$project-frontend"; do docker image rm "$image" >/dev/null 2>&1 || true; done
  case "$test_root" in "$PWD"/.local/clinic-lan-phase1a7-*) find "$test_root" -depth -delete 2>/dev/null || true;; esac
}
trap cleanup EXIT HUP INT TERM

cat > "$compose_file" <<EOF
services:
  postgres:
    image: postgres:16-alpine
    environment: {POSTGRES_DB: postgres, POSTGRES_USER: postgres, POSTGRES_PASSWORD: "$migration_password"}
    volumes: [postgres-data:/var/lib/postgresql/data]
    networks: [data]
    restart: unless-stopped
    healthcheck: {test: [CMD-SHELL, 'pg_isready -U postgres -d postgres'], interval: 1s, timeout: 1s, retries: 30}
  bootstrap:
    build: {context: $PWD, dockerfile: deploy/lan/Dockerfile.bootstrap}
    environment:
      POSTGRES_ADMIN_CONNECTION: postgresql://postgres:$migration_password@postgres:5432/postgres
      MIGRATION_DATABASE_URL: postgresql://$migration:$migration_password@postgres:5432/$database
      DATABASE_URL: postgresql://$runtime_login:$runtime_password@postgres:5432/$database
      LAN_DATABASE_NAME: $database
      DATABASE_SCHEMA: public
      SCHEMA_OWNER_ROLE: $owner
      MIGRATION_LOGIN_ROLE: $migration
      MIGRATION_DATABASE_PASSWORD: $migration_password
      RUNTIME_DATABASE_ROLE: $runtime_role
      RUNTIME_LOGIN_ROLE: $runtime_login
      RUNTIME_DATABASE_PASSWORD: $runtime_password
      BACKUP_DATABASE_ROLE: $backup_role
      BACKUP_DATABASE_USER: $backup_login
      BACKUP_DATABASE_PASSWORD: $backup_password
      CONFIRM_LAN_DATABASE_BOOTSTRAP: $database
    networks: [data]
    depends_on: {postgres: {condition: service_healthy}}
    restart: 'no'
  first-admin:
    build: {context: $PWD/backend, dockerfile: Dockerfile}
    command: [node, scripts/provision-first-admin.js]
    environment:
      DATABASE_URL: postgresql://$runtime_login:$runtime_password@postgres:5432/$database
      LAN_DATABASE_NAME: $database
      RUNTIME_LOGIN_ROLE: $runtime_login
      CONFIRM_FIRST_ADMIN_DATABASE: $database
      FIRST_ADMIN_USERNAME: phase1a7-admin@example.test
      FIRST_ADMIN_PASSWORD_FILE: /run/secrets/first-admin-password
      FIRST_ADMIN_PREFERRED_LANGUAGE: en
      BCRYPT_ROUNDS: '10'
    volumes: ['$password_file:/run/secrets/first-admin-password:ro,Z']
    networks: [data]
    depends_on: {postgres: {condition: service_healthy}}
    restart: 'no'
  backend:
    build: {context: $PWD/backend, dockerfile: Dockerfile}
    environment:
      NODE_ENV: test
      CLINIC_TIME_ZONE: Africa/Khartoum
      PORT: '5000'
      DATABASE_URL: postgresql://$runtime_login:$runtime_password@postgres:5432/$database
      SOCKET_REVOCATION_DATABASE_URL: postgresql://$runtime_login:$runtime_password@postgres:5432/$database
      JWT_SECRET: phase1a7-disposable-jwt-secret-at-least-32-characters
      MEDICAL_ENCRYPTION_KEY: phase1a7-disposable-medical-key-at-least-32-characters
      MFA_ENCRYPTION_KEY: phase1a7-disposable-mfa-key-at-least-32-characters
      CORS_ALLOWED_ORIGINS: http://127.0.0.1
      VERIFICATION_PROVIDER: disabled
      NOTIFICATIONS_DISABLED: 'true'
      UPLOAD_DIR: /app/uploads
    volumes: [uploads-data:/app/uploads]
    networks: [app, data]
    restart: unless-stopped
    depends_on: {postgres: {condition: service_healthy}}
    healthcheck: {test: [CMD, wget, -qO-, http://127.0.0.1:5000/api/health/ready], interval: 1s, timeout: 1s, retries: 30}
  frontend:
    build: {context: $PWD/frontend, dockerfile: Dockerfile}
    ports: ['127.0.0.1::8080']
    volumes: [$PWD/deploy/lan/nginx.conf:/etc/nginx/conf.d/default.conf:ro]
    networks: [edge, app]
    restart: unless-stopped
    depends_on: {backend: {condition: service_healthy}}
    healthcheck: {test: [CMD, wget, -qO-, http://127.0.0.1:8080/healthz], interval: 1s, timeout: 1s, retries: 30}
networks:
  edge: {}
  app: {internal: true}
  data: {internal: true}
volumes:
  postgres-data: {}
  uploads-data: {}
EOF

compose() { docker compose -p "$project" -f "$compose_file" "$@"; }
compose up -d postgres
count=0; until [ "$(docker inspect --format '{{.State.Health.Status}}' "$(compose ps -q postgres)" 2>/dev/null || true)" = healthy ]; do count=$((count + 1)); [ "$count" -lt 45 ] || exit 1; sleep 1; done
echo 'Disposable Phase 1A.7 identity before bootstrap:'
compose exec -T postgres psql -U postgres -d postgres -At -c 'SELECT current_database(),session_user,current_user,inet_server_addr(),inet_server_port()'
compose run --rm bootstrap >/dev/null
# Minimal uniquely-labelled reference fixtures; no workflow status is forced
# and no development seed is used. The application has no runtime state/service
# creation endpoint, so these two catalogue rows are narrowly inserted here.
compose exec -T postgres psql -U postgres -d "$database" -v ON_ERROR_STOP=1 -c "INSERT INTO \"State\" (id, \"labelAr\", \"labelEn\") VALUES (1, 'ولاية قبول 1A7', 'Phase1A7 State'); INSERT INTO \"ClinicalService\" (id, \"labelAr\", \"labelEn\", category, status, \"baseFeeSdg\", \"baseFeeUsd\") VALUES ('00000000-0000-4000-8000-000000000071', 'تحليل قبول 1A7', '$reference_marker', 'LABORATORY', 'INACTIVE', NULL, NULL);" >/dev/null
# Identity guard negatives must fail before any administrator/audit mutation.
if compose run --rm -e CONFIRM_FIRST_ADMIN_DATABASE= >/dev/null 2>&1; then exit 1; fi
if compose run --rm -e CONFIRM_FIRST_ADMIN_DATABASE=wrong_database >/dev/null 2>&1; then exit 1; fi
if compose run --rm -e LAN_DATABASE_NAME=wrong_database -e CONFIRM_FIRST_ADMIN_DATABASE=wrong_database >/dev/null 2>&1; then exit 1; fi
if compose run --rm -e RUNTIME_LOGIN_ROLE=wrong_runtime >/dev/null 2>&1; then exit 1; fi
identity_rows=$(compose exec -T postgres psql -U postgres -d "$database" -At -c "SELECT (SELECT count(*) FROM \"User\" WHERE role='ADMIN'),(SELECT count(*) FROM \"TenantAuditLog\" WHERE action='FIRST_ADMIN_PROVISIONED')")
[ "$identity_rows" = '0|0' ]

# Two simultaneous attempts prove the advisory lock/serializable guard.
set +e
compose run --rm first-admin >/dev/null 2>&1 & first_pid=$!
compose run --rm first-admin >/dev/null 2>&1 & second_pid=$!
wait "$first_pid"; first_status=$?
wait "$second_pid"; second_status=$?
set -e
[ "$first_status" -eq 0 ] || [ "$second_status" -eq 0 ]
[ "$first_status" -ne 0 ] || [ "$second_status" -ne 0 ]
if compose run --rm first-admin >/dev/null 2>&1; then echo 'Second first-admin provisioning unexpectedly succeeded.' >&2; exit 1; fi

compose up -d backend frontend
count=0; until [ "$(docker inspect --format '{{.State.Health.Status}}' "$(compose ps -q frontend)" 2>/dev/null || true)" = healthy ]; do count=$((count + 1)); [ "$count" -lt 60 ] || { compose logs --tail=100; exit 1; }; sleep 1; done
port=$(compose port frontend 8080 | sed 's/.*://')
origin="http://127.0.0.1:$port"
journey_output="$test_root/clinical-journey.json"
if ! ACCEPTANCE_ORIGIN="$origin" ADMIN_PASSWORD_FILE="$password_file" LAB_SERVICE_LABEL="$reference_marker" PHASE1A7_ACCEPTANCE_CONFIRMATION="$acceptance_confirmation" PHASE1A7_REFERENCE_MARKER="$reference_marker" node "$PWD/deploy/lan/test-disposable-clinical-journey.mjs" >"$journey_output"; then
  compose logs --tail=80 backend >&2
  exit 1
fi
cat "$journey_output"
# Restart only the disposable backend after committed clinical writes, then
# prove same-origin readiness recovers before the final read-only assertions.
compose restart backend >/dev/null
count=0; until [ "$(docker inspect --format '{{.State.Health.Status}}' "$(compose ps -q backend)" 2>/dev/null || true)" = healthy ]; do count=$((count + 1)); [ "$count" -lt 45 ] || exit 1; sleep 1; done
curl -fsS "$origin/api/health/ready" | grep -q '"status":"healthy"'
echo 'Disposable backend restart after committed clinical journey passed.'
for private_service in backend postgres; do
  bindings=$(docker inspect --format '{{json .HostConfig.PortBindings}}' "$(compose ps -q "$private_service")")
  case "$bindings" in null|'{}') :;; *) echo "$private_service unexpectedly publishes a host port." >&2; exit 1;; esac
done
database_assertions=$(compose exec -T postgres psql -U postgres -d "$database" -v ON_ERROR_STOP=1 -At -c "
SELECT
  (SELECT count(*) = 1 FROM \"User\" WHERE role='ADMIN')
  AND (SELECT count(*) = 1 FROM \"TenantAuditLog\" WHERE action='FIRST_ADMIN_PROVISIONED')
  AND (SELECT pg_get_userbyid(c.relowner) = '$owner' FROM pg_class c WHERE c.relname='User')
  AND has_schema_privilege('$runtime_login','public','USAGE')
  AND NOT has_schema_privilege('$runtime_login','public','CREATE');")
[ "$database_assertions" = t ]
echo 'Disposable first-admin, ownership, runtime schema privilege, private-port, and same-origin login checks passed.'

echo 'Disposable Phase 1A.7 identity before cleanup:'
compose exec -T postgres psql -U postgres -d "$database" -At -c 'SELECT current_database(),session_user,current_user,inet_server_addr(),inet_server_port()'
compose down >/dev/null
for volume in $(docker volume ls --filter "label=com.docker.compose.project=$project" --format '{{.Name}}'); do
  case "$volume" in "$project"*) [ "$(docker volume inspect --format '{{index .Labels "com.docker.compose.project"}}' "$volume")" = "$project" ] || exit 1; docker volume rm "$volume" >/dev/null;; *) exit 1;; esac
done
docker image rm "$project-bootstrap" "$project-backend" "$project-frontend" >/dev/null 2>&1 || true
trap - EXIT HUP INT TERM
find "$test_root" -depth -delete
echo "Phase 1A.7 disposable first-admin acceptance passed: project=$project database=$database"
