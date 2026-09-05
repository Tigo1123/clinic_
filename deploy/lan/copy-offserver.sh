#!/bin/sh
set -eu
umask 077

die() { echo "Off-server copy refused: $*" >&2; exit 1; }
: "${BACKUP_SET_DIR:?BACKUP_SET_DIR is required}"
: "${OFFSERVER_BACKUP_ROOT:?OFFSERVER_BACKUP_ROOT is required}"
: "${BACKUP_GPG_SIGNER_PUBLIC_KEY_FILE:?BACKUP_GPG_SIGNER_PUBLIC_KEY_FILE is required}"
: "${BACKUP_GPG_SIGNER_FINGERPRINT:?BACKUP_GPG_SIGNER_FINGERPRINT is required}"
case "$BACKUP_SET_DIR:$OFFSERVER_BACKUP_ROOT" in /*:/*) ;; *) die 'source and destination must be absolute paths';; esac
[ -d "$BACKUP_SET_DIR" ] && [ ! -L "$BACKUP_SET_DIR" ] || die 'source set is unsafe'
[ -d "$OFFSERVER_BACKUP_ROOT" ] && [ ! -L "$OFFSERVER_BACKUP_ROOT" ] && [ -w "$OFFSERVER_BACKUP_ROOT" ] || die 'destination root is unsafe or not writable'
[ "$(stat -c %d "$BACKUP_SET_DIR")" != "$(stat -c %d "$OFFSERVER_BACKUP_ROOT")" ] || die 'destination must be on an independently mounted filesystem'
case "$BACKUP_GPG_SIGNER_FINGERPRINT" in ''|*[!A-Fa-f0-9]*) die 'signer fingerprint must be hexadecimal';; esac
name=$(basename "$BACKUP_SET_DIR")
case "$name" in clinic-lan-backup-????????T??????Z) ;; *) die 'source set name is invalid';; esac
encrypted="$BACKUP_SET_DIR/$name.tar.gpg"; signature="$BACKUP_SET_DIR/$name.tar.gpg.sig"
for file in "$BACKUP_SET_DIR/COMPLETE" "$encrypted" "$signature" "$BACKUP_GPG_SIGNER_PUBLIC_KEY_FILE"; do [ -f "$file" ] && [ ! -L "$file" ] || die 'required source file is missing or unsafe'; done
grep -Fxq 'format=clinic-lan-backup-v1' "$BACKUP_SET_DIR/COMPLETE" && grep -Fxq "id=$name" "$BACKUP_SET_DIR/COMPLETE" || die 'completion marker is invalid'
gnupg_home=$(mktemp -d /tmp/clinic-lan-offserver-gnupg-XXXXXX); work="$OFFSERVER_BACKUP_ROOT/.incomplete-$name-$$"
cleanup() { case "$gnupg_home" in /tmp/clinic-lan-offserver-gnupg-*) find "$gnupg_home" -depth -delete;; esac; [ ! -d "$work" ] || find "$work" -depth -delete; }
trap cleanup EXIT HUP INT TERM
chmod 700 "$gnupg_home"; export GNUPGHOME="$gnupg_home"
gpg --batch --quiet --import "$BACKUP_GPG_SIGNER_PUBLIC_KEY_FILE" || die 'signer public key import failed'
imported=$(gpg --batch --with-colons --fingerprint "$BACKUP_GPG_SIGNER_FINGERPRINT" | awk -F: '$1=="fpr" {print $10; exit}')
[ "$imported" = "$BACKUP_GPG_SIGNER_FINGERPRINT" ] || die 'configured signer fingerprint was not imported exactly'
valid=$(gpg --batch --status-fd 1 --verify "$signature" "$encrypted" 2>/dev/null | awk '$1=="[GNUPG:]" && $2=="VALIDSIG" {print $3}')
[ "$valid" = "$BACKUP_GPG_SIGNER_FINGERPRINT" ] || die 'source signature is invalid or unexpected'
[ ! -e "$OFFSERVER_BACKUP_ROOT/$name" ] || die 'destination set already exists'
mkdir -m 700 "$work"; cp "$encrypted" "$signature" "$work/"
cmp -s "$encrypted" "$work/$name.tar.gpg" && cmp -s "$signature" "$work/$name.tar.gpg.sig" || die 'copied bytes differ from source'
cp "$BACKUP_SET_DIR/COMPLETE" "$work/COMPLETE"; chmod 600 "$work"/*; mv "$work" "$OFFSERVER_BACKUP_ROOT/$name"
work=; trap - EXIT HUP INT TERM; find "$gnupg_home" -depth -delete
echo "Verified off-server copy completed: $OFFSERVER_BACKUP_ROOT/$name"
