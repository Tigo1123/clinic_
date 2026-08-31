#!/bin/sh
set -eu
umask 077

die() { echo "LAN backup retention refused: $*" >&2; exit 1; }
: "${BACKUP_OUTPUT_DIR:?BACKUP_OUTPUT_DIR is required}"
: "${BACKUP_RETENTION_COUNT:?BACKUP_RETENTION_COUNT is required}"
: "${BACKUP_GPG_SIGNER_PUBLIC_KEY_FILE:?BACKUP_GPG_SIGNER_PUBLIC_KEY_FILE is required}"
: "${BACKUP_GPG_SIGNER_FINGERPRINT:?BACKUP_GPG_SIGNER_FINGERPRINT is required}"
case "$BACKUP_OUTPUT_DIR" in /*) ;; *) die 'BACKUP_OUTPUT_DIR must be absolute';; esac
[ "$BACKUP_OUTPUT_DIR" != / ] && [ -d "$BACKUP_OUTPUT_DIR" ] && [ ! -L "$BACKUP_OUTPUT_DIR" ] || die 'backup root is unsafe'
[ -f "$BACKUP_GPG_SIGNER_PUBLIC_KEY_FILE" ] && [ ! -L "$BACKUP_GPG_SIGNER_PUBLIC_KEY_FILE" ] || die 'signer public key is unsafe'
case "$BACKUP_GPG_SIGNER_FINGERPRINT" in ''|*[!A-Fa-f0-9]*) die 'signer fingerprint must be hexadecimal';; esac
case "$BACKUP_RETENTION_COUNT" in ''|*[!0-9]*) die 'BACKUP_RETENTION_COUNT must be an integer';; esac
[ "$BACKUP_RETENTION_COUNT" -ge 1 ] || die 'at least the newest cryptographically valid backup must be retained'
dry_run=${BACKUP_RETENTION_DRY_RUN:-true}
[ "$dry_run" = true ] || [ "$dry_run" = false ] || die 'BACKUP_RETENTION_DRY_RUN must be true or false'

valid_list=$(mktemp /tmp/clinic-lan-retention-list-XXXXXX)
gnupg_home=$(mktemp -d /tmp/clinic-lan-retention-gnupg-XXXXXX)
cleanup() { rm -f "$valid_list"; case "$gnupg_home" in /tmp/clinic-lan-retention-gnupg-*) find "$gnupg_home" -depth -delete;; esac; }
trap cleanup EXIT HUP INT TERM
chmod 700 "$gnupg_home"
export GNUPGHOME="$gnupg_home"
gpg --batch --quiet --import "$BACKUP_GPG_SIGNER_PUBLIC_KEY_FILE" || die 'signer public key import failed'
imported_signer=$(gpg --batch --with-colons --fingerprint "$BACKUP_GPG_SIGNER_FINGERPRINT" | awk -F: '$1 == "fpr" { print $10; exit }')
[ "$imported_signer" = "$BACKUP_GPG_SIGNER_FINGERPRINT" ] || die 'configured signer fingerprint was not imported exactly'

find "$BACKUP_OUTPUT_DIR" -mindepth 1 -maxdepth 1 -type d -name 'clinic-lan-backup-????????T??????Z' -print | sort -r | while IFS= read -r candidate; do
  name=$(basename "$candidate")
  encrypted="$candidate/$name.tar.gpg"
  signature="$candidate/$name.tar.gpg.sig"
  [ -f "$candidate/COMPLETE" ] && [ -f "$encrypted" ] && [ -f "$signature" ] || continue
  grep -Fxq 'format=clinic-lan-backup-v1' "$candidate/COMPLETE" && grep -Fxq "id=$name" "$candidate/COMPLETE" || continue
  valid_signer=$(gpg --batch --status-fd 1 --verify "$signature" "$encrypted" 2>/dev/null | awk '$1 == "[GNUPG:]" && $2 == "VALIDSIG" { print $3 }')
  [ "$valid_signer" = "$BACKUP_GPG_SIGNER_FINGERPRINT" ] || continue
  printf '%s\n' "$candidate"
done > "$valid_list"

index=0
while IFS= read -r candidate; do
  index=$((index + 1))
  [ "$index" -gt "$BACKUP_RETENTION_COUNT" ] || continue
  case "$candidate" in "$BACKUP_OUTPUT_DIR"/clinic-lan-backup-????????T??????Z) ;; *) die 'candidate escaped validated backup naming';; esac
  if [ "$dry_run" = true ]; then
    echo "Would remove cryptographically valid completed backup: $candidate"
  else
    find "$candidate" -depth -delete
    echo "Removed cryptographically valid completed backup: $candidate"
  fi
done < "$valid_list"
