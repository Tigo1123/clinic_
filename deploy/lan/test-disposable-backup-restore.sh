#!/bin/sh
set -eu
umask 077

suffix="$(date -u +%Y%m%d%H%M%S)_$$"
source_db="clinic_lan_phase1a5_source_$suffix"
restore_db="clinic_lan_phase1a5_restore_$suffix"
source_container="clinic-lan-phase1a5-source-$suffix"
restore_container="clinic-lan-phase1a5-restore-$suffix"
upload_container="clinic-lan-phase1a5-uploads-$suffix"
source_volume="clinic-lan-phase1a5-source-$suffix"
restore_volume="clinic-lan-phase1a5-restore-$suffix"
upload_volume="clinic-lan-phase1a5-uploads-$suffix"
tool_image="clinic-lan-phase1a5-tools:$suffix"
admin_password="phase1a5-admin-$suffix"
migration_password="phase1a5-migration-$suffix"
runtime_password="phase1a5-runtime-$suffix"
source_owner="p1a5_src_owner_$suffix"
source_migration="p1a5_src_migration_$suffix"
source_runtime_role="p1a5_src_runtime_role_$suffix"
source_runtime_login="p1a5_src_runtime_login_$suffix"
restore_owner="p1a5_rst_owner_$suffix"
restore_migration="p1a5_rst_migration_$suffix"
restore_runtime_role="p1a5_rst_runtime_role_$suffix"
restore_runtime_login="p1a5_rst_runtime_login_$suffix"
mkdir -p .local
test_root=$(mktemp -d "$PWD/.local/clinic-lan-phase1a5-e2e-XXXXXX")

cleanup() {
  for target in "$source_container" "$restore_container" "$upload_container"; do case "$target" in clinic-lan-phase1a5-*) docker rm -f "$target" >/dev/null 2>&1 || true;; esac; done
  for target in "$source_volume" "$restore_volume" "$upload_volume"; do case "$target" in clinic-lan-phase1a5-*) docker volume rm "$target" >/dev/null 2>&1 || true;; esac; done
  case "$tool_image" in clinic-lan-phase1a5-tools:*) docker image rm "$tool_image" >/dev/null 2>&1 || true;; esac
  case "$test_root" in "$PWD"/.local/clinic-lan-phase1a5-e2e-*) find "$test_root" -depth -delete 2>/dev/null || true;; esac
}
trap cleanup EXIT HUP INT TERM
docker build --file deploy/lan/Dockerfile.backup --tag "$tool_image" . >/dev/null

