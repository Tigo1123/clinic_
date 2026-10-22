import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FirstAdminError, preflightFirstAdmin, readPassword, targetConfiguration, verifyNeonTargetConfiguration } from '../scripts/provision-first-admin.js';
import { repositoryInventory } from '../scripts/audit-clinic-readiness.js';

const backend = fileURLToPath(new URL('../', import.meta.url));
function fixture(contents = 'ValidPass1\n', mode = 0o600) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-first-admin-'));
  const file = path.join(dir, 'password');
  fs.writeFileSync(file, contents, { mode });
  fs.chmodSync(file, mode);
  return { dir, file };
}

function neonEnv(overrides = {}) {
  const host = 'ep-purple-brook-b5g403vw.c-7.us-east-2.aws.neon.tech';
  return {
    FIRST_ADMIN_TARGET_MODE: 'neon-production',
    NODE_ENV: 'production',
    FIRST_ADMIN_EXPECTED_NEON_HOST: host,
    FIRST_ADMIN_EXPECTED_DATABASE: 'neondb',
    FIRST_ADMIN_EXPECTED_SCHEMA: 'public',
    RUNTIME_LOGIN_ROLE: 'shifa_runtime',
    CONFIRM_FIRST_ADMIN_TARGET: `NEON_PRODUCTION:${host}/neondb/public`,
    DATABASE_URL: `postgresql://runtime:sensitive-url-secret@${host}/neondb?schema=public&sslmode=verify-full`,
    FIRST_ADMIN_USERNAME: 'named.admin@example.org',
    ...overrides,
  };
}

function fakeClient({ admins = 0, usernameExists = false, migrationMismatch = false, identityOverrides = {} } = {}) {
  let created = 0;
  const inventoryPromise = repositoryInventory();
  const identity = {
    database: 'neondb', schema: 'public', session_user: 'shifa_runtime', current_user: 'shifa_runtime', recovery: false, superuser: false,
    can_login: true, transaction_read_only: false, can_insert_admin: true, can_insert_audit: true,
    ...identityOverrides,
  };
  const tx = {
    $queryRaw: async strings => {
      const sql = strings.join('?');
      if (sql.includes('current_database()')) return [identity];
      if (sql.includes('pg_advisory_xact_lock')) return [{ locked: true }];
      if (sql.includes('_prisma_migrations')) {
        const inventory = await inventoryPromise;
        return inventory.migrations.map((m, index) => ({ migration_name: m.name, checksum: migrationMismatch && index === 0 ? 'wrong-checksum' : m.checksum, finished: true, rolled_back: false }));
      }
      throw new Error('unexpected test query');
    },
    user: {
      count: async () => admins,
      findFirst: async () => usernameExists ? { id: 'existing' } : null,
      create: async () => { created += 1; return { id: 'new', username: 'named.admin@example.org', role: 'ADMIN', status: 'ACTIVE' }; },
    },
    tenantAuditLog: { create: async () => ({}) },
  };
  const client = { ...tx, $transaction: async callback => callback(tx), $disconnect: async () => {} };
  return { client, created: () => created };
}

test('first-admin password file accepts one valid 0600 line and rejects unsafe or weak inputs', () => {
  const valid = fixture('ValidPass1\n');
  try { assert.equal(readPassword(valid.file), 'ValidPass1'); } finally { fs.rmSync(valid.dir, { recursive: true, force: true }); }
  const crlf = fixture('ValidPass1\r\n');
  try { assert.equal(readPassword(crlf.file), 'ValidPass1'); } finally { fs.rmSync(crlf.dir, { recursive: true, force: true }); }
  assert.throws(() => readPassword(path.join(os.tmpdir(), `missing-${Date.now()}`)), FirstAdminError);
  const repositoryFile = path.join(backend, 'test', `.first-admin-password-${process.pid}`);
  fs.writeFileSync(repositoryFile, 'ValidPass1\n', { mode: 0o600 });
  fs.chmodSync(repositoryFile, 0o600);
  try { assert.throws(() => readPassword(repositoryFile), /outside the repository|protected first-administrator password file/); } finally { fs.rmSync(repositoryFile, { force: true }); }
  for (const [contents, mode] of [['weak\n', 0o600], ['ValidPass1\nsecond\n', 0o600], ['ValidPass1\n', 0o640]]) {
    const bad = fixture(contents, mode);
    try { assert.throws(() => readPassword(bad.file), FirstAdminError); } finally { fs.rmSync(bad.dir, { recursive: true, force: true }); }
  }
});

test('correct Neon production host, database, schema and explicit confirmation are accepted', () => {
  assert.deepEqual(targetConfiguration(neonEnv()), {
    mode: 'neon-production', host: 'ep-purple-brook-b5g403vw.c-7.us-east-2.aws.neon.tech', database: 'neondb', schema: 'public', runtimeRole: 'shifa_runtime',
  });
});

test('wrong Neon host is rejected even when confirmation otherwise matches', () => {
  assert.throws(() => verifyNeonTargetConfiguration(neonEnv({ DATABASE_URL: 'postgresql://runtime:secret@ep-other.us-east-2.aws.neon.tech/neondb?schema=public&sslmode=verify-full' })), /host does not match/);
});

