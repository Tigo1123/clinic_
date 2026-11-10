import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolvePublicConfigUrl, loadClinicTimeZone, getPublicConfig } from '../src/utils/clinicTime.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('public config supports same-origin and externally hosted API services', () => {
  assert.equal(resolvePublicConfigUrl(), '/api/public-config');
  assert.equal(resolvePublicConfigUrl('https://clinic-api.example.org/'), 'https://clinic-api.example.org/api/public-config');
  assert.equal(resolvePublicConfigUrl(' https://clinic-api.example.org/// '), 'https://clinic-api.example.org/api/public-config');
});

test('public config fetch has a bounded request and reads valid configuration', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, '/api/public-config');
      assert.equal(options.headers.Accept, 'application/json');
      assert.ok(options.signal instanceof AbortSignal);
      return { ok: true, json: async () => ({ clinicTimeZone: 'Africa/Kigali', facilityNameEn: 'Test Clinic' }) };
    };
    assert.equal(await loadClinicTimeZone(), 'Africa/Kigali');
    assert.equal(getPublicConfig().facilityNameEn, 'Test Clinic');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('unavailable public config falls back instead of failing bootstrap', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new TypeError('offline'); };
    assert.equal(await loadClinicTimeZone(), 'Africa/Kigali');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('theme bootstrap remains before React, with no CSP-blocked inline script', () => {
  const html = read('../index.html');
  const theme = read('../public/theme-init.js');
  assert.match(html, /<script src="\/theme-init\.js"><\/script>/);
  assert.ok(html.indexOf('/theme-init.js') < html.indexOf('/src/main.jsx'));
  assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>[\s\S]*?<\/script>/);
  assert.match(theme, /alshifa_theme/);
  assert.match(theme, /colorScheme/);
});

test('patient data hooks live in a dedicated module without changing public page exports', () => {
  const pages = read('../src/features/patient-dashboard/PatientPages.jsx');
  const hooks = read('../src/features/patient-dashboard/hooks/usePatientRequests.js');
  assert.match(pages, /import \{ useApi, usePagedList \} from '\.\/hooks\/usePatientRequests\.js'/);
  assert.match(hooks, /export function useApi\(/);
  assert.match(hooks, /export function usePagedList\(/);
  assert.doesNotMatch(pages, /function usePagedList\(/);
  assert.doesNotMatch(pages, /function useApi\(/);
  assert.match(pages, /export function Dashboard\(/);
});
