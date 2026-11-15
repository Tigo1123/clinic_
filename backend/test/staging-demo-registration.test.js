import test from 'node:test';
import assert from 'node:assert/strict';
import { stagingDemoRegistrationEnabled, stagingDemoIdentityAllowed } from '../src/services/stagingDemoRegistration.js';

const safeStaging = {
  STAGING_DEMO_REGISTRATION: 'true',
  DEPLOYMENT_ENV: 'staging',
  NODE_ENV: 'production',
  VERIFICATION_PROVIDER: 'disabled',
  NOTIFICATIONS_DISABLED: 'true',
  DATABASE_URL: 'postgresql://placeholder:example@ep-solitary-dust-b4xeyh77-pooler.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require&connection_limit=5&pool_timeout=10',
  SOCKET_REVOCATION_DATABASE_URL: 'postgresql://placeholder:example@ep-solitary-dust-b4xeyh77.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require',
  CORS_ALLOWED_ORIGINS: 'https://clinic-production-web-test.onrender.com,https://clinic-staging-web.onrender.com'
};

test('demo registration is possible only on the explicitly pinned isolated staging branch', () => {
  assert.equal(stagingDemoRegistrationEnabled(safeStaging), true);
  for (const [name, value] of [
    ['STAGING_DEMO_REGISTRATION', 'false'],
    ['DEPLOYMENT_ENV', 'production'],
    ['NODE_ENV', 'development'],
    ['VERIFICATION_PROVIDER', 'email'],
    ['NOTIFICATIONS_DISABLED', 'false'],
    ['DATABASE_URL', safeStaging.DATABASE_URL.replace('ep-solitary-dust-b4xeyh77', 'ep-another-branch')],
    ['DATABASE_URL', safeStaging.DATABASE_URL.replace('/neondb?', '/postgres?')],
    ['SOCKET_REVOCATION_DATABASE_URL', safeStaging.SOCKET_REVOCATION_DATABASE_URL.replace('ep-solitary-dust-b4xeyh77', 'ep-another-branch')],
    ['CORS_ALLOWED_ORIGINS', 'https://clinic-production-web.onrender.com'],
  ]) assert.equal(stagingDemoRegistrationEnabled({ ...safeStaging, [name]: value }), false, name);
  assert.equal(stagingDemoRegistrationEnabled({ ...safeStaging, DATABASE_URL: 'not-a-url' }), false);
});

test('demo signup requires fictional email and reserved non-real phone', () => {
  assert.equal(stagingDemoIdentityAllowed('qa+patient1@clinic-qa.invalid', '+250785550123'), true);
  assert.equal(stagingDemoIdentityAllowed('qa+patient-2@clinic-qa.invalid', '+250785550199'), true);
  for (const [email, phone] of [
    ['person@gmail.com', '+250785550123'],
    ['qa+patient1@clinic-qa.invalid', '+249911111111'],
    ['qa+patient1@clinic-qa.invalid', '+250785550223'],
    ['qa+patient1@clinic-qa.invalid', '+2507855501231'],
    ['qa+patient1@clinic-qa.invalid.evil.example', '+250785550123'],
    ['qa+x@clinic-qa.invalid', '+250785550123'],
  ]) assert.equal(stagingDemoIdentityAllowed(email, phone), false, email);
});
