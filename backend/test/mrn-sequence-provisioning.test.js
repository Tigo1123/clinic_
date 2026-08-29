import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell = fs.readFileSync(new URL('../scripts/provision-patient-mrn-sequence.sh', import.meta.url), 'utf8');
const sql = fs.readFileSync(new URL('../scripts/sql/grant-patient-mrn-sequence.sql', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../prisma/migrations/20260828100000_patient_file_number_foundation/migration.sql', import.meta.url), 'utf8');

test('MRN sequence provisioning requires explicit environment role inputs', () => {
  assert.match(shell, /MIGRATION_DATABASE_URL is required/);
  assert.match(shell, /RUNTIME_DATABASE_ROLE is required/);
  assert.match(shell, /DATABASE_SCHEMA=\$\{DATABASE_SCHEMA:-public\}/);
  assert.doesNotMatch(shell, /clinic_(?:prod_)?app_(?:user|login)/);
});

test('MRN provisioning grants only sequence USAGE and verifies no runtime ownership', () => {
  assert.match(sql, /GRANT USAGE ON SEQUENCE %I\.%I TO %I/);
  assert.doesNotMatch(sql, /GRANT ALL|TO PUBLIC|GRANT UPDATE|ALTER SEQUENCE|DROP SEQUENCE/i);
  assert.match(sql, /has_sequence_privilege[\s\S]*'UPDATE'/);
  assert.match(sql, /pg_get_userbyid\(sequence\.relowner\) <> :'runtime_role'/);
});

test('portable MRN migration owns the sequence by Patient.fileNumber without role names', () => {
  assert.match(migration, /ALTER SEQUENCE "patient_file_number_seq" OWNED BY "Patient"\."fileNumber"/);
  assert.doesNotMatch(migration, /GRANT|clinic_(?:prod_)?app_(?:user|login)/i);
});