wait_for_database() {
  port=$1 database=$2 count=0
  until PGPASSWORD="$admin_password" pg_isready -h 127.0.0.1 -p "$port" -U postgres -d "$database" >/dev/null 2>&1; do
    count=$((count + 1)); [ "$count" -lt 60 ] || { echo 'Disposable PostgreSQL did not become ready.' >&2; exit 1; }; sleep 1
  done
}
prove_database() {
  PGPASSWORD="$admin_password" psql --no-psqlrc -v ON_ERROR_STOP=1 -At -h 127.0.0.1 -p "$1" -U postgres -d "$2" \
    -c "SELECT current_database(), session_user, current_user, inet_server_addr(), inet_server_port()"
}
admin_psql() { apsql_port=$1 apsql_database=$2; shift 2; PGPASSWORD="$admin_password" psql --no-psqlrc -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$apsql_port" -U postgres -d "$apsql_database" "$@"; }
configure_roles() {
  cfr_port=$1 cfr_database=$2 cfr_owner=$3 cfr_migration=$4 cfr_runtime_role=$5 cfr_runtime_login=$6
  MIGRATION_DATABASE_PASSWORD="$migration_password" RUNTIME_DATABASE_PASSWORD="$runtime_password" admin_psql "$cfr_port" postgres \
    --set=database_name="$cfr_database" --set=schema_owner_role="$cfr_owner" --set=migration_login_role="$cfr_migration" --set=runtime_role="$cfr_runtime_role" --set=runtime_login_role="$cfr_runtime_login" \
    --file=deploy/lan/sql/create-roles-and-database.sql
  admin_psql "$cfr_port" "$cfr_database" --set=database_name="$cfr_database" --set=schema_name=public --set=schema_owner_role="$cfr_owner" \
    --set=migration_login_role="$cfr_migration" --set=runtime_role="$cfr_runtime_role" --set=runtime_login_role="$cfr_runtime_login" --file=deploy/lan/sql/configure-database.sql
}
empty_public_tables() { PGPASSWORD="$admin_password" psql -At -h 127.0.0.1 -p "$1" -U postgres -d "$2" -c "SELECT count(*) FROM pg_tables WHERE schemaname='public'"; }
apply_migrations_as_owner() {
  migration_url=$1 port=$2 database=$3 migration_login=$4
  [ "$(PGOPTIONS="-c role=$source_owner" psql "$migration_url" -At -c "SELECT session_user || '|' || current_user")" = "$migration_login|$source_owner" ] || { echo 'Migration owner identity was not established.' >&2; exit 1; }
  PGOPTIONS="-c role=$source_owner" psql "$migration_url" -v ON_ERROR_STOP=1 <<'SQL'
SELECT session_user, current_user, current_schema(), pg_get_userbyid(nspowner) AS schema_owner FROM pg_namespace WHERE nspname='public';
CREATE TABLE "_prisma_migrations" (
  id VARCHAR(36) PRIMARY KEY NOT NULL,
  checksum VARCHAR(64) NOT NULL,
  finished_at TIMESTAMPTZ,
  migration_name VARCHAR(255) NOT NULL,
  logs TEXT,
  rolled_back_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_steps_count INTEGER NOT NULL DEFAULT 0
);
SQL
  sequence=0
  for migration_file in backend/prisma/migrations/*/migration.sql; do
    sequence=$((sequence + 1)); migration_name=$(basename "$(dirname "$migration_file")"); checksum=$(sha256sum "$migration_file" | awk '{print $1}')
    PGOPTIONS="-c role=$source_owner" psql "$migration_url" -v ON_ERROR_STOP=1 -f "$migration_file" >/dev/null
    case "$migration_name:$checksum" in *[!A-Za-z0-9_:]*) echo 'Unsafe migration metadata.' >&2; exit 1;; esac
    PGOPTIONS="-c role=$source_owner" psql "$migration_url" -v ON_ERROR_STOP=1 \
      -c "INSERT INTO \"_prisma_migrations\" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ('phase1a5-$sequence', '$checksum', now(), '$migration_name', 1)" >/dev/null
  done
  admin_psql "$port" "$database" -c "GRANT USAGE ON SCHEMA public TO \"$migration_login\"; GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.\"_prisma_migrations\" TO \"$migration_login\"" >/dev/null
  (cd backend && DATABASE_URL="postgresql://$migration_login:$migration_password@127.0.0.1:$port/$database" npx prisma migrate deploy >/dev/null)
  admin_psql "$port" "$database" -c "REVOKE ALL ON TABLE public.\"_prisma_migrations\" FROM \"$migration_login\"; REVOKE USAGE ON SCHEMA public FROM \"$migration_login\"" >/dev/null
}

docker volume create "$source_volume" >/dev/null
docker run -d --name "$source_container" --mount "source=$source_volume,target=/var/lib/postgresql/data" -e POSTGRES_DB="$source_db" -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD="$admin_password" -p 127.0.0.1::5432 postgres:16-alpine >/dev/null
source_port=$(docker port "$source_container" 5432/tcp | sed 's/.*://')
wait_for_database "$source_port" "$source_db"
echo 'Disposable source identity before role bootstrap and migration:'
prove_database "$source_port" "$source_db"
configure_roles "$source_port" "$source_db" "$source_owner" "$source_migration" "$source_runtime_role" "$source_runtime_login"
source_migration_url="postgresql://$source_migration:$migration_password@127.0.0.1:$source_port/$source_db?options=-c%20role%3D$source_owner"
source_runtime_url="postgresql://$source_runtime_login:$runtime_password@127.0.0.1:$source_port/$source_db"
apply_migrations_as_owner "$source_migration_url" "$source_port" "$source_db" "$source_migration"
PGOPTIONS="-c role=$source_owner" PGPASSWORD="$migration_password" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$source_port" -U "$source_migration" -d "$source_db" --set=schema_name=public --set=runtime_role="$source_runtime_role" --file=deploy/lan/sql/grant-runtime.sql
MIGRATION_DATABASE_URL="$source_migration_url" RUNTIME_DATABASE_ROLE="$source_runtime_role" DATABASE_SCHEMA=public backend/scripts/provision-patient-mrn-sequence.sh
PGPASSWORD="$runtime_password" psql --no-psqlrc -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$source_port" -U "$source_runtime_login" -d "$source_db" <<'SQL'
INSERT INTO "State" (id, "labelAr", "labelEn") VALUES (990001, 'Disposable', 'Disposable');
INSERT INTO "Patient" (id, "fullNameAr", "fullNameEn", gender, "dateOfBirth", phone, "addressStateId", "emergencyContact") VALUES ('phase1a5-patient-source', 'Disposable Patient', 'Disposable Patient', 'FEMALE', '1990-01-01', '+249900000001', 990001, 'Disposable Contact');
INSERT INTO "Consent" (id, "patientId", "consentType") VALUES ('phase1a5-consent-source', 'phase1a5-patient-source', 'EMR_ACCESS');
SQL
source_mrn=$(PGPASSWORD="$runtime_password" psql -At -h 127.0.0.1 -p "$source_port" -U "$source_runtime_login" -d "$source_db" -c "SELECT \"fileNumber\" FROM \"Patient\" WHERE id='phase1a5-patient-source'")
echo "$source_mrn" | grep -Eq '^SHF-[0-9]{6}$'

docker rm -f "$source_container" >/dev/null
docker run -d --name "$source_container" --mount "source=$source_volume,target=/var/lib/postgresql/data" -e POSTGRES_DB="$source_db" -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD="$admin_password" -p 127.0.0.1::5432 postgres:16-alpine >/dev/null
source_port=$(docker port "$source_container" 5432/tcp | sed 's/.*://'); wait_for_database "$source_port" "$source_db"; prove_database "$source_port" "$source_db"
[ "$(PGPASSWORD="$runtime_password" psql -At -h 127.0.0.1 -p "$source_port" -U "$source_runtime_login" -d "$source_db" -c "SELECT count(*) FROM \"Patient\" WHERE id='phase1a5-patient-source'")" = 1 ]
source_migration_url="postgresql://$source_migration:$migration_password@127.0.0.1:$source_port/$source_db?options=-c%20role%3D$source_owner"

mkdir -p "$test_root/uploads/nested" "$test_root/backups" "$test_root/restored/clinic_lan_phase1a5_restore_$suffix/uploads"
printf 'phase1a5 attachment\n' > "$test_root/uploads/attachment.txt"; printf '\001\002\003\377' > "$test_root/uploads/nested/attachment.bin"; : > "$test_root/uploads/nested/empty.dat"
upload_hashes=$(cd "$test_root/uploads" && find . -type f -print0 | sort -z | xargs -0 sha256sum)
docker volume create "$upload_volume" >/dev/null
docker run -d --name "$upload_container" --mount "source=$upload_volume,target=/uploads" postgres:16-alpine sleep 600 >/dev/null
docker cp "$test_root/uploads/." "$upload_container:/uploads/"; docker rm -f "$upload_container" >/dev/null
docker run -d --name "$upload_container" --mount "source=$upload_volume,target=/uploads" postgres:16-alpine sleep 600 >/dev/null
docker cp "$upload_container:/uploads/." "$test_root/uploads-after-recreate"
[ "$upload_hashes" = "$(cd "$test_root/uploads-after-recreate" && find . -type f -print0 | sort -z | xargs -0 sha256sum)" ]

for home in decrypt sign wrong-decrypt wrong-sign; do mkdir -m 700 "$test_root/$home-gnupg"; done
GNUPGHOME="$test_root/decrypt-gnupg" gpg --batch --passphrase '' --quick-generate-key "Disposable encryption $suffix" rsa2048 encrypt 0 >/dev/null 2>&1
decrypt_fp=$(GNUPGHOME="$test_root/decrypt-gnupg" gpg --with-colons --fingerprint | awk -F: '$1=="fpr" {print $10; exit}')
GNUPGHOME="$test_root/decrypt-gnupg" gpg --armor --export "$decrypt_fp" > "$test_root/encryption-public.asc"
GNUPGHOME="$test_root/decrypt-gnupg" gpg --armor --export-secret-keys "$decrypt_fp" > "$test_root/decryption-private.asc"
GNUPGHOME="$test_root/sign-gnupg" gpg --batch --passphrase '' --quick-generate-key "Disposable signer $suffix" rsa2048 sign 0 >/dev/null 2>&1
signer_fp=$(GNUPGHOME="$test_root/sign-gnupg" gpg --with-colons --fingerprint | awk -F: '$1=="fpr" {print $10; exit}')
GNUPGHOME="$test_root/sign-gnupg" gpg --armor --export "$signer_fp" > "$test_root/signer-public.asc"
GNUPGHOME="$test_root/sign-gnupg" gpg --armor --export-secret-keys "$signer_fp" > "$test_root/signing-private.asc"
GNUPGHOME="$test_root/wrong-decrypt-gnupg" gpg --batch --passphrase '' --quick-generate-key "Wrong decrypt $suffix" rsa2048 encrypt 0 >/dev/null 2>&1
wrong_decrypt_fp=$(GNUPGHOME="$test_root/wrong-decrypt-gnupg" gpg --with-colons --fingerprint | awk -F: '$1=="fpr" {print $10; exit}')
GNUPGHOME="$test_root/wrong-decrypt-gnupg" gpg --armor --export-secret-keys "$wrong_decrypt_fp" > "$test_root/wrong-decryption-private.asc"
GNUPGHOME="$test_root/wrong-sign-gnupg" gpg --batch --passphrase '' --quick-generate-key "Wrong signer $suffix" rsa2048 sign 0 >/dev/null 2>&1
wrong_signer_fp=$(GNUPGHOME="$test_root/wrong-sign-gnupg" gpg --with-colons --fingerprint | awk -F: '$1=="fpr" {print $10; exit}')
GNUPGHOME="$test_root/wrong-sign-gnupg" gpg --armor --export "$wrong_signer_fp" > "$test_root/wrong-signer-public.asc"
GNUPGHOME="$test_root/wrong-sign-gnupg" gpg --armor --export-secret-keys "$wrong_signer_fp" > "$test_root/wrong-signing-private.asc"

chmod 755 "$test_root" "$test_root/uploads" "$test_root/uploads/nested"; chmod 777 "$test_root/backups"
find "$test_root/uploads" -type f -exec chmod 644 {} \;
chmod 755 "$test_root/restored" "$test_root/restored/clinic_lan_phase1a5_restore_$suffix"; chmod 777 "$test_root/restored/clinic_lan_phase1a5_restore_$suffix/uploads"
chmod 644 "$test_root"/*.asc

docker run --rm --user 0:0 --network host -v "$test_root:$test_root:z" -e PGHOST=127.0.0.1 -e PGPORT="$source_port" -e PGDATABASE="$source_db" -e PGUSER="$source_migration" -e PGPASSWORD="$migration_password" -e PGOPTIONS="-c role=$source_owner" \
  -e BACKUP_OUTPUT_DIR="$test_root/backups" -e UPLOADS_DIR="$test_root/uploads" -e BACKUP_GPG_PUBLIC_KEY_FILE="$test_root/encryption-public.asc" -e BACKUP_GPG_RECIPIENT="$decrypt_fp" \
  -e BACKUP_GPG_SIGNING_PRIVATE_KEY_FILE="$test_root/signing-private.asc" -e BACKUP_GPG_SIGNING_FINGERPRINT="$signer_fp" -e BACKUP_QUIESCE_CONFIRMED=true -e APPLICATION_REVISION=aad24fd "$tool_image"
docker run --rm --user 0:0 -v "$test_root:$test_root:z" --entrypoint /bin/sh "$tool_image" -c "find '$test_root/backups' -type d -exec chmod 777 {} \\; && find '$test_root/backups' -type f -exec chmod 644 {} \\;"
backup_set=$(find "$test_root/backups" -mindepth 1 -maxdepth 1 -type d -name 'clinic-lan-backup-*' -print); backup_id=$(basename "$backup_set")
[ -f "$backup_set/$backup_id.tar.gpg.sig" ] && [ -f "$backup_set/COMPLETE" ]

echo 'Disposable source identity before destruction:'; prove_database "$source_port" "$source_db"
docker rm -f "$source_container" >/dev/null; docker volume rm "$source_volume" >/dev/null

docker volume create "$restore_volume" >/dev/null
docker run -d --name "$restore_container" --mount "source=$restore_volume,target=/var/lib/postgresql/data" -e POSTGRES_DB="$restore_db" -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD="$admin_password" -p 127.0.0.1::5432 postgres:16-alpine >/dev/null
restore_port=$(docker port "$restore_container" 5432/tcp | sed 's/.*://'); wait_for_database "$restore_port" "$restore_db"
echo 'Disposable restore identity before role bootstrap:'; prove_database "$restore_port" "$restore_db"
configure_roles "$restore_port" "$restore_db" "$restore_owner" "$restore_migration" "$restore_runtime_role" "$restore_runtime_login"
restore_uploads="$test_root/restored/clinic_lan_phase1a5_restore_$suffix/uploads"

restore_run() {
  set_dir=$1 decrypt_key=$2 signer_key=$3 expected_signer=$4
  docker run --rm --user 0:0 --network host -v "$test_root:$test_root:z" --entrypoint /usr/local/bin/clinic-lan-restore \
    -e PGHOST=127.0.0.1 -e PGPORT="$restore_port" -e PGUSER="$restore_migration" -e PGPASSWORD="$migration_password" -e PGOPTIONS="-c role=$restore_owner" -e BACKUP_SET_DIR="$set_dir" \
    -e BACKUP_GPG_PRIVATE_KEY_FILE="$decrypt_key" -e BACKUP_GPG_SIGNER_PUBLIC_KEY_FILE="$signer_key" -e BACKUP_GPG_SIGNER_FINGERPRINT="$expected_signer" \
    -e RESTORE_DATABASE_NAME="$restore_db" -e RESTORE_UPLOADS_DIR="$restore_uploads" -e RESTORE_MIGRATION_LOGIN_ROLE="$restore_migration" -e RESTORE_SCHEMA_OWNER_ROLE="$restore_owner" \
    -e CONFIRM_DISPOSABLE_RESTORE="$restore_db" "$tool_image"
}
copy_set() { root=$1; mkdir -p "$root/$backup_id"; cp "$backup_set"/* "$root/$backup_id/"; printf '%s' "$root/$backup_id"; }
expect_crypto_refusal() { label=$1 set_dir=$2 key=$3 signer_key=$4 expected=$5; if restore_run "$set_dir" "$key" "$signer_key" "$expected" >/dev/null 2>&1; then echo "$label unexpectedly succeeded" >&2; exit 1; fi; [ "$(empty_public_tables "$restore_port" "$restore_db")" = 0 ]; echo "$label refused before mutation."; }

expect_crypto_refusal 'Wrong decryption key' "$backup_set" "$test_root/wrong-decryption-private.asc" "$test_root/signer-public.asc" "$signer_fp"
corrupt_set=$(copy_set "$test_root/corrupt"); printf '\377' | dd of="$corrupt_set/$backup_id.tar.gpg" bs=1 seek=32 conv=notrunc status=none
expect_crypto_refusal 'Corrupt ciphertext' "$corrupt_set" "$test_root/decryption-private.asc" "$test_root/signer-public.asc" "$signer_fp"
missing_sig_set=$(copy_set "$test_root/missing-signature"); rm -f "$missing_sig_set/$backup_id.tar.gpg.sig"
expect_crypto_refusal 'Missing signature' "$missing_sig_set" "$test_root/decryption-private.asc" "$test_root/signer-public.asc" "$signer_fp"
altered_sig_set=$(copy_set "$test_root/altered-signature"); printf '\377' | dd of="$altered_sig_set/$backup_id.tar.gpg.sig" bs=1 seek=8 conv=notrunc status=none
expect_crypto_refusal 'Altered signature' "$altered_sig_set" "$test_root/decryption-private.asc" "$test_root/signer-public.asc" "$signer_fp"
wrong_signer_set=$(copy_set "$test_root/wrong-signer"); GNUPGHOME="$test_root/wrong-sign-gnupg" gpg --batch --yes --local-user "$wrong_signer_fp" --output "$wrong_signer_set/$backup_id.tar.gpg.sig" --detach-sign "$wrong_signer_set/$backup_id.tar.gpg"
expect_crypto_refusal 'Unexpected signer' "$wrong_signer_set" "$test_root/decryption-private.asc" "$test_root/signer-public.asc" "$signer_fp"

restore_run "$backup_set" "$test_root/decryption-private.asc" "$test_root/signer-public.asc" "$signer_fp"
docker run --rm --user 0:0 -v "$test_root:$test_root:z" --entrypoint /bin/sh "$tool_image" -c "find '$restore_uploads' -type d -exec chmod 777 {} \\; && find '$restore_uploads' -type f -exec chmod 644 {} \\;"

restore_migration_url="postgresql://$restore_migration:$migration_password@127.0.0.1:$restore_port/$restore_db?options=-c%20role%3D$restore_owner"
restore_runtime_url="postgresql://$restore_runtime_login:$runtime_password@127.0.0.1:$restore_port/$restore_db"
PGOPTIONS="-c role=$restore_owner" PGPASSWORD="$migration_password" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$restore_port" -U "$restore_migration" -d "$restore_db" --set=schema_name=public --set=runtime_role="$restore_runtime_role" --file=deploy/lan/sql/grant-runtime.sql
MIGRATION_DATABASE_URL="$restore_migration_url" RUNTIME_DATABASE_ROLE="$restore_runtime_role" DATABASE_SCHEMA=public backend/scripts/provision-patient-mrn-sequence.sh

PGPASSWORD="$admin_password" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$restore_port" -U postgres -d "$restore_db" --set=owner="$restore_owner" <<'SQL'
SELECT 1 / CASE WHEN NOT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p','S') AND pg_get_userbyid(c.relowner) <> :'owner'
) THEN 1 ELSE 0 END AS all_application_objects_owned_by_schema_owner;
SELECT 1 / CASE WHEN pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public."_prisma_migrations"'::regclass)) = :'owner' THEN 1 ELSE 0 END;
SELECT 1 / CASE WHEN pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.patient_file_number_seq'::regclass)) = :'owner' THEN 1 ELSE 0 END;
SQL
PGPASSWORD="$runtime_password" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$restore_port" -U "$restore_runtime_login" -d "$restore_db" --set=owner="$restore_owner" <<'SQL'
SELECT 1 / CASE WHEN has_database_privilege(current_user,current_database(),'CONNECT') AND has_schema_privilege(current_user,'public','USAGE') AND NOT has_schema_privilege(current_user,'public','CREATE') AND has_table_privilege(current_user,'public."Patient"','SELECT,INSERT,UPDATE,DELETE') AND NOT has_table_privilege(current_user,'public."_prisma_migrations"','SELECT') AND has_sequence_privilege(current_user,'public.patient_file_number_seq','USAGE') AND NOT has_sequence_privilege(current_user,'public.patient_file_number_seq','UPDATE') AND NOT has_sequence_privilege(current_user,'public.patient_file_number_seq','SELECT') THEN 1 ELSE 0 END;
SELECT 1 / CASE WHEN NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','S') AND pg_get_userbyid(c.relowner)=current_user) THEN 1 ELSE 0 END;
SQL
for operation in \
  'CREATE TABLE phase1a5_forbidden(id int)' \
  'ALTER TABLE "Patient" ADD COLUMN phase1a5_forbidden int' \
  'DROP TABLE "Patient"' \
  "SELECT setval('patient_file_number_seq', 999999, true)"; do
  if PGPASSWORD="$runtime_password" psql -h 127.0.0.1 -p "$restore_port" -U "$restore_runtime_login" -d "$restore_db" -c "$operation" >/dev/null 2>&1; then echo "Forbidden runtime operation succeeded: $operation" >&2; exit 1; fi
done

[ "$(PGPASSWORD="$runtime_password" psql -At -h 127.0.0.1 -p "$restore_port" -U "$restore_runtime_login" -d "$restore_db" -c "SELECT count(*) FROM \"Consent\" c JOIN \"Patient\" p ON p.id=c.\"patientId\" WHERE p.id='phase1a5-patient-source'")" = 1 ]
[ "$(PGPASSWORD="$runtime_password" psql -At -h 127.0.0.1 -p "$restore_port" -U "$restore_runtime_login" -d "$restore_db" -c "SELECT \"fileNumber\" FROM \"Patient\" WHERE id='phase1a5-patient-source'")" = "$source_mrn" ]
[ "$upload_hashes" = "$(cd "$restore_uploads" && find . -type f -print0 | sort -z | xargs -0 sha256sum)" ]
PGPASSWORD="$runtime_password" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$restore_port" -U "$restore_runtime_login" -d "$restore_db" -c "INSERT INTO \"Patient\" (id, \"fullNameAr\", \"fullNameEn\", gender, \"dateOfBirth\", phone, \"addressStateId\", \"emergencyContact\") VALUES ('phase1a5-patient-runtime', 'Runtime', 'Runtime', 'MALE', '1991-01-01', '+249900000002', 990001, 'Runtime')" >/dev/null
runtime_mrn=$(PGPASSWORD="$runtime_password" psql -At -h 127.0.0.1 -p "$restore_port" -U "$restore_runtime_login" -d "$restore_db" -c "SELECT \"fileNumber\" FROM \"Patient\" WHERE id='phase1a5-patient-runtime'")
echo "$runtime_mrn" | grep -Eq '^SHF-[0-9]{6}$'; [ "$runtime_mrn" != "$source_mrn" ]

# Retention counts only valid signatures: an unsigned newest-looking directory
# cannot displace or cause deletion of an older cryptographically valid set.
retention_root="$test_root/retention"; mkdir -p "$retention_root"
for id in clinic-lan-backup-20260101T000000Z clinic-lan-backup-20260102T000000Z; do mkdir "$retention_root/$id"; cp "$backup_set/$backup_id.tar.gpg" "$retention_root/$id/$id.tar.gpg"; cp "$backup_set/$backup_id.tar.gpg.sig" "$retention_root/$id/$id.tar.gpg.sig"; printf 'format=clinic-lan-backup-v1\nid=%s\n' "$id" > "$retention_root/$id/COMPLETE"; done
invalid_id=clinic-lan-backup-20990101T000000Z; mkdir "$retention_root/$invalid_id"; cp "$backup_set/$backup_id.tar.gpg" "$retention_root/$invalid_id/$invalid_id.tar.gpg"; printf 'format=clinic-lan-backup-v1\nid=%s\n' "$invalid_id" > "$retention_root/$invalid_id/COMPLETE"
BACKUP_OUTPUT_DIR="$retention_root" BACKUP_RETENTION_COUNT=1 BACKUP_RETENTION_DRY_RUN=false BACKUP_GPG_SIGNER_PUBLIC_KEY_FILE="$test_root/signer-public.asc" BACKUP_GPG_SIGNER_FINGERPRINT="$signer_fp" deploy/lan/retention.sh
[ ! -e "$retention_root/clinic-lan-backup-20260101T000000Z" ] && [ -d "$retention_root/clinic-lan-backup-20260102T000000Z" ] && [ -d "$retention_root/$invalid_id" ]

echo 'Disposable restore identity before cleanup:'; prove_database "$restore_port" "$restore_db"
docker rm -f "$restore_container" "$upload_container" >/dev/null; docker volume rm "$restore_volume" "$upload_volume" >/dev/null; docker image rm "$tool_image" >/dev/null
trap - EXIT HUP INT TERM
find "$test_root" -depth -delete
echo "Phase 1A.5 signed backup/least-privilege restore passed: source=$source_db restore=$restore_db"
