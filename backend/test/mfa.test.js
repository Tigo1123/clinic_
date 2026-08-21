import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as OTPAuth from 'otpauth';
import { decryptMfaSecret, encryptMfaSecret } from '../src/services/mfaCrypto.js';
import { buildTotpEnrollment, generateRecoveryCodes, generateTotpEnrollment, validateTotp } from '../src/services/mfa.js';

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

function generateRfc6238Sha1(secretBytes, timestamp, digits = 6, period = 30) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timestamp / 1000 / period)));
  const digest = crypto.createHmac('sha1', secretBytes).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % (10 ** digits)).padStart(digits, '0');
}

test('production Base32 enrollment and verifier interoperate with independent RFC 6238 codes', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const secretBytes = Buffer.from('12345678901234567890', 'ascii');
  const label = 'known-vector@example.invalid';
  const timestamp = 2_000_000_000_000;
  const enrollment = buildTotpEnrollment(secret, label);
  const uri = new URL(enrollment.otpauthUri);

  assert.equal(enrollment.secret, secret);
  assert.equal(uri.searchParams.get('secret'), secret);
  assert.equal(uri.searchParams.get('algorithm'), 'SHA1');
  assert.equal(uri.searchParams.get('digits'), '6');
  assert.equal(uri.searchParams.get('period'), '30');

  const currentCode = generateRfc6238Sha1(secretBytes, timestamp);
  const previousCode = generateRfc6238Sha1(secretBytes, timestamp - 30_000);
  const nextCode = generateRfc6238Sha1(secretBytes, timestamp + 30_000);
  const tooOldCode = generateRfc6238Sha1(secretBytes, timestamp - 60_000);

  assert.notEqual(validateTotp(secret, currentCode, timestamp), null);
  assert.notEqual(validateTotp(secret, previousCode, timestamp), null);
  assert.notEqual(validateTotp(secret, nextCode, timestamp), null);
  assert.equal(validateTotp(secret, tooOldCode, timestamp), null);
  assert.equal(validateTotp(secret, currentCode === '000000' ? '000001' : '000000', timestamp), null);
});

test('recovery codes are random, unique, and high entropy', () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, codes.length);
  codes.forEach((code) => assert.match(code, /^[A-F0-9]{5}(?:-[A-F0-9]{5}){3}$/));
});
