import test from 'node:test';
import assert from 'node:assert/strict';
import { sendPhoneVerificationCode, phoneVerificationProvider } from '../src/services/phoneVerification.js';

test('development phone delivery is injectable and receives only delivery fields', async () => {
  const calls = [];
  const result = await sendPhoneVerificationCode(
    { destination: '+250788123456', code: '123456', purpose: 'REGISTRATION_PHONE', language: 'en' },
    { env: { NODE_ENV: 'test', PHONE_VERIFICATION_PROVIDER: 'development' }, delivery: async (input) => { calls.push(input); return { accepted: true }; } }
  );
  assert.deepEqual(result, { accepted: true });
  assert.deepEqual(calls, [{ destination: '+250788123456', code: '123456', purpose: 'REGISTRATION_PHONE', language: 'en' }]);
});

test('phone delivery defaults to development only outside production and never exposes a production code', async () => {
  assert.equal(phoneVerificationProvider({ NODE_ENV: 'test', VERIFICATION_PROVIDER: 'development' }), 'development');
  assert.equal(phoneVerificationProvider({ NODE_ENV: 'production' }), 'disabled');
  const result = await sendPhoneVerificationCode(
    { destination: '+250788123456', code: '123456', purpose: 'REGISTRATION_PHONE' },
    { env: { NODE_ENV: 'test', PHONE_VERIFICATION_PROVIDER: 'development' } }
  );
  assert.equal(result.developmentCode, '123456');
  await assert.rejects(
    sendPhoneVerificationCode({ destination: '+250788123456', code: '123456', purpose: 'REGISTRATION_PHONE' }, { env: { NODE_ENV: 'production', PHONE_VERIFICATION_PROVIDER: 'development' } }),
    { code: 'VERIFICATION_UNAVAILABLE', status: 503 }
  );
});

test('disabled phone delivery and provider failures are controlled and sanitized', async () => {
  await assert.rejects(
    sendPhoneVerificationCode({ destination: '+250788123456', code: '123456', purpose: 'REGISTRATION_PHONE' }, { env: { NODE_ENV: 'test', PHONE_VERIFICATION_PROVIDER: 'disabled' } }),
    { code: 'VERIFICATION_UNAVAILABLE', status: 503 }
  );
  await assert.rejects(
    sendPhoneVerificationCode({ destination: '+250788123456', code: '123456', purpose: 'REGISTRATION_PHONE' }, { env: { NODE_ENV: 'test', PHONE_VERIFICATION_PROVIDER: 'development' }, delivery: async () => { throw new Error('vendor secret and token'); } }),
    { code: 'VERIFICATION_DELIVERY_FAILED', status: 503, message: 'Verification could not be delivered.' }
  );
});
