import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FirstAdminError, preflightFirstAdmin, provisionFirstAdmin, readPassword, targetConfiguration, verifyNeonTargetConfiguration } from '../scripts/provision-first-admin.js';
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

const stagingHost = 'ep-muddy-unit-b4hvj7be.c-6.us-east-2.aws.neon.tech';
function stagingEnv(overrides = {}) {
  return neonEnv({
    FIRST_ADMIN_TARGET_MODE: 'neon-staging',
    FIRST_ADMIN_EXPECTED_NEON_HOST: stagingHost,
    CONFIRM_FIRST_ADMIN_TARGET: `NEON_STAGING:${stagingHost}/neondb/public`,
    DATABASE_URL: `postgresql://shifa_runtime:synthetic-secret@${stagingHost}/neondb?schema=public&sslmode=verify-full`,
    ...overrides,
  });
}

function fakeClient({ admins = 0, usernameExists = false, migrationMismatch = false, identityOverrides = {}, adminCounts } = {}) {
  let created = 0;
  const auditRows = [];
  const adminRows = [];
  const transactions = [];
  let adminChecks = 0;
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
      count: async () => adminCounts ? adminCounts[Math.min(adminChecks++, adminCounts.length - 1)] : admins,
      findFirst: async () => usernameExists ? { id: 'existing' } : null,
      create: async options => { created += 1; adminRows.push(options); return { id: 'new', username: 'named.admin@example.org', role: 'ADMIN', status: 'ACTIVE' }; },
    },
    tenantAuditLog: { create: async options => { auditRows.push(options); return {}; } },
  };
  const client = { ...tx, $transaction: async (callback, options) => { transactions.push(options); return callback(tx); }, $disconnect: async () => {} };
  return { client, created: () => created, auditRows, adminRows, transactions };
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

test('production stays pinned to its original target and ignores configured fingerprint overrides', () => {
  const production = neonEnv();
  const fingerprint = host => createHash('sha256').update(`${host}//neondb/public`).digest('hex').slice(0, 16);
  assert.equal(fingerprint(production.FIRST_ADMIN_EXPECTED_NEON_HOST), 'c9f8bb593c61b80e');
  assert.equal(fingerprint(stagingHost), '36b1790f3b5c2037');
  assert.equal(targetConfiguration(production).mode, 'neon-production');
  assert.throws(() => targetConfiguration(neonEnv({
    FIRST_ADMIN_EXPECTED_NEON_HOST: stagingHost,
    DATABASE_URL: stagingEnv().DATABASE_URL,
    CONFIRM_FIRST_ADMIN_TARGET: `NEON_PRODUCTION:${stagingHost}/neondb/public`,
    FIRST_ADMIN_EXPECTED_FINGERPRINT: fingerprint(stagingHost),
  })), /not the reviewed production target/);
  assert.throws(() => targetConfiguration(stagingEnv({
    FIRST_ADMIN_EXPECTED_NEON_HOST: production.FIRST_ADMIN_EXPECTED_NEON_HOST,
    DATABASE_URL: production.DATABASE_URL,
    CONFIRM_FIRST_ADMIN_TARGET: production.CONFIRM_FIRST_ADMIN_TARGET.replace('NEON_PRODUCTION:', 'NEON_STAGING:'),
    FIRST_ADMIN_EXPECTED_FINGERPRINT: fingerprint(production.FIRST_ADMIN_EXPECTED_NEON_HOST),
  })), /not the reviewed staging target/);
});

test('staging and production confirmations cannot be interchanged', () => {
  assert.throws(() => targetConfiguration(stagingEnv({ CONFIRM_FIRST_ADMIN_TARGET: `NEON_PRODUCTION:${stagingHost}/neondb/public` })), /staging.*confirmation is required/);
  assert.throws(() => targetConfiguration(neonEnv({ CONFIRM_FIRST_ADMIN_TARGET: neonEnv().CONFIRM_FIRST_ADMIN_TARGET.replace('NEON_PRODUCTION:', 'NEON_STAGING:') })), /confirmation is required/);
});

