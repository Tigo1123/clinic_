import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import prisma from '../src/db.js';
import { validateEnvironment } from '../src/config.js';
import { registrationPurpose } from '../src/services/verification.js';
import { readSmtpConfig } from '../src/utils/smtpConfig.js';
import { sendEmail, sendSMS, smtpTransport } from '../src/utils/notifications.js';
import { clearQaVerificationCapturesForTests, consumeQaVerificationCapture } from '../src/utils/qaVerificationCapture.js';

const baseline = {
  DATABASE_URL: 'postgresql://test:never-connect@ep-test-pooler.us-east-1.aws.neon.tech/neondb?sslmode=verify-full&connection_limit=5&pool_timeout=10',
  SOCKET_REVOCATION_DATABASE_URL: 'postgresql://test:never-connect@ep-test.us-east-1.aws.neon.tech/neondb?sslmode=verify-full',
  JWT_SECRET: 'synthetic-jwt-secret-longer-than-thirty-two-characters',
  MEDICAL_ENCRYPTION_KEY: 'synthetic-medical-key-longer-than-thirty-two-characters',
  MFA_ENCRYPTION_KEY: 'synthetic-mfa-key-longer-than-thirty-two-characters',
  CORS_ALLOWED_ORIGINS: 'https://clinic.example.test',
  CLINIC_TIME_ZONE: 'Africa/Khartoum',
  TRUST_PROXY_HOPS: '1', RATE_LIMIT_STORE: 'postgres',
  RUNTIME_DATABASE_ROLE: 'clinic_runtime',
  SMTP_HOST: 'smtp-relay.brevo.com', SMTP_PORT: '587', SMTP_SECURE: 'false',
  SMTP_USER: 'synthetic-user', SMTP_PASS: 'synthetic-password',
  SMTP_FROM_EMAIL: 'clinic@example.test', NOTIFICATIONS_DISABLED: 'false'
};

function withEnvironment(overrides, check) {
  const previous = { ...process.env };
  const restore = () => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, previous);
  };
  let pending = false;
  try {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, baseline, overrides);
    const result = check();
    if (result instanceof Promise) {
      pending = true;
      return result.finally(restore);
    }
    return result;
  } finally {
    if (!pending) restore();
  }
}

const stagingQa = {
  NODE_ENV: 'production', APP_ENV: 'staging', DEPLOYMENT_ENV: 'staging',
  QA_NOTIFICATION_MODE: 'sink', NOTIFICATIONS_DISABLED: 'true',
  VERIFICATION_PROVIDER: 'email', QA_VERIFICATION_CAPTURE_ENABLED: 'true',
  QA_LOAD_TEST_ALLOWED: 'true', SMS_PROVIDER: 'disabled',
  QA_VERIFICATION_CAPTURE_TOKEN: 'synthetic-staging-capture-token-not-a-real-secret'
};

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

test('normal production email rejects disabled notifications even with valid SMTP', () => {
  for (const disabled of ['true', ' TRUE ']) {
    withEnvironment({ NODE_ENV: 'production', APP_ENV: 'production', DEPLOYMENT_ENV: 'production', VERIFICATION_PROVIDER: 'email', NOTIFICATIONS_DISABLED: disabled }, () => {
      assert.throws(() => validateEnvironment(), /NOTIFICATIONS_DISABLED cannot be true when email verification is enabled/);
    });
  }
});

test('explicit staging QA email sink starts without SMTP while retaining production safeguards', () => {
  for (const marker of ['staging', ' STAGING ']) {
    withEnvironment({ ...stagingQa, APP_ENV: marker, DEPLOYMENT_ENV: marker, SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', SMTP_FROM_EMAIL: '' }, () => {
      const config = validateEnvironment();
      assert.equal(config.production, true);
      assert.equal(config.staffMfaRequired, true);
      assert.equal(config.rateLimitStore, 'postgres');
      assert.equal(registrationPurpose(), 'REGISTRATION_EMAIL');
    });
  }
  withEnvironment({ ...stagingQa, JWT_SECRET: 'short' }, () => {
    assert.throws(() => validateEnvironment(), /JWT_SECRET must be a unique secret/);
  });
});

