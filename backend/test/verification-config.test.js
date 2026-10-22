import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEnvironment } from '../src/config.js';
import { registrationPurpose } from '../src/services/verification.js';
import { readSmtpConfig } from '../src/utils/smtpConfig.js';
import { smtpTransport } from '../src/utils/notifications.js';

const baseline = {
  DATABASE_URL: 'postgresql://localhost/never_connect_test',
  SOCKET_REVOCATION_DATABASE_URL: 'postgresql://localhost/never_connect_test',
  JWT_SECRET: 'synthetic-jwt-secret-longer-than-thirty-two-characters',
  MEDICAL_ENCRYPTION_KEY: 'synthetic-medical-key-longer-than-thirty-two-characters',
  MFA_ENCRYPTION_KEY: 'synthetic-mfa-key-longer-than-thirty-two-characters',
  CORS_ALLOWED_ORIGINS: 'https://clinic.example.test',
  CLINIC_TIME_ZONE: 'Africa/Khartoum',
  SMTP_HOST: 'smtp-relay.brevo.com', SMTP_PORT: '587', SMTP_SECURE: 'false',
  SMTP_USER: 'synthetic-user', SMTP_PASS: 'synthetic-password',
  SMTP_FROM_EMAIL: 'clinic@example.test', NOTIFICATIONS_DISABLED: 'false'
};

function withEnvironment(overrides, check) {
  const previous = { ...process.env };
  try {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, baseline, overrides);
    return check();
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, previous);
  }
}

test('development verification fails at startup for missing or invalid NODE_ENV', () => {
  for (const nodeEnv of [undefined, '', 'staging', 'developmnt']) {
    const overrides = { VERIFICATION_PROVIDER: 'development' };
    if (nodeEnv !== undefined) overrides.NODE_ENV = nodeEnv;
    withEnvironment(overrides, () => {
      assert.throws(() => validateEnvironment(), /VERIFICATION_PROVIDER=development requires NODE_ENV=development or test/);
    });
  }
});

test('explicit development and test simulation remain supported', () => {
  for (const NODE_ENV of ['development', 'test']) {
    withEnvironment({ NODE_ENV, VERIFICATION_PROVIDER: 'development' }, () => {
      assert.equal(validateEnvironment().production, false);
      assert.equal(registrationPurpose(), 'REGISTRATION_PHONE');
    });
  }
});

test('local email verification selects email with a Brevo SMTP transport even when phone verification is disabled', () => {
  withEnvironment({ NODE_ENV: 'development', VERIFICATION_PROVIDER: 'email', PHONE_VERIFICATION_PROVIDER: 'disabled' }, () => {
    assert.equal(validateEnvironment().production, false);
    assert.equal(registrationPurpose(), 'REGISTRATION_EMAIL');
    const transport = smtpTransport(readSmtpConfig(process.env, { required: true }));
    try {
      assert.equal(transport.options.host, 'smtp-relay.brevo.com');
      assert.equal(transport.options.port, 587);
      assert.equal(transport.options.secure, false);
      assert.equal(transport.options.auth.user, baseline.SMTP_USER);
      assert.equal(transport.options.auth.pass, baseline.SMTP_PASS);
    } finally { transport.close(); }
  });
});

test('production continues to forbid development verification and enforce SMTP validation', () => {
  withEnvironment({ NODE_ENV: 'production', VERIFICATION_PROVIDER: 'development' }, () => {
    assert.throws(() => validateEnvironment(), /development verification provider is forbidden in production/);
  });
  withEnvironment({ NODE_ENV: 'production', VERIFICATION_PROVIDER: 'email', SMTP_PASS: '' }, () => {
    assert.throws(() => validateEnvironment(), /SMTP_PASS is required/);
  });
  withEnvironment({ NODE_ENV: 'production', VERIFICATION_PROVIDER: 'email' }, () => {
    assert.equal(validateEnvironment().production, true);
    assert.equal(registrationPurpose(), 'REGISTRATION_EMAIL');
  });
});
