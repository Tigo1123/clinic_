import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as OTPAuth from 'otpauth';
import { decryptMfaSecret, encryptMfaSecret, fingerprintMfaSecret } from '../src/services/mfaCrypto.js';
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

test('full-alphabet Base32 survives parsing, encryption, and decryption without mutation', () => {
  const secret = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const decoded = decodeBase32(secret);
  const encrypted = encryptMfaSecret(secret, 'base32-user');

  assert.equal(secret.length, 32);
  assert.equal(decoded.length, 20);
  assert.equal(OTPAuth.Secret.fromBase32(secret).base32, secret);
  assert.equal(decryptMfaSecret(encrypted, 'base32-user'), secret);
  assert.equal(fingerprintMfaSecret(secret, 'base32-user'), fingerprintMfaSecret(decryptMfaSecret(encrypted, 'base32-user'), 'base32-user'));
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

function decodeBase32(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let accumulator = 0;
  let bitCount = 0;
  const bytes = [];
  for (const character of value.replace(/=+$/g, '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new TypeError('Invalid Base32 test input.');
    accumulator = (accumulator << 5) | index;
    bitCount += 5;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((accumulator >>> bitCount) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

test('production Base32 enrollment and verifier interoperate with independent RFC 6238 codes', () => {
  const secret = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const secretBytes = decodeBase32(secret);
  const label = 'known-vector@example.invalid';
  const issuer = process.env.MFA_TOTP_ISSUER || 'Clinic Management System';
  const timestamp = 2_000_000_000_000;
  const enrollment = buildTotpEnrollment(secret, label);
  const uri = new URL(enrollment.otpauthUri);

  assert.equal(enrollment.secret, secret);
  assert.equal(uri.searchParams.get('secret'), secret);
  assert.equal(uri.searchParams.get('algorithm'), 'SHA1');
  assert.equal(uri.searchParams.get('digits'), '6');
  assert.equal(uri.searchParams.get('period'), '30');
  assert.equal(uri.protocol, 'otpauth:');
  assert.equal(uri.hostname, 'totp');
  assert.equal(decodeURIComponent(uri.pathname), `/${issuer}:${label}`);
  assert.equal(uri.searchParams.get('issuer'), issuer);

  const currentCode = generateRfc6238Sha1(secretBytes, timestamp);
  const previousCode = generateRfc6238Sha1(secretBytes, timestamp - 30_000);
  const nextCode = generateRfc6238Sha1(secretBytes, timestamp + 30_000);
  const tooOldCode = generateRfc6238Sha1(secretBytes, timestamp - 60_000);

  assert.notEqual(validateTotp(secret, currentCode, timestamp), null);
  assert.notEqual(validateTotp(secret, previousCode, timestamp), null);
  assert.notEqual(validateTotp(secret, nextCode, timestamp), null);
  assert.equal(validateTotp(secret, tooOldCode, timestamp), null);
  assert.equal(validateTotp(secret, currentCode === '000000' ? '000001' : '000000', timestamp), null);

  const parsedTotp = OTPAuth.URI.parse(enrollment.otpauthUri);
  assert.equal(parsedTotp.generate({ timestamp }), currentCode);
  assert.equal(generateRfc6238Sha1(parsedTotp.secret.bytes, timestamp), parsedTotp.generate({ timestamp }));
});

test('reported staging timestamp maps to the logged RFC 6238 time step', () => {
  const timestamp = Date.parse('2026-08-22T09:17:50.487Z');
  assert.equal(timestamp, 1_787_390_270_487);
  assert.equal(Math.floor(timestamp / 1000 / 30), 59_579_675);
});

test('recovery codes are random, unique, and high entropy', () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, codes.length);
  codes.forEach((code) => assert.match(code, /^[A-F0-9]{5}(?:-[A-F0-9]{5}){3}$/));
});
