import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readSmtpConfig } from '../src/utils/smtpConfig.js';
import { validateEnvironment } from '../src/config.js';
import { smtpTransport } from '../src/utils/notifications.js';

const valid = {
  SMTP_HOST: 'smtp.example.test',
  SMTP_USER: 'synthetic-user',
  SMTP_PASS: 'Synthetic!@#$%^&*-_+=Pass1',
  SMTP_FROM_EMAIL: 'clinic@example.test'
};

test('SMTP configuration trims surrounding spaces and preserves valid values', () => {
  const config = readSmtpConfig({
    ...valid,
    SMTP_HOST: '  smtp.example.test  ',
    SMTP_USER: '  synthetic-user  ',
    SMTP_PASS: '  Synthetic!@#$%^&*-_+=Pass1  '
  }, { required: true });
  assert.equal(config.host, valid.SMTP_HOST);
  assert.equal(config.user, valid.SMTP_USER);
  assert.equal(config.pass, valid.SMTP_PASS);
  assert.equal(readSmtpConfig(valid, { required: true }).pass, valid.SMTP_PASS);
});

for (const [name, value] of [
  ['SMTP_USER', 'synthetic\nuser'],
  ['SMTP_USER', 'synthetic\ruser'],
  ['SMTP_PASS', 'Synthetic\nPass1'],
  ['SMTP_PASS', 'Synthetic\rPass1'],
  ['SMTP_USER', '   '],
  ['SMTP_PASS', '   '],
  ['SMTP_USER', '"synthetic-user"'],
  ['SMTP_USER', "'synthetic-user'"],
  ['SMTP_PASS', '"SyntheticPass1"'],
  ['SMTP_PASS', "'SyntheticPass1'"]
]) {
  test(`${name} rejects unsafe synthetic input`, () => {
    assert.throws(() => readSmtpConfig({ ...valid, [name]: value }, { required: true }), new RegExp(name));
  });
}

test('production email verification rejects disabled notifications', () => {
  const previous = { ...process.env };
  try {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://clinic.invalid/clinic',
      SOCKET_REVOCATION_DATABASE_URL: 'postgresql://clinic.invalid/clinic',
      JWT_SECRET: 'synthetic-jwt-secret-longer-than-thirty-two-characters',
      MEDICAL_ENCRYPTION_KEY: 'synthetic-medical-key-longer-than-thirty-two-characters',
      MFA_ENCRYPTION_KEY: 'synthetic-mfa-key-longer-than-thirty-two-characters',
      CORS_ALLOWED_ORIGINS: 'https://clinic.example.test',
      CLINIC_TIME_ZONE: 'Africa/Khartoum',
      VERIFICATION_PROVIDER: 'email',
      NOTIFICATIONS_DISABLED: 'true',
      ...valid
    });
    assert.throws(() => validateEnvironment(), /NOTIFICATIONS_DISABLED cannot be true/);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test('production validation rejects malformed SMTP authentication values', () => {
  const previous = { ...process.env };
  const production = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://clinic.invalid/clinic',
    SOCKET_REVOCATION_DATABASE_URL: 'postgresql://clinic.invalid/clinic',
    JWT_SECRET: 'synthetic-jwt-secret-longer-than-thirty-two-characters',
    MEDICAL_ENCRYPTION_KEY: 'synthetic-medical-key-longer-than-thirty-two-characters',
    MFA_ENCRYPTION_KEY: 'synthetic-mfa-key-longer-than-thirty-two-characters',
    CORS_ALLOWED_ORIGINS: 'https://clinic.example.test',
    CLINIC_TIME_ZONE: 'Africa/Khartoum',
    VERIFICATION_PROVIDER: 'email',
    NOTIFICATIONS_DISABLED: 'false',
    ...valid
  };
  try {
    for (const [name, value] of [
      ['SMTP_USER', '   '],
      ['SMTP_PASS', '   '],
      ['SMTP_USER', '"synthetic-user"'],
      ['SMTP_PASS', 'Synthetic\nPass1']
    ]) {
      Object.assign(process.env, production, { [name]: value });
      assert.throws(() => validateEnvironment(), new RegExp(name));
    }
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test('notification transport receives normalized synthetic credentials', () => {
  const config = readSmtpConfig({
    ...valid,
    SMTP_HOST: ' smtp.example.test ',
    SMTP_USER: ' synthetic-user ',
    SMTP_PASS: ' SyntheticPass1 '
  }, { required: true });
  const transport = smtpTransport(config);
  assert.equal(transport.options.host, valid.SMTP_HOST);
  assert.equal(transport.options.auth.user, valid.SMTP_USER);
  assert.equal(transport.options.auth.pass, 'SyntheticPass1');
});

test('notification transport has no direct raw SMTP credential reads', () => {
  const source = fs.readFileSync(fileURLToPath(new URL('../src/utils/notifications.js', import.meta.url)), 'utf8');
  assert.doesNotMatch(source, /process\.env\.SMTP_(?:USER|PASS)/);
  assert.match(source, /auth:\s*\{\s*user:\s*config\.user,\s*pass:\s*config\.pass\s*\}/);
});
