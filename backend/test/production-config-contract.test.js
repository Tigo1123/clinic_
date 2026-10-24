import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { isolatedDatabaseUrl } from './helpers/testRunner.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEnvironment } from '../src/config.js';

const valid = {
  NODE_ENV: 'production', DATABASE_PROVIDER: 'neon', STAFF_MFA_POLICY: 'required', RATE_LIMIT_STORE: 'postgres', TRUST_PROXY_HOPS: '1',
  RUNTIME_DATABASE_ROLE: 'clinic_runtime',
  DATABASE_URL: 'postgresql://runtime:never-connect@ep-reviewed-pooler.region.aws.neon.tech/neondb?schema=public&sslmode=verify-full&connection_limit=5&pool_timeout=10',
  SOCKET_REVOCATION_DATABASE_URL: 'postgresql://listener:never-connect@ep-reviewed.region.aws.neon.tech/neondb?schema=public&sslmode=verify-full',
  JWT_SECRET: 'unique-test-jwt-signing-value-longer-than-32-chars',
  MEDICAL_ENCRYPTION_KEY: 'unique-test-medical-encryption-value-longer-than-32',
  MFA_ENCRYPTION_KEY: 'unique-test-mfa-encryption-value-longer-than-32-characters',
  CORS_ALLOWED_ORIGINS: 'https://clinic.example.test', CLINIC_TIME_ZONE: 'Africa/Khartoum',
  VERIFICATION_PROVIDER: 'disabled'
};

