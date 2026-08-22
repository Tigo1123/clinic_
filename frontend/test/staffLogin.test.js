import test from 'node:test';
import assert from 'node:assert/strict';
import {
  completeStaffMfa,
  completeStaffMfaRecovery,
  isTerminalMfaError,
  startStaffLogin
} from '../src/services/staffLogin.js';
import i18n from '../src/i18n.js';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

test.beforeEach(() => {
  globalThis.sessionStorage = new MemoryStorage();
  globalThis.localStorage = new MemoryStorage();
});

test('MFA-disabled staff login uses the existing final session path', async () => {
  let finalized;
  const request = async (path, options) => {
    assert.equal(path, '/api/auth/login');
    assert.equal(options.headers?.Authorization, undefined);
    return { user: { id: 'staff-1', role: 'DOCTOR' }, token: 'access-token' };
  };
  const result = await startStaffLogin(
    { username: 'staff@example.test', password: 'test-password' },
    (user, token) => { finalized = { user, token }; },
    request
  );
  assert.equal(result.state, 'AUTHENTICATED');
  assert.equal(finalized.token, 'access-token');
});

test('MFA challenge remains temporary and does not authenticate or persist', async () => {
  let finalizeCalls = 0;
  const result = await startStaffLogin(
    { username: 'staff@example.test', password: 'test-password' },
    () => { finalizeCalls += 1; },
    async () => ({ mfaRequired: true, challengeToken: 'temporary-challenge', expiresAt: '2035-01-01T00:00:00.000Z' })
  );
  assert.equal(result.state, 'MFA_REQUIRED');
  assert.equal(finalizeCalls, 0);
  assert.equal(sessionStorage.values.size, 0);
  assert.equal(localStorage.values.size, 0);
});

test('MFA completion uses a public request and the same final session path', async () => {
  let finalized;
  const result = await completeStaffMfa('temporary-challenge', '123456', (user, token) => {
    finalized = { user, token };
  }, async (path, options) => {
    assert.equal(path, '/api/auth/mfa/verify');
    assert.equal(options.headers?.Authorization, undefined);
    assert.deepEqual(JSON.parse(options.body), { challengeToken: 'temporary-challenge', code: '123456' });
    return { user: { id: 'staff-1', role: 'RECEPTIONIST' }, token: 'final-access-token' };
  });
  assert.equal(result.state, 'AUTHENTICATED');
  assert.equal(finalized.token, 'final-access-token');
  assert.equal(sessionStorage.values.size, 0);
  assert.equal(localStorage.values.size, 0);
});

test('recovery-code MFA completion reuses the challenge and final session path without persistence', async () => {
  let finalized;
  const result = await completeStaffMfaRecovery('temporary-challenge', 'AAAAA-BBBBB-CCCCC-DDDDD', (user, token, context) => {
    finalized = { user, token, context };
  }, async (path, options) => {
    assert.equal(path, '/api/auth/mfa/recovery/verify');
    assert.equal(options.headers?.Authorization, undefined);
    assert.deepEqual(JSON.parse(options.body), {
      challengeToken: 'temporary-challenge',
      recoveryCode: 'AAAAA-BBBBB-CCCCC-DDDDD'
    });
    return { user: { id: 'staff-1', role: 'RECEPTIONIST' }, token: 'final-access-token' };
  });
  assert.equal(result.state, 'AUTHENTICATED');
  assert.equal(finalized.token, 'final-access-token');
  assert.deepEqual(finalized.context, { mfaMethod: 'RECOVERY_CODE' });
  assert.equal(sessionStorage.values.size, 0);
  assert.equal(localStorage.values.size, 0);
});

test('only terminal challenge errors force the UI back to password login', () => {
  assert.equal(isTerminalMfaError({ code: 'MFA_CODE_INVALID' }), false);
  assert.equal(isTerminalMfaError({ code: 'MFA_CHALLENGE_INVALID' }), true);
  assert.equal(isTerminalMfaError({ status: 429, code: 'MFA_RATE_LIMITED' }), false);
});

test('recovery login labels are available in English and Arabic', async () => {
  await i18n.changeLanguage('en');
  assert.equal(i18n.t('useRecoveryCode'), 'Use a recovery code');
  assert.equal(i18n.t('verifyRecoveryCode'), 'Verify recovery code');
  await i18n.changeLanguage('ar');
  assert.equal(i18n.t('useRecoveryCode'), 'استخدم رمز استرداد');
  assert.equal(i18n.t('verifyRecoveryCode'), 'تأكيد رمز الاسترداد');
});
