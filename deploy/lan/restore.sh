#!/bin/sh
set -eu
umask 077

die() { echo "DISPOSABLE restore refused: $*" >&2; exit 1; }
local_host() { case "$1" in postgres|localhost|127.0.0.1|::1) return 0;; *) return 1;; esac; }
cleanup() {
  [ -n "${work_dir-}" ] && [ -d "$work_dir" ] || return 0
  case "$work_dir" in /tmp/clinic-lan-phase1a5-restore-*) find "$work_dir" -depth -delete;; esac
}
trap cleanup EXIT HUP INT TERM

: "${BACKUP_SET_DIR:?BACKUP_SET_DIR is required}"
: "${BACKUP_GPG_PRIVATE_KEY_FILE:?BACKUP_GPG_PRIVATE_KEY_FILE is required}"
: "${BACKUP_GPG_SIGNER_PUBLIC_KEY_FILE:?BACKUP_GPG_SIGNER_PUBLIC_KEY_FILE is required}"
: "${BACKUP_GPG_SIGNER_FINGERPRINT:?BACKUP_GPG_SIGNER_FINGERPRINT is required}"
: "${RESTORE_DATABASE_NAME:?RESTORE_DATABASE_NAME is required}"
: "${RESTORE_UPLOADS_DIR:?RESTORE_UPLOADS_DIR is required}"
: "${RESTORE_MIGRATION_LOGIN_ROLE:?RESTORE_MIGRATION_LOGIN_ROLE is required}"
: "${RESTORE_SCHEMA_OWNER_ROLE:?RESTORE_SCHEMA_OWNER_ROLE is required}"
: "${PGHOST:?PGHOST is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${CONFIRM_DISPOSABLE_RESTORE:?CONFIRM_DISPOSABLE_RESTORE is required}"
[ "$CONFIRM_DISPOSABLE_RESTORE" = "$RESTORE_DATABASE_NAME" ] || die 'CONFIRM_DISPOSABLE_RESTORE must exactly equal RESTORE_DATABASE_NAME'
case "$RESTORE_DATABASE_NAME" in clinic_lan_phase1a5_restore_*) restore_suffix=${RESTORE_DATABASE_NAME#clinic_lan_phase1a5_restore_};; *) die 'target must match clinic_lan_phase1a5_restore_[A-Za-z0-9_]+';; esac
case "$restore_suffix" in ''|*[!A-Za-z0-9_]*) die 'target must match clinic_lan_phase1a5_restore_[A-Za-z0-9_]+';; esac
case "$RESTORE_MIGRATION_LOGIN_ROLE:$RESTORE_SCHEMA_OWNER_ROLE" in *[!A-Za-z0-9_:]*|:|*:) die 'restore role names must be identifiers';; esac
case "$BACKUP_GPG_SIGNER_FINGERPRINT" in *[!A-Fa-f0-9]*|'') die 'BACKUP_GPG_SIGNER_FINGERPRINT must be hexadecimal';; esac
local_host "$PGHOST" || die 'PGHOST must be postgres, localhost, 127.0.0.1, or ::1'
export PGDATABASE="$RESTORE_DATABASE_NAME"

case "$BACKUP_SET_DIR" in /*) ;; *) die 'BACKUP_SET_DIR must be absolute';; esac
[ -d "$BACKUP_SET_DIR" ] && [ ! -L "$BACKUP_SET_DIR" ] && [ -f "$BACKUP_SET_DIR/COMPLETE" ] || die 'backup set lacks a regular completed directory/marker'
backup_id=$(basename "$BACKUP_SET_DIR")
case "$backup_id" in clinic-lan-backup-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;; *) die 'backup set name is invalid';; esac
grep -Fxq 'format=clinic-lan-backup-v1' "$BACKUP_SET_DIR/COMPLETE" && grep -Fxq "id=$backup_id" "$BACKUP_SET_DIR/COMPLETE" || die 'completion marker is invalid'
encrypted="$BACKUP_SET_DIR/$backup_id.tar.gpg"
signature="$BACKUP_SET_DIR/$backup_id.tar.gpg.sig"
[ -f "$encrypted" ] && [ ! -L "$encrypted" ] || die 'encrypted backup payload is missing or unsafe'
[ -f "$signature" ] && [ ! -L "$signature" ] || die 'detached backup signature is missing or unsafe'
[ -f "$BACKUP_GPG_PRIVATE_KEY_FILE" ] && [ ! -L "$BACKUP_GPG_PRIVATE_KEY_FILE" ] || die 'private key file is missing or unsafe'
[ -f "$BACKUP_GPG_SIGNER_PUBLIC_KEY_FILE" ] && [ ! -L "$BACKUP_GPG_SIGNER_PUBLIC_KEY_FILE" ] || die 'signer public key file is missing or unsafe'

case "$RESTORE_UPLOADS_DIR" in /tmp/clinic_lan_phase1a5_restore_*/uploads|*/clinic_lan_phase1a5_restore_*/uploads) ;; *) die 'uploads target must be within a dedicated clinic_lan_phase1a5_restore_* path';; esac
[ -d "$RESTORE_UPLOADS_DIR" ] && [ ! -L "$RESTORE_UPLOADS_DIR" ] || die 'uploads target must be an existing non-symlink directory'
empty_probe=$(find "$RESTORE_UPLOADS_DIR" -mindepth 1 -print -quit) || die 'uploads target could not be inspected'
[ -z "$empty_probe" ] || die 'uploads target must be empty'

