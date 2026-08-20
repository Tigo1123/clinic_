import test from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

globalThis.sessionStorage = new MemoryStorage();
globalThis.localStorage = new MemoryStorage();

const authStorage = await import('../src/services/authStorage.js');

test.beforeEach(() => {
  globalThis.sessionStorage = new MemoryStorage();
  globalThis.localStorage = new MemoryStorage();
});

test('staff and patient sessions use separate storage and keys', () => {
  authStorage.writeStaffSession({ id: 'staff-1', role: 'DOCTOR' }, 'staff-token');
  authStorage.writePatientSession({ id: 'patient-1', role: 'PATIENT' }, 'patient-token');

  assert.deepEqual(authStorage.readStaffSession(), {
    user: { id: 'staff-1', role: 'DOCTOR' },
    token: 'staff-token'
  });
  assert.deepEqual(authStorage.readPatientSession(), {
    user: { id: 'patient-1', role: 'PATIENT' },
    token: 'patient-token'
  });
});

test('clearing one session does not clear the other', () => {
  authStorage.writeStaffSession({ role: 'RECEPTIONIST' }, 'staff-token');
  authStorage.writePatientSession({ role: 'PATIENT' }, 'patient-token');

  authStorage.clearStaffSession();
  assert.equal(authStorage.readStaffSession(), null);
  assert.equal(authStorage.readPatientSession()?.token, 'patient-token');

  authStorage.writeStaffSession({ role: 'LAB_TECH' }, 'new-staff-token');
  authStorage.clearPatientSession();
  assert.equal(authStorage.readPatientSession(), null);
  assert.equal(authStorage.readStaffSession()?.token, 'new-staff-token');
});

test('incomplete or wrong-role sessions are cleared safely', () => {
  sessionStorage.setItem(authStorage.STAFF_USER_KEY, JSON.stringify({ role: 'DOCTOR' }));
  assert.equal(authStorage.readStaffSession(), null);
  assert.equal(sessionStorage.getItem(authStorage.STAFF_USER_KEY), null);

  localStorage.setItem(authStorage.PATIENT_USER_KEY, JSON.stringify({ role: 'ADMIN' }));
  localStorage.setItem(authStorage.PATIENT_TOKEN_KEY, 'wrong-token');
  assert.equal(authStorage.readPatientSession(), null);
  assert.equal(localStorage.getItem(authStorage.PATIENT_TOKEN_KEY), null);
});