test('wrong database and schema are rejected', () => {
  assert.throws(() => verifyNeonTargetConfiguration(neonEnv({ DATABASE_URL: 'postgresql://runtime:secret@ep-purple-brook-b5g403vw.c-7.us-east-2.aws.neon.tech/clinic_test?schema=public&sslmode=verify-full' })), /expected Neon production database/);
  assert.throws(() => verifyNeonTargetConfiguration(neonEnv({ DATABASE_URL: 'postgresql://runtime:secret@ep-purple-brook-b5g403vw.c-7.us-east-2.aws.neon.tech/neondb?schema=other&sslmode=verify-full' })), /expected Neon schema/);
});

test('local/test targets, pooler hosts and missing explicit confirmation are rejected', () => {
  assert.throws(() => targetConfiguration(neonEnv({ NODE_ENV: 'test' })), /NODE_ENV=production/);
  assert.throws(() => targetConfiguration({ FIRST_ADMIN_TARGET_MODE: 'lan', NODE_ENV: 'production' }), /pinned Neon production target mode/);
  assert.throws(() => targetConfiguration(neonEnv({ FIRST_ADMIN_EXPECTED_NEON_HOST: 'localhost' })), /exact direct Neon/);
  assert.throws(() => targetConfiguration(neonEnv({ FIRST_ADMIN_EXPECTED_NEON_HOST: 'ep-shifa-pooler.us-east-2.aws.neon.tech' })), /exact direct Neon/);
  assert.throws(() => targetConfiguration({ FIRST_ADMIN_TARGET_MODE: 'lan', LAN_DATABASE_NAME: 'neondb', CONFIRM_FIRST_ADMIN_DATABASE: 'neondb', RUNTIME_LOGIN_ROLE: 'runtime', DATABASE_URL: 'postgresql://runtime:secret@localhost/neondb' }), /private postgres service hostname/);
  assert.throws(() => targetConfiguration(neonEnv({ CONFIRM_FIRST_ADMIN_TARGET: '' })), /confirmation is required/);
  const missingUsername = neonEnv();
  delete missingUsername.FIRST_ADMIN_USERNAME;
  assert.throws(() => targetConfiguration(missingUsername), /FIRST_ADMIN_USERNAME/);
});

test('successful preflight checks target, identity, migration history, password and empty admin state without creating rows', async () => {
  const password = fixture();
  const fake = fakeClient();
  try {
    const result = await preflightFirstAdmin({ env: neonEnv(), passwordFile: password.file, client: fake.client, hashPassword: async value => `discarded-${value}` });
    assert.deepEqual(result, { mode: 'neon-production', database: 'neondb', schema: 'public', migrationCount: (await repositoryInventory()).migrations.length });
    assert.equal(fake.created(), 0);
  } finally { fs.rmSync(password.dir, { recursive: true, force: true }); }
});

test('preflight refuses an existing administrator and a duplicate username', async () => {
  const password = fixture();
  try {
    for (const options of [{ admins: 1 }, { usernameExists: true }]) {
      const fake = fakeClient(options);
      await assert.rejects(preflightFirstAdmin({ env: neonEnv(), passwordFile: password.file, client: fake.client, hashPassword: async () => 'discarded' }), FirstAdminError);
      assert.equal(fake.created(), 0);
    }
  } finally { fs.rmSync(password.dir, { recursive: true, force: true }); }
});

test('preflight refuses migration drift before account creation', async () => {
  const password = fixture();
  const fake = fakeClient({ migrationMismatch: true });
  try {
    await assert.rejects(preflightFirstAdmin({ env: neonEnv(), passwordFile: password.file, client: fake.client, hashPassword: async () => 'discarded' }), /migration state is incomplete or differs/);
    assert.equal(fake.created(), 0);
  } finally { fs.rmSync(password.dir, { recursive: true, force: true }); }
});

test('preflight refuses a database login identity different from the configured runtime role', async () => {
  const password = fixture();
  const fake = fakeClient({ identityOverrides: { session_user: 'unexpected_role', current_user: 'unexpected_role' } });
  try {
    await assert.rejects(preflightFirstAdmin({ env: neonEnv(), passwordFile: password.file, client: fake.client, hashPassword: async () => 'discarded' }), /login\/effective role does not match/);
    assert.equal(fake.created(), 0);
  } finally { fs.rmSync(password.dir, { recursive: true, force: true }); }
});

test('CLI error output never contains the connection URL password or username secret', () => {
  const sentinel = 'credential-must-never-appear';
  const result = spawnSync(process.execPath, ['scripts/provision-first-admin.js', '--preflight'], {
    cwd: backend,
    encoding: 'utf8',
    env: {
      ...process.env,
      FIRST_ADMIN_TARGET_MODE: 'neon-production', NODE_ENV: 'production',
      FIRST_ADMIN_EXPECTED_NEON_HOST: 'ep-purple-brook-b5g403vw.c-7.us-east-2.aws.neon.tech',
      FIRST_ADMIN_EXPECTED_DATABASE: 'neondb', FIRST_ADMIN_EXPECTED_SCHEMA: 'public',
      RUNTIME_LOGIN_ROLE: 'shifa_runtime', FIRST_ADMIN_USERNAME: 'named.admin@example.org',
      CONFIRM_FIRST_ADMIN_TARGET: 'wrong-confirmation',
      DATABASE_URL: `postgresql://runtime:${sentinel}@ep-purple-brook-b5g403vw.c-7.us-east-2.aws.neon.tech/neondb?schema=public&sslmode=verify-full`,
    },
  });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(sentinel));
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /postgresql:\/\//i);
});
