#!/bin/sh
set -eu
umask 077

die() { echo "LAN backup failed: $*" >&2; exit 1; }
safe_identifier() { case "$2" in ''|*[!A-Za-z0-9_]*) die "$1 must contain only letters, digits, and underscore";; esac; }
local_host() { case "$1" in postgres|localhost|127.0.0.1|::1) return 0;; *) return 1;; esac; }
cleanup() {
  if [ -n "${gnupg_home-}" ] && [ -d "$gnupg_home" ]; then
    case "$gnupg_home" in /tmp/clinic-lan-backup-gnupg-*) find "$gnupg_home" -depth -delete;; esac
  fi
  [ -n "${work_dir-}" ] && [ -d "$work_dir" ] || return 0
  case "$work_dir" in "$BACKUP_OUTPUT_DIR"/.incomplete-clinic-lan-backup-*) find "$work_dir" -depth -delete;; esac
}
trap cleanup EXIT HUP INT TERM

: "${PGHOST:?PGHOST is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${BACKUP_OUTPUT_DIR:?BACKUP_OUTPUT_DIR is required}"
: "${UPLOADS_DIR:?UPLOADS_DIR is required}"
: "${BACKUP_GPG_PUBLIC_KEY_FILE:?BACKUP_GPG_PUBLIC_KEY_FILE is required}"
: "${BACKUP_GPG_RECIPIENT:?BACKUP_GPG_RECIPIENT is required}"
: "${BACKUP_GPG_SIGNING_PRIVATE_KEY_FILE:?BACKUP_GPG_SIGNING_PRIVATE_KEY_FILE is required}"
: "${BACKUP_GPG_SIGNING_FINGERPRINT:?BACKUP_GPG_SIGNING_FINGERPRINT is required}"
: "${BACKUP_QUIESCE_CONFIRMED:?BACKUP_QUIESCE_CONFIRMED is required}"
[ "$BACKUP_QUIESCE_CONFIRMED" = true ] || die 'BACKUP_QUIESCE_CONFIRMED must be true after application writes have been quiesced'
local_host "$PGHOST" || die 'PGHOST must be postgres, localhost, 127.0.0.1, or ::1'
safe_identifier PGDATABASE "$PGDATABASE"
[ "${PGPORT:-5432}" -ge 1 ] 2>/dev/null && [ "${PGPORT:-5432}" -le 65535 ] 2>/dev/null || die 'PGPORT is invalid'
case "$BACKUP_OUTPUT_DIR" in /*) ;; *) die 'BACKUP_OUTPUT_DIR must be an absolute path';; esac
[ "$BACKUP_OUTPUT_DIR" != / ] || die 'BACKUP_OUTPUT_DIR cannot be /'
[ -d "$BACKUP_OUTPUT_DIR" ] && [ -w "$BACKUP_OUTPUT_DIR" ] && [ ! -L "$BACKUP_OUTPUT_DIR" ] || die 'BACKUP_OUTPUT_DIR must be a writable, non-symlink directory'
case "$UPLOADS_DIR" in /*) ;; *) die 'UPLOADS_DIR must be an absolute path';; esac
[ -d "$UPLOADS_DIR" ] && [ ! -L "$UPLOADS_DIR" ] || die 'UPLOADS_DIR must be a non-symlink directory'
[ -f "$BACKUP_GPG_PUBLIC_KEY_FILE" ] && [ ! -L "$BACKUP_GPG_PUBLIC_KEY_FILE" ] || die 'BACKUP_GPG_PUBLIC_KEY_FILE must be a regular non-symlink file'
[ -f "$BACKUP_GPG_SIGNING_PRIVATE_KEY_FILE" ] && [ ! -L "$BACKUP_GPG_SIGNING_PRIVATE_KEY_FILE" ] || die 'BACKUP_GPG_SIGNING_PRIVATE_KEY_FILE must be a regular non-symlink file'
case "$BACKUP_GPG_RECIPIENT" in *[!A-Fa-f0-9]*|'') die 'BACKUP_GPG_RECIPIENT must be a hexadecimal fingerprint';; esac
case "$BACKUP_GPG_SIGNING_FINGERPRINT" in *[!A-Fa-f0-9]*|'') die 'BACKUP_GPG_SIGNING_FINGERPRINT must be a hexadecimal fingerprint';; esac
case "${APPLICATION_REVISION:-unknown}" in unknown|*[!A-Fa-f0-9]*) [ "${APPLICATION_REVISION:-unknown}" = unknown ] || die 'APPLICATION_REVISION must be a Git hexadecimal revision or unknown';; esac

symlink_path=$(find "$UPLOADS_DIR" -type l -print -quit) || die 'uploads tree could not be inspected safely'
[ -z "$symlink_path" ] || die 'uploads contain a symbolic link; backup refuses links that could escape the upload root'

identity=$(psql --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align --command="SELECT current_database() || '|' || session_user || '|' || current_user || '|' || COALESCE(inet_server_addr()::text, 'local-socket')") || die 'database identity proof failed'
case "$identity" in "$PGDATABASE"'|'*) ;; *) die 'connected database does not equal PGDATABASE';; esac
echo "Backup source identity (database|session user|current user|server): $identity"

backup_id="clinic-lan-backup-$(date -u +%Y%m%dT%H%M%SZ)"
final_dir="$BACKUP_OUTPUT_DIR/$backup_id"
work_dir="$BACKUP_OUTPUT_DIR/.incomplete-$backup_id-$$"
[ ! -e "$final_dir" ] || die "backup set already exists: $backup_id"
mkdir -m 700 "$work_dir"
payload="$work_dir/payload"
mkdir -m 700 "$payload"

pg_dump --format=custom --no-owner --no-privileges --file="$payload/database.dump" || die 'pg_dump failed'
pg_restore --list "$payload/database.dump" >/dev/null || die 'pg_restore could not inspect database dump'
tar --format=pax -cf "$payload/uploads.tar" -C "$UPLOADS_DIR" .
db_hash=$(sha256sum "$payload/database.dump" | awk '{print $1}')
uploads_hash=$(sha256sum "$payload/uploads.tar" | awk '{print $1}')
db_size=$(wc -c < "$payload/database.dump" | tr -d ' ')
uploads_size=$(wc -c < "$payload/uploads.tar" | tr -d ' ')
created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
postgres_version=$(pg_dump --version | sed 's/"/\\"/g')
printf '%s  %s\n%s  %s\n' "$db_hash" database.dump "$uploads_hash" uploads.tar > "$payload/SHA256SUMS"
cat > "$payload/manifest.json" <<EOF
{
  "formatVersion": 1,
  "backupSetId": "$backup_id",
  "createdAt": "$created_at",
  "databaseName": "$PGDATABASE",
  "postgresToolVersion": "$postgres_version",
  "applicationRevision": "${APPLICATION_REVISION:-unknown}",
  "databaseDump": {"filename": "database.dump", "sha256": "$db_hash", "bytes": $db_size, "format": "postgres-custom"},
  "uploadsArchive": {"filename": "uploads.tar", "sha256": "$uploads_hash", "bytes": $uploads_size, "format": "pax-tar"}
}
EOF
(cd "$payload" && sha256sum --check SHA256SUMS >/dev/null) || die 'pre-encryption checksum validation failed'

gnupg_home=$(mktemp -d /tmp/clinic-lan-backup-gnupg-XXXXXX)
chmod 700 "$gnupg_home"
export GNUPGHOME="$gnupg_home"
gpg --batch --quiet --import "$BACKUP_GPG_PUBLIC_KEY_FILE" || die 'public backup key import failed'
gpg --batch --quiet --import "$BACKUP_GPG_SIGNING_PRIVATE_KEY_FILE" || die 'private signing key import failed'
imported_fingerprint=$(gpg --batch --with-colons --fingerprint "$BACKUP_GPG_RECIPIENT" | awk -F: '$1 == "fpr" { print $10; exit }')
[ "$imported_fingerprint" = "$BACKUP_GPG_RECIPIENT" ] || die 'configured backup recipient fingerprint was not imported exactly'
signing_fingerprint=$(gpg --batch --with-colons --list-secret-keys --fingerprint "$BACKUP_GPG_SIGNING_FINGERPRINT" | awk -F: '$1 == "fpr" { print $10; exit }')
[ "$signing_fingerprint" = "$BACKUP_GPG_SIGNING_FINGERPRINT" ] || die 'configured signing private key fingerprint was not imported exactly'

bundle="$work_dir/$backup_id.tar"
tar --format=pax -cf "$bundle" -C "$payload" manifest.json SHA256SUMS database.dump uploads.tar
encrypted="$work_dir/$backup_id.tar.gpg"
signature="$work_dir/$backup_id.tar.gpg.sig"
gpg --batch --yes --trust-model always --recipient "$BACKUP_GPG_RECIPIENT" --output "$encrypted" --encrypt "$bundle" || die 'OpenPGP encryption failed'
[ -s "$encrypted" ] || die 'encrypted backup is empty'
gpg --batch --yes --local-user "$BACKUP_GPG_SIGNING_FINGERPRINT" --output "$signature" --detach-sign "$encrypted" || die 'detached backup signature failed'
[ -s "$signature" ] || die 'detached backup signature is empty'
valid_fingerprint=$(gpg --batch --status-fd 1 --verify "$signature" "$encrypted" 2>/dev/null | awk '$1 == "[GNUPG:]" && $2 == "VALIDSIG" { print $3 }')
[ "$valid_fingerprint" = "$BACKUP_GPG_SIGNING_FINGERPRINT" ] || die 'fresh backup signature fingerprint verification failed'
rm -f "$bundle"
find "$payload" -depth -delete
find "$gnupg_home" -depth -delete
gnupg_home=

mkdir -m 700 "$final_dir"
mv "$encrypted" "$signature" "$final_dir/"
printf 'format=clinic-lan-backup-v1\nid=%s\n' "$backup_id" > "$final_dir/COMPLETE"
chmod 600 "$final_dir/COMPLETE" "$final_dir/$backup_id.tar.gpg" "$final_dir/$backup_id.tar.gpg.sig"
find "$work_dir" -depth -delete
work_dir=
trap - EXIT HUP INT TERM
echo "LAN signed and encrypted backup completed: $final_dir"