const stagingUrl = (suffix, host = stagingHost) => `postgresql://shifa_runtime:synthetic-secret@${host}${suffix}`;
for (const [name, overrides, error] of [
  ['non-production runtime', { NODE_ENV: 'staging' }, /NODE_ENV=production/],
  ['LAN settings', { LAN_DATABASE_NAME: 'neondb' }, /LAN target settings/],
  ['missing expected database', { FIRST_ADMIN_EXPECTED_DATABASE: undefined }, /EXPECTED_DATABASE/],
  ['wrong expected database', { FIRST_ADMIN_EXPECTED_DATABASE: 'clinic' }, /EXPECTED_DATABASE/],
  ['wrong expected schema', { FIRST_ADMIN_EXPECTED_SCHEMA: 'staging' }, /EXPECTED_SCHEMA/],
  ['missing expected schema', { FIRST_ADMIN_EXPECTED_SCHEMA: undefined }, /EXPECTED_SCHEMA/],
  ['missing host', { FIRST_ADMIN_EXPECTED_NEON_HOST: undefined }, /exact direct Neon staging/],
  ['non-Neon host', { FIRST_ADMIN_EXPECTED_NEON_HOST: 'staging.example.test' }, /exact direct Neon staging/],
  ['pooler expected host', { FIRST_ADMIN_EXPECTED_NEON_HOST: stagingHost.replace('.c-6', '-pooler.c-6') }, /exact direct Neon staging/],
  ['pooler anywhere in hostname', { FIRST_ADMIN_EXPECTED_NEON_HOST: stagingHost.replace('ep-muddy', 'ep-pooler-muddy') }, /exact direct Neon staging/],
  ['unreviewed expected host', { FIRST_ADMIN_EXPECTED_NEON_HOST: 'ep-other.c-6.us-east-2.aws.neon.tech', CONFIRM_FIRST_ADMIN_TARGET: 'NEON_STAGING:ep-other.c-6.us-east-2.aws.neon.tech/neondb/public' }, /not the reviewed staging target/],
  ['wrong URL host', { DATABASE_URL: stagingUrl('/neondb?sslmode=verify-full', 'ep-other.c-6.us-east-2.aws.neon.tech') }, /host does not match/],
  ['pooler URL host', { DATABASE_URL: stagingUrl('/neondb?sslmode=verify-full', stagingHost.replace('.c-6', '-pooler.c-6')) }, /host does not match/],
  ['wrong URL database', { DATABASE_URL: stagingUrl('/clinic?schema=public&sslmode=verify-full') }, /expected Neon staging database/],
  ['wrong URL schema', { DATABASE_URL: stagingUrl('/neondb?schema=other&sslmode=verify-full') }, /expected Neon staging schema/],
  ['missing TLS verification', { DATABASE_URL: stagingUrl('/neondb?schema=public') }, /sslmode=verify-full/],
  ['weaker TLS', { DATABASE_URL: stagingUrl('/neondb?schema=public&sslmode=require') }, /sslmode=verify-full/],
  ['repeated TLS', { DATABASE_URL: stagingUrl('/neondb?sslmode=verify-full&sslmode=disable') }, /must not repeat/],
  ['repeated schema', { DATABASE_URL: stagingUrl('/neondb?schema=public&schema=other&sslmode=verify-full') }, /must not repeat/],
  ['read-only URL', { DATABASE_URL: stagingUrl('/neondb?sslmode=verify-full&options=-c%20default_transaction_read_only%3Don') }, /must allow.*write/],
  ['unauthenticated URL', { DATABASE_URL: `postgresql://${stagingHost}/neondb?sslmode=verify-full` }, /authenticated PostgreSQL/],
  ['missing username', { FIRST_ADMIN_USERNAME: undefined }, /FIRST_ADMIN_USERNAME/],
  ['blank username', { FIRST_ADMIN_USERNAME: ' ' }, /FIRST_ADMIN_USERNAME/],
  ['missing confirmation', { CONFIRM_FIRST_ADMIN_TARGET: undefined }, /confirmation is required/],
  ['missing runtime role', { RUNTIME_LOGIN_ROLE: undefined }, /RUNTIME_LOGIN_ROLE/],
]) {
  test(`Neon staging refuses ${name}`, () => assert.throws(() => targetConfiguration(stagingEnv(overrides)), error));
}

test('reviewed staging preflight verifies identity, migrations, protected password and no ADMIN without writing', async () => {
  const password = fixture();
  const fake = fakeClient();
  let hashed = 0;
  try {
    const result = await preflightFirstAdmin({ env: stagingEnv({ FIRST_ADMIN_PASSWORD_FILE: password.file }), client: fake.client, hashPassword: async () => { hashed++; return 'discarded'; } });
    assert.deepEqual(result, { mode: 'neon-staging', database: 'neondb', schema: 'public', migrationCount: (await repositoryInventory()).migrations.length });
    assert.equal(hashed, 1);
    assert.equal(fake.created(), 0);
    assert.deepEqual(fake.auditRows, []);
    assert.deepEqual(fake.transactions, [{ isolationLevel: 'Serializable' }]);
  } finally { fs.rmSync(password.dir, { recursive: true, force: true }); }
});