identity=$(psql --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  --command="SELECT current_database() || '|' || session_user || '|' || current_user || '|' || COALESCE(inet_server_addr()::text, 'local-socket') WHERE current_database() = '$RESTORE_DATABASE_NAME' AND session_user = '$RESTORE_MIGRATION_LOGIN_ROLE' AND current_user = '$RESTORE_SCHEMA_OWNER_ROLE'") || die 'database identity proof failed'
case "$identity" in "$RESTORE_DATABASE_NAME"'|'"$RESTORE_MIGRATION_LOGIN_ROLE"'|'"$RESTORE_SCHEMA_OWNER_ROLE"'|'*) ;; *) die 'restore must connect as migration login with schema owner as current_user';; esac
existing=$(psql --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align --command="SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND c.relkind IN ('r','p','S','v','m')") || die 'target emptiness check failed'
[ "$existing" = 0 ] || die 'target database is not empty/new'
echo "Restore target identity (database|session user|current user|server): $identity"

work_dir=$(mktemp -d /tmp/clinic-lan-phase1a5-restore-XXXXXX)
chmod 700 "$work_dir"
signer_home="$work_dir/signer-gnupg"
decrypt_home="$work_dir/decrypt-gnupg"
payload="$work_dir/payload"
mkdir -m 700 "$signer_home" "$decrypt_home" "$payload"

export GNUPGHOME="$signer_home"
gpg --batch --quiet --import "$BACKUP_GPG_SIGNER_PUBLIC_KEY_FILE" || die 'signer public key import failed'
imported_signer=$(gpg --batch --with-colons --fingerprint "$BACKUP_GPG_SIGNER_FINGERPRINT" | awk -F: '$1 == "fpr" { print $10; exit }')
[ "$imported_signer" = "$BACKUP_GPG_SIGNER_FINGERPRINT" ] || die 'configured signer public key fingerprint was not imported exactly'
valid_signer=$(gpg --batch --status-fd 1 --verify "$signature" "$encrypted" 2>/dev/null | awk '$1 == "[GNUPG:]" && $2 == "VALIDSIG" { print $3 }')
[ "$valid_signer" = "$BACKUP_GPG_SIGNER_FINGERPRINT" ] || die 'detached signature is invalid or from an unexpected signer'

export GNUPGHOME="$decrypt_home"
gpg --batch --quiet --import "$BACKUP_GPG_PRIVATE_KEY_FILE" || die 'private backup key import failed'
gpg --batch --quiet --output "$work_dir/bundle.tar" --decrypt "$encrypted" || die 'OpenPGP authentication/decryption failed'
tar -tf "$work_dir/bundle.tar" | awk '
  /^\// { exit 1 }
  /(^|\/)\.\.($|\/)/ { exit 1 }
  /\\/ { exit 1 }
  { seen[$0]++ }
  END { if (seen["manifest.json"] != 1 || seen["SHA256SUMS"] != 1 || seen["database.dump"] != 1 || seen["uploads.tar"] != 1 || length(seen) != 4) exit 1 }
' || die 'outer archive has unsafe or unexpected members'
tar -xf "$work_dir/bundle.tar" -C "$payload" --no-same-owner --no-same-permissions
grep -Fq '"formatVersion": 1' "$payload/manifest.json" || die 'manifest format is unsupported'
grep -Fq "\"backupSetId\": \"$backup_id\"" "$payload/manifest.json" || die 'manifest backup ID does not match set directory'
(cd "$payload" && sha256sum --check SHA256SUMS >/dev/null) || die 'payload checksum validation failed'
pg_restore --list "$payload/database.dump" >/dev/null || die 'database dump validation failed'
tar -tvf "$payload/uploads.tar" | awk '$1 !~ /^[-d]/ { exit 1 }' || die 'uploads archive contains a link, device, or unsupported member type'
tar -tf "$payload/uploads.tar" | awk '/^\// || /(^|\/)\.\.($|\/)/ || /\\/ { exit 1 }' || die 'uploads archive contains an unsafe path'

pg_restore --exit-on-error --no-owner --no-privileges --dbname="$RESTORE_DATABASE_NAME" "$payload/database.dump" || die 'database restore failed'
tar -xf "$payload/uploads.tar" -C "$RESTORE_UPLOADS_DIR" --no-same-owner --no-same-permissions
echo "Disposable LAN restore completed: database=$RESTORE_DATABASE_NAME uploads=$RESTORE_UPLOADS_DIR"
