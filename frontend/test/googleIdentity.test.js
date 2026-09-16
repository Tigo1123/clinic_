import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../src/features/patient-auth/GoogleIdentityButton.jsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/features/patient-auth/PatientAuthPages.jsx', import.meta.url), 'utf8');
const env = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
const storage = readFileSync(new URL('../src/features/patient-auth/googleOnboardingStorage.js', import.meta.url), 'utf8');
const flow = readFileSync(new URL('../src/features/patient-auth/useGooglePatientAuth.js', import.meta.url), 'utf8');

test('GIS foundation uses one direct, reusable script loader and official button', () => {
  assert.match(component, /accounts\.google\.com\/gsi\/client/);
  assert.match(component, /VITE_GOOGLE_CLIENT_ID/);
  assert.match(component, /renderButton/);
  assert.match(component, /initialize/);
  assert.match(component, /google-identity-services-script/);
  assert.doesNotMatch(component, /sessionStorage|localStorage|console\.log|fetch\(/);
});

test('patient login and initial registration expose inert Google callbacks without changing auth endpoints', () => {
  assert.match(page, /GoogleIdentityButton onCredential=\{googleAuth\.handleCredential\}/);
  assert.match(page, /api\/auth\/login/);
  assert.match(page, /api\/patient-auth\/register/);
  assert.doesNotMatch(page, /api\/patient-auth\/google\/complete/);
  assert.match(page, /step === 0/);
});

test('Google verify flow validates states and stores only the opaque onboarding capability', () => {
  assert.match(flow, /api\/patient-auth\/google\/verify/);
  assert.match(flow, /JSON\.stringify\(\{ credential \}\)/);
  assert.match(flow, /setGoogleOnboardingToken/);
  assert.match(flow, /clearGoogleOnboardingToken/);
  assert.doesNotMatch(flow, /decode|console\.log|localStorage|cms_patient_token/);
  assert.match(storage, /cms_google_onboarding_token/);
  assert.doesNotMatch(storage, /localStorage/);
  assert.match(flow, /activeRequest/);
});

test('frontend environment documents only the public Google client ID', () => {
  assert.match(env, /VITE_GOOGLE_CLIENT_ID=/);
  assert.doesNotMatch(env, /GOOGLE_CLIENT_SECRET|GOOGLE_API_KEY/);
});