test('staging preflight refuses missing or non-0600 password files before any database query', async () => {
  const bad = fixture('ValidPass1\n', 0o640);
  const client = { $queryRaw: async () => assert.fail('must reject password before querying') };
  try {
    for (const passwordFile of [undefined, path.join(bad.dir, 'missing'), bad.file]) {
      await assert.rejects(preflightFirstAdmin({ env: stagingEnv({ FIRST_ADMIN_PASSWORD_FILE: passwordFile }), client }), /PASSWORD_FILE is required|protected first-administrator password file/);
    }
  } finally { fs.rmSync(bad.dir, { recursive: true, force: true }); }
});

for (const [name, options, error] of [
  ['existing ADMIN', { admins: 1 }, /ADMIN account already exists/],
  ['duplicate username', { usernameExists: true }, /username already exists/],
  ['migration drift', { migrationMismatch: true }, /migration state/],
  ['wrong database identity', { identityOverrides: { database: 'other' } }, /database or schema/],
  ['wrong schema identity', { identityOverrides: { schema: 'other' } }, /database or schema/],
  ['wrong login', { identityOverrides: { session_user: 'owner' } }, /login\/effective role/],
  ['wrong effective role', { identityOverrides: { current_user: 'owner' } }, /login\/effective role/],
  ['superuser', { identityOverrides: { superuser: true } }, /must not be a superuser/],
  ['read-only connection', { identityOverrides: { transaction_read_only: true } }, /narrowly scoped/],
  ['missing audit privilege', { identityOverrides: { can_insert_audit: false } }, /narrowly scoped/],
]) {
  test(`staging preflight refuses ${name} without creating an account`, async () => {
    const password = fixture();
    const fake = fakeClient(options);
    try {
      await assert.rejects(preflightFirstAdmin({ env: stagingEnv(), passwordFile: password.file, client: fake.client, hashPassword: async () => 'discarded' }), error);
      assert.equal(fake.created(), 0);
      assert.deepEqual(fake.auditRows, []);
    } finally { fs.rmSync(password.dir, { recursive: true, force: true }); }
  });
}

test('staging execute creates exactly one ADMIN and its audit record using only an injected fake client', async () => {
  const password = fixture();
  const fake = fakeClient();
  try {
    await provisionFirstAdmin({ env: stagingEnv(), passwordFile: password.file, client: fake.client, hashPassword: async () => 'synthetic-hash' });
    assert.equal(fake.created(), 1);
    assert.equal(fake.adminRows[0].data.role, 'ADMIN');
    assert.equal(fake.adminRows[0].data.passwordHash, 'synthetic-hash');
    assert.equal(fake.auditRows.length, 1);
    assert.equal(fake.auditRows[0].data.action, 'FIRST_ADMIN_PROVISIONED');
    assert.equal(fake.auditRows[0].data.userId, 'new');
    assert.deepEqual(fake.transactions, [{ isolationLevel: 'Serializable' }, { isolationLevel: 'Serializable' }]);
  } finally { fs.rmSync(password.dir, { recursive: true, force: true }); }
});

test('staging execute rechecks ADMIN state after preflight', async () => {
  const password = fixture();
  const fake = fakeClient({ adminCounts: [0, 1] });
  try {
    await assert.rejects(provisionFirstAdmin({ env: stagingEnv(), passwordFile: password.file, client: fake.client, hashPassword: async () => 'synthetic-hash' }), /ADMIN account already exists/);
    assert.equal(fake.created(), 0);
    assert.deepEqual(fake.auditRows, []);
  } finally { fs.rmSync(password.dir, { recursive: true, force: true }); }
});

test('staging CLI refusal does not expose the URL, database password or administrator identity', () => {
  const env = stagingEnv({ CONFIRM_FIRST_ADMIN_TARGET: 'wrong', FIRST_ADMIN_USERNAME: 'private-admin@example.test' });
  const result = spawnSync(process.execPath, ['scripts/provision-first-admin.js', '--preflight'], { cwd: backend, encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /confirmation is required/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /synthetic-secret|private-admin|postgresql:\/\//);
});
