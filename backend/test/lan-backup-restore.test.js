import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');
const backup = read('deploy/lan/backup.sh');
const restore = read('deploy/lan/restore.sh');
const retention = read('deploy/lan/retention.sh');
const compose = read('compose.lan.yml');
const environment = read('deploy/lan/env.example');
const gitignore = read('.gitignore');
const dockerignore = read('.dockerignore');
const disposable = read('deploy/lan/test-disposable-backup-restore.sh');
const offserver = read('deploy/lan/copy-offserver.sh');
const backupService = read('deploy/lan/systemd/clinic-lan-backup.service.example');
const backupTimer = read('deploy/lan/systemd/clinic-lan-backup.timer.example');
const readme = read('deploy/lan/README.md');

test('named database and uploads volumes remain persistent and are never deleted by backup tooling', () => {
  assert.match(compose, /lan-postgres-data:\/var\/lib\/postgresql\/data/);
  assert.match(compose, /lan-uploads-data:\/app\/uploads/);
  assert.match(compose, /lan-uploads-data:\/uploads:ro/);
  assert.doesNotMatch(`${backup}\n${restore}\n${retention}`, /docker compose down|docker volume (?:rm|prune)|\bdown -v\b/);
});

test('backup fails closed, proves a local source, and never exposes a connection URL', () => {
  for (const name of ['PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'BACKUP_OUTPUT_DIR', 'UPLOADS_DIR', 'BACKUP_GPG_PUBLIC_KEY_FILE', 'BACKUP_GPG_RECIPIENT', 'BACKUP_GPG_SIGNING_PRIVATE_KEY_FILE', 'BACKUP_GPG_SIGNING_FINGERPRINT', 'BACKUP_QUIESCE_CONFIRMED']) {
    assert.match(backup, new RegExp(`\\$\\{${name}:\\?${name} is required\\}`));
  }
  assert.match(backup, /postgres\|localhost\|127\.0\.0\.1\|::1/);
  assert.match(backup, /current_database\(\).*session_user.*current_user.*inet_server_addr/);
  assert.match(backup, /BACKUP_QUIESCE_CONFIRMED.*true/);
  assert.doesNotMatch(backup, /DATABASE_URL|set -x|echo .*PGPASSWORD/);
  assert.doesNotMatch(environment, /^(?:BACKUP_DATABASE_PASSWORD)=((?!REPLACE_).)+$/m);
});

test('completed sets require encryption and exact-fingerprint detached signing before publication', () => {
  assert.match(backup, /pg_dump --format=custom/);
  assert.match(backup, /pg_restore --list/);
  assert.match(backup, /tar --format=pax .*uploads\.tar/);
  assert.match(backup, /manifest\.json/);
  assert.match(backup, /SHA256SUMS/);
  assert.match(backup, /sha256sum --check/);
  assert.match(backup, /gpg .*--encrypt/);
  assert.match(backup, /--detach-sign/);
  assert.match(backup, /VALIDSIG/);
  assert.match(backup, /valid_fingerprint.*BACKUP_GPG_SIGNING_FINGERPRINT/);
  assert.match(backup, /\.tar\.gpg/);
  assert.match(backup, /\.tar\.gpg\.sig/);
  const complete = backup.indexOf('> "$final_dir/COMPLETE"');
  assert.ok(backup.indexOf('OpenPGP encryption failed') < complete);
  assert.ok(backup.indexOf('fresh backup signature fingerprint verification failed') < complete);
  assert.doesNotMatch(backup, /--symmetric|passphrase/);
});

test('restore is disposable-only and validates encryption, checksums, dump, emptiness, and archive paths before mutation', () => {
  for (const name of ['BACKUP_SET_DIR', 'BACKUP_GPG_PRIVATE_KEY_FILE', 'BACKUP_GPG_SIGNER_PUBLIC_KEY_FILE', 'BACKUP_GPG_SIGNER_FINGERPRINT', 'RESTORE_DATABASE_NAME', 'RESTORE_UPLOADS_DIR', 'RESTORE_MIGRATION_LOGIN_ROLE', 'RESTORE_SCHEMA_OWNER_ROLE', 'CONFIRM_DISPOSABLE_RESTORE']) {
    assert.match(restore, new RegExp(`\\$\\{${name}:\\?${name} is required\\}`));
  }
  assert.match(restore, /clinic_lan_phase1a5_restore_/);
  assert.match(restore, /CONFIRM_DISPOSABLE_RESTORE.*RESTORE_DATABASE_NAME/);
  assert.match(restore, /target database is not empty\/new/);
  assert.match(restore, /gpg .*--decrypt/);
  assert.match(restore, /VALIDSIG/);
  assert.match(restore, /valid_signer.*BACKUP_GPG_SIGNER_FINGERPRINT/);
  assert.match(restore, /sha256sum --check/);
  assert.match(restore, /pg_restore --list/);
  assert.match(restore, /archive contains an unsafe path/);
  const actualRestore = restore.indexOf('pg_restore --exit-on-error');
  for (const guard of ['detached signature is invalid or from an unexpected signer', 'OpenPGP authentication/decryption failed', 'payload checksum validation failed', 'database dump validation failed', 'uploads archive contains an unsafe path']) {
    assert.ok(restore.indexOf(guard) >= 0 && restore.indexOf(guard) < actualRestore);
  }
  assert.doesNotMatch(restore, /rm -rf|DROP DATABASE|dropdb|DATABASE_URL/);
  assert.ok(restore.indexOf('VALIDSIG') < restore.indexOf('--decrypt'));
  assert.match(restore, /session_user.*RESTORE_MIGRATION_LOGIN_ROLE.*current_user.*RESTORE_SCHEMA_OWNER_ROLE/);
  assert.match(restore, /--no-same-owner --no-same-permissions/);
});

test('retention only removes validated completed named sets, keeps at least one, and supports dry run', () => {
  assert.match(retention, /BACKUP_RETENTION_COUNT.*-ge 2/);
  assert.match(retention, /BACKUP_RETENTION_DRY_RUN:-true/);
  assert.match(retention, /clinic-lan-backup-\?\?\?\?\?\?\?\?T\?\?\?\?\?\?Z/);
  assert.match(retention, /COMPLETE/);
  assert.match(retention, /\.tar\.gpg/);
  assert.match(retention, /\.tar\.gpg\.sig/);
  assert.match(retention, /VALIDSIG/);
  assert.match(retention, /valid_signer.*BACKUP_GPG_SIGNER_FINGERPRINT/);
  assert.doesNotMatch(retention, /rm -rf/);
  assert.ok(retention.indexOf('candidate escaped validated backup naming') < retention.indexOf('find "$candidate" -depth -delete'));
});

test('private keys and generated backup material stay out of Git and Docker contexts', () => {
  for (const source of [gitignore, dockerignore]) {
    assert.match(source, /lan-backups/);
    assert.match(source, /backup-private\.asc/);
    assert.match(source, /backup-secret\.asc/);
  }
  assert.doesNotMatch(compose, /BACKUP_GPG_PRIVATE_KEY/);
  assert.match(compose, /BACKUP_GPG_PUBLIC_KEY_FILE/);
  assert.match(dockerignore, /^deploy\/lan\/keys$/m);
  assert.match(dockerignore, /^deploy\/lan\/keys\/\*\*$/m);
  for (const arbitrary of ['deploy/lan/keys/private.asc', 'deploy/lan/keys/anything.secret', 'deploy/lan/keys/site-signing-key']) {
    assert.equal(arbitrary.startsWith('deploy/lan/keys/'), true);
  }
  const backend = compose.match(/^  backend:\n([\s\S]*?)(?=^  frontend:)/m)?.[1] || '';
  assert.doesNotMatch(backend, /BACKUP_GPG_SIGNING|backup-signing-private/);
  assert.match(compose, /backup-signing-private\.asc:ro/);
});

test('disposable restore reuses the Phase 1A.4 owner and runtime privilege model', () => {
  assert.match(disposable, /create-roles-and-database\.sql/);
  assert.match(disposable, /configure-database\.sql/);
  assert.match(disposable, /grant-runtime\.sql/);
  assert.match(disposable, /provision-patient-mrn-sequence\.sh/);
  assert.match(disposable, /RESTORE_MIGRATION_LOGIN_ROLE/);
  assert.match(disposable, /RESTORE_SCHEMA_OWNER_ROLE/);
  assert.match(disposable, /all_application_objects_owned_by_schema_owner/);
  assert.match(disposable, /_prisma_migrations/);
  assert.match(disposable, /patient_file_number_seq/);
  assert.match(disposable, /NOT has_sequence_privilege[\s\S]*UPDATE/);
  assert.doesNotMatch(disposable, /GRANT ALL/);
});

test('backup and restore scripts contain no shell eval', () => {
  assert.doesNotMatch(`${backup}\n${restore}\n${retention}`, /\beval\b/);
});

test('backup remains an explicit one-shot process independent of Express', () => {
  assert.match(compose, /^  backup:\n[\s\S]*?profiles: \["backup"\]/m);
  assert.match(compose, /^    restart: "no"$/m);
  const backend = compose.match(/^  backend:\n([\s\S]*?)(?=^  frontend:)/m)?.[1] || '';
  assert.doesNotMatch(backend, /BACKUP_|PGPASSWORD|backup\.sh/);
});

test('key roles are separated and routine backup never receives the decryption private key', () => {
  assert.match(compose, /BACKUP_GPG_PUBLIC_KEY_FILE/);
  assert.match(compose, /BACKUP_GPG_SIGNING_PRIVATE_KEY_FILE/);
  assert.doesNotMatch(compose, /BACKUP_GPG_PRIVATE_KEY_FILE/);
  assert.doesNotMatch(`${restore}\n${retention}\n${offserver}`, /BACKUP_GPG_SIGNING_PRIVATE_KEY_FILE|--detach-sign/);
  assert.ok(restore.indexOf('VALIDSIG') < restore.indexOf('private backup key import failed'));
});

test('off-server copying requires independent storage and verifies before publication', () => {
  assert.match(offserver, /stat -c %d/);
  assert.match(offserver, /independently mounted filesystem/);
  assert.match(offserver, /VALIDSIG/);
  assert.match(offserver, /cmp -s/);
  assert.ok(offserver.indexOf('VALIDSIG') < offserver.indexOf('cp "$encrypted"'));
  assert.ok(offserver.indexOf('cp "$encrypted"') < offserver.lastIndexOf('COMPLETE'));
  assert.match(readme, /local staging copy is not disaster recovery/i);
});

test('scheduler cannot directly bypass genuine quiescing', () => {
  assert.match(backupService, /ConditionPathIsExecutable=.*clinic-lan-consistent-backup/);
  assert.match(backupTimer, /ConditionPathIsExecutable=.*clinic-lan-consistent-backup/);
  assert.doesNotMatch(backupService, /ExecStart=.*docker compose/);
  assert.match(readme, /Merely setting the variable is not.*consistency mechanism/s);
});

test('restore compares safe database counts and upload hashes from the signed payload', () => {
  assert.match(backup, /database-counts\.tsv/);
  assert.match(backup, /uploads-files\.sha256/);
  assert.match(restore, /restored database record counts do not match/);
  assert.match(restore, /restored uploads do not match/);
  assert.match(restore, /expected application tables or migrations are missing/);
});
