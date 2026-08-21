import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTotpCode } from '../src/utils/mfaCode.js';

test('full six-digit authenticator paste remains intact', () => {
  assert.equal(normalizeTotpCode('524123'), '524123');
});

test('common authenticator clipboard separators are removed before limiting length', () => {
  assert.equal(normalizeTotpCode('524 123'), '524123');
  assert.equal(normalizeTotpCode('524-123'), '524123');
});

test('non-digit characters are removed safely', () => {
  assert.equal(normalizeTotpCode(' code: 5a2b4c1d2e3 '), '524123');
});

test('normalized values are limited to six digits', () => {
  assert.equal(normalizeTotpCode('123456789'), '123456');
  assert.equal(normalizeTotpCode('123-456-789'), '123456');
});

test('ordinary digit-by-digit typing remains stable', () => {
  let value = '';
  for (const digit of '524123') value = normalizeTotpCode(value + digit);
  assert.equal(value, '524123');
});
