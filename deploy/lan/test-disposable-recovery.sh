#!/bin/sh
set -eu
umask 077

suffix="$(date -u +%Y%m%d%H%M%S)_$$"
project="clinic-lan-phase1a6-$suffix"
database="clinic_lan_phase1a6_$suffix"
password="phase1a6-disposable-$suffix"
test_root=$(mktemp -d "$PWD/.local/clinic-lan-phase1a6-XXXXXX")
compose_file="$test_root/compose.yml"

cleanup() {
  docker compose -p "$project" -f "$compose_file" down --remove-orphans >/dev/null 2>&1 || true
  for volume in $(docker volume ls --filter "label=com.docker.compose.project=$project" --format '{{.Name}}'); do
    case "$volume" in "$project"*) [ "$(docker volume inspect --format '{{index .Labels "com.docker.compose.project"}}' "$volume")" = "$project" ] && docker volume rm "$volume" >/dev/null 2>&1 || true;; esac
  done
  for image in "$project-backend" "$project-frontend"; do docker image rm "$image" >/dev/null 2>&1 || true; done
  case "$test_root" in "$PWD"/.local/clinic-lan-phase1a6-*) find "$test_root" -depth -delete 2>/dev/null || true;; esac
}
trap cleanup EXIT HUP INT TERM

