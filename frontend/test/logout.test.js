import test from 'node:test';
import assert from 'node:assert/strict';
import { logoutAccount } from '../src/services/logout.js';
import { writePatientSession, writeStaffSession, readPatientSession, readStaffSession } from '../src/services/authStorage.js';

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}
for (const kind of ['patient', 'staff']) {
  for (const outcome of ['success', 'network failure', 'server failure']) {
    test(`${kind} logout calls revocation before clearing credentials and clears on ${outcome}`, async () => {
      globalThis.localStorage = storage(); globalThis.sessionStorage = storage();
      writePatientSession({ role: 'PATIENT' }, 'test-patient');
      writeStaffSession({ role: 'ADMIN' }, 'test-staff');
      const read = kind === 'staff' ? readStaffSession : readPatientSession;
      let called = false;
      globalThis.fetch = async (url, options) => {
        called = true;
        assert.ok(read());
        assert.equal(url, '/api/auth/logout');
        assert.equal(options.method, 'POST');
        assert.equal(options.headers.Authorization, `Bearer test-${kind}`);
        if (outcome === 'network failure') throw new Error('Offline');
        return { status: outcome === 'server failure' ? 500 : 204 };
      };
      await logoutAccount(kind);
      assert.ok(called);
      assert.equal(read(), null);
      assert.ok(kind === 'staff' ? readPatientSession() : readStaffSession());
    });
  }
}
