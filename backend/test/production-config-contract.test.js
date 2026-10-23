import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEnvironment } from '../src/config.js';

const valid = {
  NODE_ENV: 'production', STAFF_MFA_POLICY: 'required', RATE_LIMIT_STORE: 'postgres', TRUST_PROXY_HOPS: '1',
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