function withEnvironment(overrides, callback) {
  const previous = { ...process.env };
  try {
    Object.assign(process.env, valid, overrides);
    callback();
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
}

test('production runtime configuration pins pooled Neon neondb/public, TLS, shared limits, role, and proxy hops', () => {
  withEnvironment({}, () => {
    const config = validateEnvironment();
    assert.equal(config.production, true);
    assert.equal(config.databaseProvider, 'neon');
    assert.equal(config.staffMfaRequired, true);
    assert.equal(config.rateLimitStore, 'postgres');
    assert.equal(config.runtimeDatabaseRole, 'clinic_runtime');
    assert.equal(config.trustProxyHops, 1);
  });
});

test('production refuses direct runtime URLs, wrong database/schema, missing TLS/pool caps, local limiter, and implicit proxy trust', () => {
  const invalidCases = [
    [{ DATABASE_URL: 'postgresql://x:y@ep-reviewed.region.aws.neon.tech/neondb?schema=public&sslmode=verify-full&connection_limit=5&pool_timeout=10' }, /pooled hostname/],
    [{ DATABASE_URL: 'postgresql://x:y@ep-reviewed-pooler.region.aws.neon.tech/other?schema=public&sslmode=verify-full&connection_limit=5&pool_timeout=10' }, /database neondb/],
    [{ DATABASE_URL: 'postgresql://x:y@ep-reviewed-pooler.region.aws.neon.tech/neondb?schema=private&sslmode=verify-full&connection_limit=5&pool_timeout=10' }, /schema public/],
    [{ DATABASE_URL: 'postgresql://x:y@ep-reviewed-pooler.region.aws.neon.tech/neondb?schema=public&connection_limit=5&pool_timeout=10' }, /require TLS/],
    [{ DATABASE_URL: 'postgresql://x:y@ep-reviewed-pooler.region.aws.neon.tech/neondb?schema=public&sslmode=verify-full&pool_timeout=10' }, /connection_limit/],
    [{ RATE_LIMIT_STORE: 'memory' }, /RATE_LIMIT_STORE must be postgres/],
    [{ TRUST_PROXY_HOPS: '' }, /TRUST_PROXY_HOPS/],
    [{ RUNTIME_DATABASE_ROLE: '' }, /RUNTIME_DATABASE_ROLE/]
  ];
  for (const [overrides, message] of invalidCases) {
    withEnvironment(overrides, () => assert.throws(() => validateEnvironment(), message));
  }
});


test('managed provider exception requires explicit Neon selection and validated Neon endpoints', () => {
  withEnvironment({ DATABASE_PROVIDER: 'unknown' }, () => assert.throws(() => validateEnvironment(), /DATABASE_PROVIDER/));
  withEnvironment({ DATABASE_PROVIDER: '' }, () => assert.equal(validateEnvironment().databaseProvider, 'self-managed'));
  withEnvironment({}, () => {
    delete process.env.DATABASE_PROVIDER;
    assert.equal(validateEnvironment().databaseProvider, 'self-managed');
  });
  withEnvironment({ DATABASE_URL: valid.DATABASE_URL.replace('region.aws.neon.tech', 'postgres.example.test') }, () => {
    assert.throws(() => validateEnvironment(), /reviewed Neon PostgreSQL/);
  });
  withEnvironment({ SOCKET_REVOCATION_DATABASE_URL: valid.SOCKET_REVOCATION_DATABASE_URL.replace('region.aws.neon.tech', 'postgres.example.test') }, () => {
    assert.throws(() => validateEnvironment(), /reviewed Neon PostgreSQL/);
  });
});

test('self-managed production supports non-Neon endpoints while retaining identity, TLS and pool requirements', () => {
  const selfManaged = {
    DATABASE_PROVIDER: 'self-managed',
    DATABASE_URL: 'postgresql://runtime:never-connect@postgres.example.test/neondb?schema=public&sslmode=verify-full&connection_limit=5&pool_timeout=10',
    SOCKET_REVOCATION_DATABASE_URL: 'postgresql://listener:never-connect@postgres.example.test/neondb?schema=public&sslmode=verify-full'
  };
  withEnvironment(selfManaged, () => assert.equal(validateEnvironment().databaseProvider, 'self-managed'));
  for (const [oldValue, newValue, message] of [
    ['/neondb', '/other', /database neondb/], ['schema=public', 'schema=private', /schema public/],
    ['sslmode=verify-full', 'sslmode=disable', /require TLS/], ['connection_limit=5', 'connection_limit=0', /connection_limit/],
    ['pool_timeout=10', 'pool_timeout=0', /pool_timeout/]
  ]) {
    withEnvironment({ ...selfManaged, DATABASE_URL: selfManaged.DATABASE_URL.replace(oldValue, newValue) }, () => assert.throws(() => validateEnvironment(), message));
  }
});


test('the readiness SQL requires every limiter CRUD privilege, not merely one', async () => {
  const schema = new URL(process.env.DATABASE_URL).searchParams.get('schema');
  const url = isolatedDatabaseUrl(process.env.DATABASE_URL, schema, process.env.TEST_DATABASE_PORT || '5433');
  const client = new Client({ connectionString: url });
  const role = `test_limiter_privileges_${process.pid}`;
  const source = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const query = source.match(/const \[identity\] = await prisma\.\$queryRaw`([\s\S]*?)`;/)[1]
    .replaceAll('public.', `"${schema}".`);
  await client.connect();
  try {
    await client.query(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB`);
    await client.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`);
    await client.query(`SET ROLE "${role}"`);
    assert.equal((await client.query(query)).rows[0].limiter_table_access, false);
    await client.query('RESET ROLE');
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${schema}"."RateLimitBucket" TO "${role}"`);
    await client.query(`SET ROLE "${role}"`);
    assert.equal((await client.query(query)).rows[0].limiter_table_access, true);
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      await client.query('RESET ROLE');
      await client.query(`REVOKE ${privilege} ON "${schema}"."RateLimitBucket" FROM "${role}"`);
      await client.query(`SET ROLE "${role}"`);
      assert.equal((await client.query(query)).rows[0].limiter_table_access, false, `missing ${privilege} must fail`);
      await client.query('RESET ROLE');
      await client.query(`GRANT ${privilege} ON "${schema}"."RateLimitBucket" TO "${role}"`);
    }
  } finally {
    await client.query('RESET ROLE');
    await client.query(`DROP OWNED BY "${role}"`);
    await client.query(`DROP ROLE "${role}"`);
    await client.end();
  }
});
