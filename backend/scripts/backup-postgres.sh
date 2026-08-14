#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
case "$DATABASE_URL" in
  postgres://*|postgresql://*) ;;
  *) echo "DATABASE_URL must use PostgreSQL for backup" >&2; exit 1 ;;
esac

backup_dir=${BACKUP_DIR:-./backups}
retention_days=${BACKUP_RETENTION_DAYS:-30}
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$backup_dir"
umask 077
backup_path="$backup_dir/clinic-$timestamp.dump"

pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-privileges --file="$backup_path"
pg_restore --list "$backup_path" >/dev/null
find "$backup_dir" -type f -name 'clinic-*.dump' -mtime "+$retention_days" -delete
echo "PostgreSQL backup verified: $backup_path"
