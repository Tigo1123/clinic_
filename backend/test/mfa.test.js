import test from 'node:test';
import assert from 'node:assert/strict';
import * as OTPAuth from 'otpauth';
import { decryptMfaSecret, encryptMfaSecret } from '../src/services/mfaCrypto.js';
import { generateRecoveryCodes, generateTotpEnrollment, validateTotp } from '../src/services/mfa.js';

process.env.MFA_ENCRYPTION_KEY ||= 'test-mfa-key-separate-at-least-thirty-two-characters';

test('MFA secret encryption is authenticated and bound to the user', () => {
  const secret = 'TESTONLYBASE32SECRET';
  const encrypted = encryptMfaSecret(secret, 'user-a');
  assert.notEqual(encrypted, secret);
  assert.equal(encrypted.includes(secret), false);
  assert.equal(decryptMfaSecret(encrypted, 'user-a'), secret);
  assert.throws(() => decryptMfaSecret(encrypted, 'user-b'));
  assert.throws(() => decryptMfaSecret('malformed', 'user-a'));
  assert.throws(() => decryptMfaSecret(`${encrypted.slice(0, -2)}aa`, 'user-a'));
});

test('TOTP enrollment is standards-compatible and uses a narrow validation window', () => {
  const enrollment = generateTotpEnrollment('test@example.invalid');
  assert.match(enrollment.otpauthUri, /^otpauth:\/\/totp\//);
  const totp = new OTPAuth.TOTP({
    issuer: process.env.MFA_TOTP_ISSUER || 'Clinic Management System',
    label: 'test@example.invalid',
    algorithm: 'SHA1', digits: 6, period: 30,
    secret: OTPAuth.Secret.fromBase32(enrollment.secret)
  });
  const timestamp = 2_000_000_000_000;
  assert.notEqual(validateTotp(enrollment.secret, totp.generate({ timestamp }), timestamp), null);
  assert.notEqual(validateTotp(enrollment.secret, totp.generate({ timestamp: timestamp - 30_000 }), timestamp), null);
  assert.equal(validateTotp(enrollment.secret, totp.generate({ timestamp: timestamp - 60_000 }), timestamp), null);
  assert.equal(validateTotp(enrollment.secret, 'not-a-code', timestamp), null);
});

test('recovery codes are random, unique, and high entropy', () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, codes.length);
  codes.forEach((code) => assert.match(code, /^[A-F0-9]{5}(?:-[A-F0-9]{5}){3}$/));
});
