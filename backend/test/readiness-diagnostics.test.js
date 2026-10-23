import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import prisma from '../src/db.js';

// Synthetic production-mode configuration only. No database/listener is started;
// every readiness query is replaced before importing the server.
const syntheticUrl = 'postgresql://fixture:never-connect@ep-fixture-pooler.region.aws.neon.tech/neondb?sslmode=verify-full&connection_limit=5&pool_timeout=10';
Object.assign(process.env, {
  NODE_ENV: 'production', STAFF_MFA_POLICY: 'required', RATE_LIMIT_STORE: 'postgres',
  TRUST_PROXY_HOPS: '1', RUNTIME_DATABASE_ROLE: 'clinic_runtime',
  DATABASE_URL: syntheticUrl, DIRECT_URL: syntheticUrl,
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
after(() => shutdown('readiness-diagnostics-test'));
const healthy = {
  database: 'neondb', role: 'clinic_runtime', schema: 'public',
  limiter_table_access: true, superuser: false, can_create_roles: false, can_create_databases: false
};

test('production readiness rejection logs only safe identity diagnostics and keeps its public response unchanged', async (t) => {
  const warnings = t.mock.method(console, 'warn', () => {});
  const secretMarkers = [syntheticUrl, 'synthetic-private-password', 'synthetic-private-token', 'private-host.example.invalid'];
  const failures = [
    { database: 'unexpected_database' }, { role: 'unexpected_role' }, { schema: 'unexpected_schema' },
    { limiter_table_access: false }, { superuser: true }, { can_create_roles: true }, { can_create_databases: true }
  ];
  for (const mismatch of failures) {
    identity = { ...healthy, ...mismatch, DATABASE_URL: syntheticUrl, DIRECT_URL: syntheticUrl,
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
