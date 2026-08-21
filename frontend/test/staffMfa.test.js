import test from 'node:test';
import assert from 'node:assert/strict';
import {
  confirmMfaEnrollment,
  disableMfa,
  regenerateMfaRecoveryCodes,
  startMfaEnrollment
} from '../src/services/staffMfa.js';

function capture(response = {}) {
  const calls = [];
  return {
    calls,
    request: async (path, options) => {
      calls.push({ path, options, body: JSON.parse(options.body) });
      return response;
    }
  };
}

test('enrollment uses the authenticated MFA endpoints without putting sensitive values in URLs or headers', async () => {
  const enrollment = capture({ state: 'PENDING', secret: 'temporary-secret', otpauthUri: 'otpauth://temporary', expiresAt: '2035-01-01T00:00:00Z' });
  await startMfaEnrollment('current-password', enrollment.request);
  assert.equal(enrollment.calls[0].path, '/api/auth/mfa/enroll');
  assert.deepEqual(enrollment.calls[0].body, { currentPassword: 'current-password' });
  assert.equal(enrollment.calls[0].options.headers, undefined);
  assert.equal(enrollment.calls[0].path.includes('current-password'), false);

  const confirmation = capture({ state: 'ENABLED', recoveryCodes: ['recovery-code'] });
  await confirmMfaEnrollment('123456', confirmation.request);
  assert.equal(confirmation.calls[0].path, '/api/auth/mfa/enroll/confirm');
  assert.deepEqual(confirmation.calls[0].body, { code: '123456' });
  assert.equal(confirmation.calls[0].options.headers, undefined);
});

test('recovery regeneration sends exactly one backend-approved MFA proof', async () => {
  const totp = capture({ recoveryCodes: ['new-code'] });
  await regenerateMfaRecoveryCodes('current-password', 'totp', '123456', totp.request);
  assert.deepEqual(totp.calls[0].body, { currentPassword: 'current-password', totpCode: '123456' });
  assert.equal(Object.hasOwn(totp.calls[0].body, 'recoveryCode'), false);

  const recovery = capture({ recoveryCodes: ['new-code'] });
  await regenerateMfaRecoveryCodes('current-password', 'recovery', 'AAAAA-BBBBB-CCCCC-DDDDD', recovery.request);
  assert.deepEqual(recovery.calls[0].body, { currentPassword: 'current-password', recoveryCode: 'AAAAA-BBBBB-CCCCC-DDDDD' });
  assert.equal(Object.hasOwn(recovery.calls[0].body, 'totpCode'), false);
});

test('disable uses DELETE and preserves the backend strong-reauthentication contract', async () => {
  const operation = capture({ state: 'DISABLED' });
  await disableMfa('current-password', 'totp', '654321', operation.request);
  assert.equal(operation.calls[0].path, '/api/auth/mfa');
  assert.equal(operation.calls[0].options.method, 'DELETE');
  assert.deepEqual(operation.calls[0].body, { currentPassword: 'current-password', totpCode: '654321' });
});