test('incomplete staging QA configuration cannot bypass disabled notification or SMTP validation', () => {
  for (const key of ['APP_ENV', 'DEPLOYMENT_ENV', 'QA_NOTIFICATION_MODE', 'QA_VERIFICATION_CAPTURE_ENABLED', 'QA_LOAD_TEST_ALLOWED', 'SMS_PROVIDER', 'QA_VERIFICATION_CAPTURE_TOKEN']) {
    withEnvironment({ ...stagingQa, [key]: '', SMTP_PASS: '' }, () => {
      assert.throws(() => validateEnvironment(), /NOTIFICATIONS_DISABLED cannot be true when email verification is enabled/, key);
      assert.throws(() => validateEnvironment(), /SMTP_PASS is required/, key);
    });
  }
  for (const override of [
    { QA_NOTIFICATION_MODE: 'external' }, { QA_VERIFICATION_CAPTURE_ENABLED: 'false' },
    { QA_LOAD_TEST_ALLOWED: 'false' }, { SMS_PROVIDER: 'transport' },
    { QA_VERIFICATION_CAPTURE_TOKEN: 'too-short' }
  ]) {
    withEnvironment({ ...stagingQa, ...override }, () => {
      assert.throws(() => validateEnvironment(), /NOTIFICATIONS_DISABLED cannot be true when email verification is enabled/);
    });
  }
});

test('production environment declarations cannot use QA flags to bypass email validation', () => {
  for (const override of [
    { APP_ENV: 'production' }, { DEPLOYMENT_ENV: 'production' },
    { APP_ENV: ' PRODUCTION ', DEPLOYMENT_ENV: ' STAGING ' },
    { APP_ENV: ' STAGING ', DEPLOYMENT_ENV: ' PRODUCTION ' },
    { APP_ENV: 'production', DEPLOYMENT_ENV: 'production' }
  ]) {
    withEnvironment({ ...stagingQa, ...override }, () => {
      assert.throws(() => validateEnvironment(), /NOTIFICATIONS_DISABLED cannot be true when email verification is enabled/);
    });
  }
});

test('staging QA captures only synthetic registration codes and never calls email or SMS transports', async (t) => {
  clearQaVerificationCapturesForTests();
  t.after(clearQaVerificationCapturesForTests);
  const smtp = t.mock.method(nodemailer, 'createTransport', () => assert.fail('QA must never create an SMTP transport'));
  const recipient = 'qa-20261106-a1b2c3d4+patient-001@example.invalid';
  const challengeId = '123e4567-e89b-42d3-a456-426614174000';
  // Prisma delegates use a proxy, so replace the method directly for this test.
  const findFirst = prisma.verificationChallenge.findFirst;
  t.after(() => { prisma.verificationChallenge.findFirst = findFirst; });
  const challenge = t.mock.fn(async () => ({
    id: challengeId, type: 'REGISTRATION_EMAIL', targetNormalized: recipient,
    usedAt: null, expiresAt: new Date(Date.now() + 60_000),
    user: { email: recipient, username: recipient, role: 'PATIENT', status: 'PENDING_VERIFICATION' }
  }));
  prisma.verificationChallenge.findFirst = challenge;

  await withEnvironment(stagingQa, async () => {
    assert.equal(validateEnvironment().production, true);
    const capture = { challengeId, code: '123456' };
    assert.deepEqual(await sendEmail({ to: recipient, subject: 'QA', text: 'Synthetic code', qaVerificationCapture: capture }), { accepted: true, qaCaptured: true });
    assert.equal(consumeQaVerificationCapture(challengeId)?.code, capture.code);
    assert.equal(consumeQaVerificationCapture(challengeId), null);
    assert.equal(await sendEmail({ to: 'real-recipient@example.test', subject: 'QA', text: 'Sink this', qaVerificationCapture: capture }), null);
    assert.equal(await sendEmail({ to: recipient, subject: 'QA', text: 'No capture metadata' }), null);
    assert.equal(challenge.mock.callCount(), 1, 'real recipients never enter capture lookup');

    const logs = [];
    const sms = t.mock.fn(async () => ({ accepted: true }));
    assert.equal(await sendSMS({ to: '+249912345678', body: 'Sink this' }, { transport: sms, log: async entry => logs.push(entry) }), false);
    assert.equal(sms.mock.callCount(), 0);
    assert.equal(logs[0].data.status, 'SIMULATED');

    // The sink takes precedence even if delivery settings are later changed.
    process.env.NOTIFICATIONS_DISABLED = 'false';
    process.env.SMS_PROVIDER = 'transport';
    assert.equal(await sendEmail({ to: recipient, subject: 'QA', text: 'Still sunk' }), null);
    assert.equal(await sendSMS({ to: '+249912345678', body: 'Still sunk' }, { transport: sms, log: async () => {} }), false);
    assert.equal(sms.mock.callCount(), 0);
    assert.equal(smtp.mock.callCount(), 0);
  });
});
