import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import prisma from '../src/db.js';

// Synthetic production-mode configuration only. No database/listener is started;
// every readiness query is replaced before importing the server.
const syntheticUrl = 'postgresql://fixture:never-connect@ep-fixture-pooler.region.aws.neon.tech/neondb?sslmode=verify-full&connection_limit=5&pool_timeout=10';
Object.assign(process.env, {
  NODE_ENV: 'production', DATABASE_PROVIDER: 'neon', STAFF_MFA_POLICY: 'required', RATE_LIMIT_STORE: 'postgres',
  TRUST_PROXY_HOPS: '1', RUNTIME_DATABASE_ROLE: 'clinic_runtime',
  DATABASE_URL: syntheticUrl, DIRECT_URL: syntheticUrl.replace('fixture:never-connect', 'migration:never-connect').replace('-pooler.', '.'),
  SOCKET_REVOCATION_DATABASE_URL: syntheticUrl.replace('-pooler.', '.'),
  JWT_SECRET: 'synthetic-signing-secret-never-used-outside-this-test',
  MEDICAL_ENCRYPTION_KEY: 'synthetic-medical-key-never-used-outside-this-test',
  MFA_ENCRYPTION_KEY: 'synthetic-mfa-key-never-used-outside-this-test',
  CORS_ALLOWED_ORIGINS: 'https://clinic.example.test', CLINIC_TIME_ZONE: 'Africa/Khartoum',
  VERIFICATION_PROVIDER: 'disabled', PHONE_VERIFICATION_PROVIDER: 'disabled'
});
let identity;
prisma.$queryRaw = async () => identity ? [identity] : [];
const { app, socketRevocation, shutdown } = await import('../src/server.js');
socketRevocation.isReady = () => true;
process.env.DATABASE_PROVIDER = 'self-managed';
const selfManaged = await import('../src/server.js?selfManagedReadiness');
selfManaged.socketRevocation.isReady = () => true;
process.env.DATABASE_PROVIDER = 'neon';
after(async () => {
  await shutdown('readiness-diagnostics-test');
  await selfManaged.shutdown('self-managed-readiness-test');
});
const healthy = {
  database: 'neondb', role: 'clinic_runtime', schema: 'public',
  limiter_table_access: true, superuser: false, can_create_roles: false, can_create_databases: false
};

test('production readiness rejection logs only safe identity diagnostics and keeps its public response unchanged', async (t) => {
  const warnings = t.mock.method(console, 'warn', () => {});
  const secretMarkers = [syntheticUrl, 'synthetic-private-password', 'synthetic-private-token', 'private-host.example.invalid'];
  const failures = [
    { database: 'unexpected_database' }, { role: 'unexpected_role' }, { schema: 'unexpected_schema' },
    { limiter_table_access: false }, { superuser: true }
  ];
  for (const mismatch of failures) {
    identity = { ...healthy, can_create_roles: true, can_create_databases: true, ...mismatch, DATABASE_URL: syntheticUrl, DIRECT_URL: syntheticUrl.replace('fixture:never-connect', 'migration:never-connect').replace('-pooler.', '.'),
      password: secretMarkers[1], token: secretMarkers[2], hostname: secretMarkers[3] };
    const response = await request(app).get('/api/health/ready');
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, { status: 'unhealthy', dependency: 'production_database_identity_or_limiter' });
    const entry = JSON.parse(warnings.mock.calls.at(-1).arguments[0]);
    assert.equal(entry.level, 'WARN');
    assert.equal(entry.event, 'health.production_database_identity_or_limiter');
    const { timestamp, level, event, ...fields } = entry;
    assert.deepEqual(fields, {
      database: identity.database, role: identity.role, schema: identity.schema, expectedRole: 'clinic_runtime',
      limiterTableAccess: identity.limiter_table_access, superuser: identity.superuser,
      canCreateRoles: identity.can_create_roles, canCreateDatabases: identity.can_create_databases
    });
    for (const marker of secretMarkers) {
      assert.equal(response.text.includes(marker), false);
      assert.equal(JSON.stringify(entry).includes(marker), false);
    }
  }
  assert.equal(warnings.mock.callCount(), failures.length);
});

test('missing identity remains unhealthy and logs only nullable safe fields', async (t) => {
  const warnings = t.mock.method(console, 'warn', () => {});
  identity = null;
  const response = await request(app).get('/api/health/ready');
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { status: 'unhealthy', dependency: 'production_database_identity_or_limiter' });
  const { timestamp, level, event, ...fields } = JSON.parse(warnings.mock.calls[0].arguments[0]);
  assert.deepEqual(fields, { database: null, role: null, schema: null, expectedRole: 'clinic_runtime',
    limiterTableAccess: null, superuser: null, canCreateRoles: null, canCreateDatabases: null });
});

test('healthy production identity retains 200 readiness and emits no diagnostic warning', async (t) => {
  const warnings = t.mock.method(console, 'warn', () => {});
  identity = { ...healthy };
  const response = await request(app).get('/api/health/ready');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'healthy' });
  assert.equal(warnings.mock.callCount(), 0);
});


test('Neon provider-managed role/database capabilities remain diagnostic and do not fail readiness', async (t) => {
  const infos = t.mock.method(console, 'log', () => {});
  for (const capabilities of [
    { can_create_roles: true, can_create_databases: true },
    { can_create_roles: true, can_create_databases: false },
    { can_create_roles: false, can_create_databases: true }
  ]) {
    identity = { ...healthy, ...capabilities };
    const response = await request(app).get('/api/health/ready');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: 'healthy' });
    const entry = infos.mock.calls.map((call) => JSON.parse(call.arguments[0]))
      .filter((row) => row.event === 'health.neon_managed_role_capabilities').at(-1);
    const { timestamp, level, event, ...fields } = entry;
    assert.equal(level, 'INFO');
    assert.deepEqual(fields, { role: 'clinic_runtime', canCreateRoles: capabilities.can_create_roles, canCreateDatabases: capabilities.can_create_databases });
    assert.doesNotMatch(response.text, /clinic_runtime|canCreate|superuser|postgres(?:ql)?:|never-connect/);
  }
});

test('Neon provider exception never bypasses socket revocation readiness', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(socketRevocation, 'isReady', () => false);
  identity = { ...healthy, can_create_roles: true, can_create_databases: true };
  const response = await request(app).get('/api/health/ready');
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { status: 'unhealthy' });
});

test('self-managed production retains strict role and database creation checks and safe HTTP responses', async (t) => {
  t.mock.method(console, 'warn', () => {});
  for (const capabilities of [
    { can_create_roles: true }, { can_create_databases: true },
    { can_create_roles: true, can_create_databases: true }, { superuser: true }
  ]) {
    identity = { ...healthy, ...capabilities };
    const response = await request(selfManaged.app).get('/api/health/ready');
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, { status: 'unhealthy', dependency: 'production_database_identity_or_limiter' });
    assert.doesNotMatch(response.text, /clinic_runtime|canCreate|superuser|postgres(?:ql)?:|never-connect/);
  }
  identity = { ...healthy };
  const response = await request(selfManaged.app).get('/api/health/ready');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'healthy' });
});
