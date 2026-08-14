#!/bin/sh
set -eu

case "${DATABASE_URL:-}" in
  file:*) database_path=${DATABASE_URL#file:} ;;
  *) echo "DATABASE_URL must use file: for SQLite backup" >&2; exit 1 ;;
esac

case "$database_path" in
  /*) ;;
  *) database_path="./prisma/${database_path#./}" ;;
esac

backup_dir=${BACKUP_DIR:-./backups}
retention_days=${BACKUP_RETENTION_DAYS:-30}
mkdir -p "$backup_dir"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_path="$backup_dir/clinic-$timestamp.db"

sqlite3 "$database_path" ".timeout 10000" ".backup '$backup_path'"
sqlite3 "$backup_path" "PRAGMA integrity_check; PRAGMA foreign_key_check;"
chmod 600 "$backup_path"
find "$backup_dir" -type f -name 'clinic-*.db' -mtime "+$retention_days" -delete
echo "SQLite backup verified: $backup_path"
