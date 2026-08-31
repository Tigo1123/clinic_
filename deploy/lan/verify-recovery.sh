#!/bin/sh
set -eu

die() { echo "LAN recovery verification failed: $*" >&2; exit 1; }
: "${RECOVERY_ORIGIN:?RECOVERY_ORIGIN is required, for example http://clinic-server.example.internal:8080}"
COMPOSE_FILE=${COMPOSE_FILE:-compose.lan.yml}
: "${COMPOSE_ENV_FILE:?COMPOSE_ENV_FILE must point to the protected LAN environment file}"

compose() { docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
case "$RECOVERY_ORIGIN" in http://*|https://*) ;; *) die 'RECOVERY_ORIGIN must be an HTTP(S) origin';; esac

for service in postgres backend frontend; do
  container=$(compose ps --quiet "$service")
  [ -n "$container" ] || die "$service has no Compose container"
  [ "$(docker inspect --format '{{.State.Status}}' "$container")" = running ] || die "$service is not running"
  [ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container")" = healthy ] || die "$service is not healthy"
done

postgres_container=$(compose ps --quiet postgres)
backend_container=$(compose ps --quiet backend)
[ "$(docker inspect --format '{{json .HostConfig.PortBindings}}' "$postgres_container")" = null ] || die 'PostgreSQL unexpectedly publishes a host port'
[ "$(docker inspect --format '{{json .HostConfig.PortBindings}}' "$backend_container")" = null ] || die 'backend unexpectedly publishes a host port'
docker inspect --format '{{range .Mounts}}{{if and (eq .Type "volume") (eq .Destination "/var/lib/postgresql/data")}}{{.Name}}{{end}}{{end}}' "$postgres_container" | grep -q . || die 'PostgreSQL persistent volume is missing'
docker inspect --format '{{range .Mounts}}{{if and (eq .Type "volume") (eq .Destination "/app/uploads")}}{{.Name}}{{end}}{{end}}' "$backend_container" | grep -q . || die 'uploads persistent volume is missing'

fetch() {
  if command -v curl >/dev/null 2>&1; then curl --fail --silent --show-error --max-time 10 "$1" >/dev/null
  elif command -v wget >/dev/null 2>&1; then wget -q -T 10 -O /dev/null "$1"
  else die 'curl or wget is required'; fi
}
fetch "$RECOVERY_ORIGIN/healthz" || die 'frontend health endpoint failed'
fetch "$RECOVERY_ORIGIN/api/health/ready" || die 'same-origin backend readiness failed'
echo 'LAN recovery verification passed: services, health, private ports, and persistent mounts are intact.'
