import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');
const compose = read('compose.lan.yml');
const environment = read('deploy/lan/env.example');
const bootstrap = read('deploy/lan/bootstrap-database.sh');
const createRoles = read('deploy/lan/sql/create-roles-and-database.sql');
const configure = read('deploy/lan/sql/configure-database.sql');
const grants = read('deploy/lan/sql/grant-runtime.sql');
const verify = read('deploy/lan/sql/verify-runtime.sql');
const dockerignore = read('.dockerignore');
const allSql = `${createRoles}\n${configure}\n${grants}\n${verify}`;

function serviceBlock(name) {
  const match = compose.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:\\n|^networks:|^volumes:)`, 'm'));
  assert.ok(match, `${name} service must exist`);
  return match[1];
}

test('role names and credentials are parameterized and fail closed when missing', () => {
  for (const name of [
    'POSTGRES_ADMIN_CONNECTION', 'MIGRATION_DATABASE_URL', 'DATABASE_URL', 'LAN_DATABASE_NAME',
    'SCHEMA_OWNER_ROLE', 'MIGRATION_LOGIN_ROLE', 'MIGRATION_DATABASE_PASSWORD',
    'RUNTIME_DATABASE_ROLE', 'RUNTIME_LOGIN_ROLE', 'RUNTIME_DATABASE_PASSWORD',
    'CONFIRM_LAN_DATABASE_BOOTSTRAP'
  ]) {
    assert.match(bootstrap, new RegExp(`\\b${name}\\b`));
    assert.match(environment, new RegExp(`^${name}=`, 'm'));
  }
  assert.match(bootstrap, /All four database role names must be distinct/);
  assert.doesNotMatch(bootstrap, /\beval\b/);
  assert.match(bootstrap, /must target the expected local\/container-only database/);
  assert.match(bootstrap, /CONFIRM_LAN_DATABASE_BOOTSTRAP.*exactly equal LAN_DATABASE_NAME/);
  assert.doesNotMatch(environment, /^(?:MIGRATION_DATABASE_PASSWORD|RUNTIME_DATABASE_PASSWORD|POSTGRES_PASSWORD)=(?!REPLACE_).+$/m);
});

test('roles are least-privilege and membership separates migration from runtime', () => {
  assert.match(createRoles, /schema_owner_role'\) \\gexec/);
  assert.match(createRoles, /NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE/);
  assert.match(createRoles, /LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE/);
  assert.match(createRoles, /LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE/);
  assert.match(createRoles, /GRANT %I TO %I', :'schema_owner_role', :'migration_login_role'/);
  assert.match(createRoles, /GRANT %I TO %I', :'runtime_role', :'runtime_login_role'/);
  assert.doesNotMatch(createRoles, /runtime_role', :'migration_login_role'|schema_owner_role', :'runtime_login_role'/);
  assert.doesNotMatch(allSql, /\bSUPERUSER\b(?!.*NOSUPERUSER)|\bCREATEDB\b(?!.*NOCREATEDB)|\bCREATEROLE\b(?!.*NOCREATEROLE)/);
  assert.doesNotMatch(allSql, /GRANT\s+ALL(?:\s+PRIVILEGES)?/i);
});

test('runtime receives table CRUD and schema usage but no schema creation or ownership', () => {
  assert.match(configure, /GRANT USAGE ON SCHEMA %I TO %I/);
  assert.match(configure, /REVOKE CREATE ON SCHEMA %I FROM %I/);
  assert.match(grants, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE/);
  assert.match(grants, /relation\.relname <> '_prisma_migrations'/);
  assert.match(verify, /NOT has_schema_privilege\(current_user, :'schema_name', 'CREATE'\)/);
  assert.match(verify, /relation\.relowner[\s\S]*:'runtime_role', :'runtime_login_role'/);
  assert.doesNotMatch(grants, /ALTER (?:TABLE|SEQUENCE).*OWNER TO/i);
});

test('MRN sequence privilege is USAGE only and arbitrary sequence mutation is denied', () => {
  const mrnSql = read('backend/scripts/sql/grant-patient-mrn-sequence.sql');
  const disposableTest = read('deploy/lan/sql/test-disposable-runtime.sql');
  assert.match(mrnSql, /GRANT USAGE ON SEQUENCE %I\.%I TO %I/);
  assert.doesNotMatch(mrnSql, /GRANT (?:UPDATE|SELECT|ALL)|TO PUBLIC/i);
  assert.match(verify, /patient_file_number_seq'\), 'USAGE'/);
  assert.match(verify, /NOT has_sequence_privilege\([\s\S]*patient_file_number_seq'[\s\S]*'UPDATE'/);
  assert.match(verify, /NOT has_sequence_privilege\([\s\S]*patient_file_number_seq'[\s\S]*'SELECT'/);
  assert.match(disposableTest, /PERFORM setval\('patient_file_number_seq'/);
  assert.match(disposableTest, /MRN immutability was not enforced/);
  assert.match(disposableTest, /\^SHF-\[0-9\]\{6\}\$/);
  assert.match(disposableTest, /DELETE FROM "Patient"/);
});

test('migration ownership and owner-specific table defaults precede migrate deploy', () => {
  assert.match(configure, /ALTER SCHEMA %I OWNER TO %I/);
  assert.match(configure, /ALTER ROLE %I IN DATABASE %I SET ROLE TO %L/);
  assert.match(configure, /ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES/);
  assert.doesNotMatch(configure, /ALTER DEFAULT PRIVILEGES[\s\S]*ON SEQUENCES/);
  assert.ok(bootstrap.indexOf('verify-migration-identity.sql') < bootstrap.indexOf('npx prisma migrate deploy'));
  assert.ok(bootstrap.indexOf('npx prisma migrate deploy') < bootstrap.indexOf('grant-runtime.sql'));
  assert.ok(bootstrap.indexOf('grant-runtime.sql') < bootstrap.indexOf('provision-patient-mrn-sequence.sh'));
});

test('admin and migration credentials stay out of the long-running backend', () => {
  const backend = serviceBlock('backend');
  const oneShot = serviceBlock('database-bootstrap');
  assert.match(backend, /^      DATABASE_URL:/m);
  assert.match(backend, /^      SOCKET_REVOCATION_DATABASE_URL:/m);
  for (const name of ['POSTGRES_ADMIN_CONNECTION', 'MIGRATION_DATABASE_URL', 'MIGRATION_DATABASE_PASSWORD', 'RUNTIME_DATABASE_PASSWORD', 'SCHEMA_OWNER_ROLE']) {
    assert.doesNotMatch(backend, new RegExp(`^      ${name}:`, 'm'));
    assert.match(oneShot, new RegExp(`^      ${name}:`, 'm'));
  }
  assert.match(oneShot, /^    profiles: \["database-bootstrap"\]$/m);
  assert.match(oneShot, /^    restart: "no"$/m);
  assert.doesNotMatch(serviceBlock('postgres'), /^    ports:/m);
});

test('root Docker build context excludes local secrets, data, and backups without excluding bootstrap sources', () => {
  for (const pattern of [
    /^\.git$/m,
    /^\*\*\/\.env$/m,
    /^\*\*\/node_modules$/m,
    /^\*\*\/uploads$/m,
    /^\*\*\/\*\.dump$/m,
    /^\*\*\/\*\.backup$/m,
    /^\*\*\/backups\/\*\*$/m
  ]) assert.match(dockerignore, pattern);

  const ignoredEntries = new Set(dockerignore.split(/\r?\n/).map((line) => line.trim()));
  for (const required of [
    'backend/package.json', 'backend/package-lock.json', 'backend/src',
    'backend/prisma', 'backend/scripts', 'deploy/lan'
  ]) {
    assert.equal(ignoredEntries.has(required), false);
    assert.equal(ignoredEntries.has(`${required}/**`), false);
  }

  const bootstrapDockerfile = read('deploy/lan/Dockerfile.bootstrap');
  assert.match(bootstrapDockerfile, /COPY backend\/package\*\.json/);
  assert.match(bootstrapDockerfile, /COPY backend\/ \.\//);
  assert.match(bootstrapDockerfile, /COPY deploy\/lan\/ \/workspace\/deploy\/lan\//);
});

test('disposable SQL proves database and runtime identity before its first mutation', () => {
  const disposableTest = read('deploy/lan/sql/test-disposable-runtime.sql');
  const guardEnd = disposableTest.indexOf('AS disposable_database_identity_verified;');
  const firstMutation = Math.min(...[
    'INSERT INTO', 'UPDATE "', 'DELETE FROM', "setval(", 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE'
  ].map((statement) => disposableTest.indexOf(statement)).filter((index) => index >= 0));

  assert.match(disposableTest, /^\\set ON_ERROR_STOP on/m);
  assert.match(disposableTest, /:\{\?expected_database\}/);
  assert.match(disposableTest, /:\{\?expected_runtime_login\}/);
  assert.match(disposableTest, /current_database\(\) = :'expected_database'/);
  assert.match(disposableTest, /\^clinic_lan_phase1a4_test_\[A-Za-z0-9_\]\+\$/);
  assert.match(disposableTest, /session_user = :'expected_runtime_login'/);
  assert.match(disposableTest, /current_user = :'expected_runtime_login'/);
  assert.ok(guardEnd >= 0 && guardEnd < firstMutation, 'identity guard must precede every mutation');
});