cat > "$compose_file" <<EOF
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: $database
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: $password
    volumes: [postgres-data:/var/lib/postgresql/data]
    restart: unless-stopped
    healthcheck:
      test: [CMD-SHELL, 'pg_isready -U postgres -d $database']
      interval: 1s
      timeout: 1s
      retries: 30
  backend:
    build:
      context: $PWD/backend
      dockerfile: Dockerfile
    command: [sh, -c, 'node src/server.js & child=\$\$!; while kill -0 \$\$child 2>/dev/null; do if [ -f /tmp/phase1a6-backend-fail ]; then rm /tmp/phase1a6-backend-fail; kill -KILL \$\$child; wait \$\$child || true; exit 42; fi; sleep 1; done; wait \$\$child']
    environment:
      NODE_ENV: development
      CLINIC_TIME_ZONE: Africa/Khartoum
      PORT: '5000'
      DATABASE_URL: postgresql://postgres:$password@postgres:5432/$database
      SOCKET_REVOCATION_DATABASE_URL: postgresql://postgres:$password@postgres:5432/$database
      SOCKET_REVOCATION_RECONCILE_MS: '1000'
      SOCKET_REVOCATION_UNHEALTHY_GRACE_MS: '1000'
      JWT_SECRET: phase1a6-disposable-jwt-secret-at-least-32-characters
      JWT_ISSUER: clinic-api
      JWT_AUDIENCE: clinic-application
      MEDICAL_ENCRYPTION_KEY: phase1a6-disposable-medical-key-at-least-32-characters
      MFA_ENCRYPTION_KEY: phase1a6-disposable-mfa-key-at-least-32-characters
      MFA_TOTP_ISSUER: Clinic Management System
      CORS_ALLOWED_ORIGINS: http://127.0.0.1
      TRUST_PROXY: 'true'
      VERIFICATION_PROVIDER: disabled
      NOTIFICATIONS_DISABLED: 'true'
      UPLOAD_DIR: /app/uploads
    volumes: [uploads-data:/app/uploads]
    restart: unless-stopped
    depends_on:
      postgres: {condition: service_healthy}
    healthcheck:
      test: [CMD, wget, -qO-, http://127.0.0.1:5000/api/health/ready]
      interval: 1s
      timeout: 1s
      retries: 30
  frontend:
    build:
      context: $PWD/frontend
      dockerfile: Dockerfile
    command: [sh, -c, 'nginx -g "daemon off;" & child=\$\$!; while kill -0 \$\$child 2>/dev/null; do if [ -f /tmp/phase1a6-fail ]; then rm /tmp/phase1a6-fail; kill -TERM \$\$child; wait \$\$child || true; exit 42; fi; sleep 1; done; wait \$\$child']
    ports: ['127.0.0.1::8080']
    volumes: [$PWD/deploy/lan/nginx.conf:/etc/nginx/conf.d/default.conf:ro]
    restart: unless-stopped
    depends_on:
      backend: {condition: service_healthy}
    healthcheck:
      test: [CMD, wget, -qO-, http://127.0.0.1:8080/healthz]
      interval: 1s
      timeout: 1s
      retries: 30
volumes:
  postgres-data:
  uploads-data:
EOF

compose() { docker compose -p "$project" -f "$compose_file" "$@"; }
wait_health() {
  service=$1 count=0
  until [ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$(compose ps -q "$service")" 2>/dev/null || true)" = healthy ]; do
    count=$((count + 1)); [ "$count" -lt 90 ] || { compose ps; compose logs --tail=100; exit 1; }; sleep 1
  done
}
wait_ready() { count=0; until curl -fsS --max-time 2 "$origin/api/health/ready" >/dev/null 2>&1; do count=$((count + 1)); [ "$count" -lt 90 ] || { echo "Same-origin readiness did not recover: $origin" >&2; compose ps >&2; compose logs --tail=100 backend frontend >&2; exit 1; }; sleep 1; done; }
# Docker only activates a container restart policy after the container has
# remained up long enough to be considered successfully started (10 seconds).
arm_restart_policy() { sleep 11; }
wait_restarted() {
  container=$1 previous_started=$2 count=0
  until [ "$(docker inspect --format '{{.State.Status}}' "$container" 2>/dev/null || true)" = running ] &&
        [ "$(docker inspect --format '{{.State.StartedAt}}' "$container" 2>/dev/null || true)" != "$previous_started" ]; do
    count=$((count + 1)); [ "$count" -lt 45 ] || { echo "Container did not restart: $container" >&2; docker inspect --format '{{.State.Status}} {{.State.StartedAt}} {{.RestartCount}}' "$container" >&2 || true; exit 1; }; sleep 1
  done
}
identity() { compose exec -T postgres psql -U postgres -d "$database" -At -c 'SELECT current_database(),session_user,current_user,inet_server_addr(),inet_server_port()'; }

compose up -d postgres
wait_health postgres
echo 'Disposable Phase 1A.6 identity before migrations:'
identity
compose run --rm --no-deps backend npx prisma migrate deploy >/dev/null
compose exec -T postgres psql -U postgres -d "$database" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO "State" (id,"labelAr","labelEn") VALUES (990006,'Disposable','Disposable');
INSERT INTO "Patient" (id,"fullNameAr","fullNameEn",gender,"dateOfBirth",phone,"addressStateId","emergencyContact") VALUES ('phase1a6-patient-one','Recovery Patient','Recovery Patient','FEMALE','1990-01-01','+249900000006',990006,'Disposable');
SQL
first_mrn=$(compose exec -T postgres psql -U postgres -d "$database" -At -c "SELECT \"fileNumber\" FROM \"Patient\" WHERE id='phase1a6-patient-one'")
echo "$first_mrn" | grep -Eq '^SHF-[0-9]{6}$'

compose up -d backend frontend
wait_health backend; wait_health frontend
frontend_port=$(compose port frontend 8080 | sed 's/.*://')
origin="http://127.0.0.1:$frontend_port"
wait_ready; curl -fsS "$origin/healthz" >/dev/null
arm_restart_policy
backend_id=$(compose ps -q backend)
docker exec "$backend_id" sh -c "mkdir -p /app/uploads/recovery && printf 'phase1a6-upload' > /app/uploads/recovery/probe.bin"
upload_hash=$(docker exec "$backend_id" sha256sum /app/uploads/recovery/probe.bin | awk '{print $1}')

backend_started=$(docker inspect --format '{{.State.StartedAt}}' "$backend_id")
docker exec "$backend_id" touch /tmp/phase1a6-backend-fail
wait_restarted "$backend_id" "$backend_started"
wait_health backend; wait_ready
[ "$(docker inspect --format '{{.State.StartedAt}}' "$backend_id")" != "$backend_started" ]
[ "$(compose exec -T postgres psql -U postgres -d "$database" -At -c "SELECT count(*) FROM \"Patient\" WHERE id='phase1a6-patient-one'")" = 1 ]
[ "$(docker exec "$backend_id" sha256sum /app/uploads/recovery/probe.bin | awk '{print $1}')" = "$upload_hash" ]
echo 'Disposable backend SIGKILL restart passed.'

frontend_id=$(compose ps -q frontend); frontend_started=$(docker inspect --format '{{.State.StartedAt}}' "$frontend_id")
docker exec "$frontend_id" touch /tmp/phase1a6-fail
wait_restarted "$frontend_id" "$frontend_started"
frontend_port=$(compose port frontend 8080 | sed 's/.*://')
origin="http://127.0.0.1:$frontend_port"
echo 'Disposable frontend process restarted; waiting for health and same-origin readiness.'
wait_health frontend; wait_ready
[ "$(docker inspect --format '{{.State.StartedAt}}' "$frontend_id")" != "$frontend_started" ]
echo 'Disposable frontend SIGKILL restart passed.'

listener_ready_before=$(compose logs backend | grep -c 'socket.revocation_listener_ready' || true)
postgres_id=$(compose ps -q postgres); postgres_started=$(docker inspect --format '{{.State.StartedAt}}' "$postgres_id")
compose exec -T -u postgres postgres pg_ctl -D /var/lib/postgresql/data stop -m immediate >/dev/null 2>&1 || true
count=0; until [ "$(docker inspect --format '{{.State.Status}}' "$postgres_id")" = running ] && [ "$(docker inspect --format '{{.State.StartedAt}}' "$postgres_id")" != "$postgres_started" ]; do count=$((count + 1)); [ "$count" -lt 30 ] || exit 1; sleep 1; done
docker pause "$postgres_id" >/dev/null
if curl -fsS --max-time 3 "$origin/api/health/ready" >/dev/null 2>&1; then echo 'Readiness falsely healthy while PostgreSQL paused.' >&2; exit 1; fi
docker unpause "$postgres_id" >/dev/null
wait_health postgres; wait_ready
count=0; until [ "$(compose logs backend | grep -c 'socket.revocation_listener_ready' || true)" -gt "$listener_ready_before" ]; do count=$((count + 1)); [ "$count" -lt 30 ] || exit 1; sleep 1; done
compose exec -T postgres psql -U postgres -d "$database" -c "NOTIFY clinic_auth_revocation_v1, 'phase1a6-observable-invalid-event'" >/dev/null
count=0; until compose logs backend | grep -q 'socket.revocation_notification_invalid'; do count=$((count + 1)); [ "$count" -lt 20 ] || exit 1; sleep 1; done
compose exec -T postgres psql -U postgres -d "$database" -c "INSERT INTO \"Patient\" (id,\"fullNameAr\",\"fullNameEn\",gender,\"dateOfBirth\",phone,\"addressStateId\",\"emergencyContact\") VALUES ('phase1a6-patient-two','Recovery Two','Recovery Two','MALE','1991-01-01','+249900000007',990006,'Disposable')" >/dev/null
second_mrn=$(compose exec -T postgres psql -U postgres -d "$database" -At -c "SELECT \"fileNumber\" FROM \"Patient\" WHERE id='phase1a6-patient-two'")
echo "$second_mrn" | grep -Eq '^SHF-[0-9]{6}$'; [ "$second_mrn" != "$first_mrn" ]
echo 'Disposable PostgreSQL restart, readiness, MRN, and revocation reconnection passed.'

compose up -d --force-recreate --no-deps backend >/dev/null
wait_health backend; wait_ready
backend_id=$(compose ps -q backend)
[ "$(docker exec "$backend_id" sha256sum /app/uploads/recovery/probe.bin | awk '{print $1}')" = "$upload_hash" ]
echo 'Disposable backend recreation retained upload hash and same-origin routing.'
arm_restart_policy
backend_started=$(docker inspect --format '{{.State.StartedAt}}' "$backend_id")
docker exec "$backend_id" sh -c 'kill -TERM $(pidof node)' >/dev/null 2>&1 || true
sleep 3
if [ "$(docker inspect --format '{{.State.Status}}' "$backend_id" 2>/dev/null || true)" != running ]; then compose start backend >/dev/null; fi
wait_restarted "$backend_id" "$backend_started"
echo 'Disposable backend completed its SIGTERM restart transition.'
wait_health backend; wait_ready
if ! compose logs --no-color backend | grep -q 'server.shutdown_complete'; then
  echo 'Backend SIGTERM did not log a completed graceful shutdown.' >&2
  compose logs --tail=100 backend >&2
  exit 1
fi
echo 'Disposable upload recreation and graceful SIGTERM restart passed.'

echo 'Disposable Phase 1A.6 identity before cleanup:'
identity
compose down >/dev/null
for volume in $(docker volume ls --filter "label=com.docker.compose.project=$project" --format '{{.Name}}'); do
  case "$volume" in "$project"*) [ "$(docker volume inspect --format '{{index .Labels "com.docker.compose.project"}}' "$volume")" = "$project" ] || exit 1; docker volume rm "$volume" >/dev/null;; *) exit 1;; esac
done
docker image rm "$project-backend" "$project-frontend" >/dev/null 2>&1 || true
trap - EXIT HUP INT TERM
find "$test_root" -depth -delete
echo "Phase 1A.6 disposable recovery passed: project=$project database=$database"
