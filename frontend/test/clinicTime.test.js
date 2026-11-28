import test from 'node:test';
import assert from 'node:assert/strict';
import { clinicDateString, loadClinicTimeZone, publicConfigUrl } from '../src/utils/clinicTime.js';

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

test('public configuration uses the API base URL for separate Render origins', () => {
  assert.equal(publicConfigUrl(), '/api/public-config');
  assert.equal(
    publicConfigUrl('https://clinic-production-api.onrender.com/'),
    'https://clinic-production-api.onrender.com/api/public-config'
  );
  assert.equal(
    publicConfigUrl(' https://clinic-production-api.onrender.com/// '),
    'https://clinic-production-api.onrender.com/api/public-config'
  );
});

test('public configuration request is bounded, and non-OK responses preserve fallback', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl;
  let requestSignal;
  try {
    globalThis.fetch = async (url, options) => {
      requestedUrl = url;
      requestSignal = options.signal;
      return { ok: false, status: 503, json: async () => { throw Error('Should not parse a failed response'); } };
    };
    const previousDate = clinicDateString(new Date('2026-01-01T11:00:00Z'));
    await loadClinicTimeZone();
    assert.equal(requestedUrl, '/api/public-config');
    assert.ok(requestSignal instanceof AbortSignal);
    assert.equal(clinicDateString(new Date('2026-01-01T11:00:00Z')), previousDate);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
