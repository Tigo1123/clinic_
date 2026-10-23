import test from 'node:test';
import assert from 'node:assert/strict';
import { readPatientSession, writePatientSession, PATIENT_USER_KEY, PATIENT_TOKEN_KEY } from '../src/services/authStorage.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

test('session storage persists only minimum user display state and keeps tokens tab-scoped', () => {
  const original = globalThis.sessionStorage;
  const storage = memoryStorage();
  globalThis.sessionStorage = storage;
  try {
    writePatientSession({
      id: 'patient-1', role: 'PATIENT', preferredLanguage: 'ar', patientId: 'file-1',
      email: 'patient@example.invalid', phone: '+249000000000', dateOfBirth: '1980-01-01',
      medicalRecord: 'must-not-persist', localStorageSecret: 'must-not-persist'
    }, 'opaque-test-token');
    const saved = JSON.parse(storage.getItem(PATIENT_USER_KEY));
    assert.deepEqual(saved, { id: 'patient-1', role: 'PATIENT', preferredLanguage: 'ar', patientId: 'file-1' });
    assert.equal(storage.getItem(PATIENT_TOKEN_KEY), 'opaque-test-token');
    assert.equal(readPatientSession().user.id, 'patient-1');
  } finally {
    if (original === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = original;
  }
});
