import test from 'node:test';
import assert from 'node:assert/strict';
import { clinicDateString, loadClinicTimeZone } from '../src/utils/clinicTime.js';

test('backend public timezone overrides the development fallback', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, async json() { return { clinicTimeZone: 'Pacific/Auckland' }; } });
  try {
    await loadClinicTimeZone();
    assert.equal(clinicDateString(new Date('2026-01-01T11:00:00.000Z')), '2026-01-02');
  } finally { globalThis.fetch = originalFetch; }
});

test('timezone loader retains resolved timezone when backend is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  try {
    await loadClinicTimeZone();
    assert.equal(clinicDateString(new Date('2026-01-01T11:00:00.000Z')), '2026-01-02');
  } finally { globalThis.fetch = originalFetch; }
});
