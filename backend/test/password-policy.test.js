import test from 'node:test';
import assert from 'node:assert/strict';
import { passwordSchema } from '../src/utils/passwordPolicy.js';

test('password policy accepts a password meeting every requirement', () => {
  assert.equal(passwordSchema.safeParse('ValidPass1').success, true);
});

test('password policy rejects missing and weak passwords', () => {
  for (const password of [
    undefined,
    '',
    'Short1A',
    'alllowercase1',
    'ALLUPPERCASE1',
    'NoNumberHere'
  ]) {
    assert.equal(passwordSchema.safeParse(password).success, false);
  }
});
