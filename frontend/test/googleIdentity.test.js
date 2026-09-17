import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../src/features/patient-auth/GoogleIdentityButton.jsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/features/patient-auth/PatientAuthPages.jsx', import.meta.url), 'utf8');
const env = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
const storage = readFileSync(new URL('../src/features/patient-auth/googleOnboardingStorage.js', import.meta.url), 'utf8');
const flow = readFileSync(new URL('../src/features/patient-auth/useGooglePatientAuth.js', import.meta.url), 'utf8');
const onboarding = readFileSync(new URL('../src/features/patient-auth/onboarding.js', import.meta.url), 'utf8');

test('GIS foundation uses one direct, reusable script loader and official button', () => {
  assert.match(component, /accounts\.google\.com\/gsi\/client/);
  assert.match(component, /VITE_GOOGLE_CLIENT_ID/);
  assert.match(component, /renderButton/);
  assert.match(component, /initialize/);
  assert.match(component, /let initializedClientId/);
  assert.match(component, /activeCredentialConsumer/);
  assert.match(component, /initializedClientId !== clientId/);
  assert.match(component, /activeCredentialConsumer\?\.callback/);
  assert.match(component, /google-identity-services-script/);
  assert.doesNotMatch(component, /sessionStorage|localStorage|console\.log|fetch\(/);
});

test('patient login and registration preserve separate Google and normal endpoints', () => {
  assert.match(page, /GoogleIdentityButton onCredential=\{googleAuth\.handleCredential\}/);
  assert.match(page, /api\/auth\/login/);
  assert.match(page, /api\/patient-auth\/register/);
  assert.match(page, /api\/patient-auth\/google\/complete/);
  assert.match(page, /googleRegistrationPayload/);
  assert.match(page, /googleOnboarding/);
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

test('Google completion is allowlisted, session-safe, and does not enter OTP flow', () => {
  assert.match(page, /googleRegistrationPayload\(form, token\)/);
  assert.match(page, /status === 'AUTHENTICATED'/);
  assert.match(page, /data\.user\?\.role === 'PATIENT'/);
  assert.match(page, /state === 'MANUAL_REVIEW_REQUIRED'.*state === 'AMBIGUOUS_MATCH'/);
  assert.match(page, /clearGoogleOnboardingToken\(\)/);
  assert.match(onboarding, /googleRegistrationPayload/);
  assert.match(flow, /onAuthenticated/);
});

test('Google mode fails closed without a capability and normal mode remains separate', () => {
  assert.match(page, /if \(!token\).*googleOnboardingExpired/);
  assert.match(page, /api\/patient-auth\/register/);
  assert.match(page, /api\/patient-auth\/google\/complete/);
  assert.match(storage, /sessionStorage/);
});

test('frontend environment documents only the public Google client ID', () => {
  assert.match(env, /VITE_GOOGLE_CLIENT_ID=/);
  assert.doesNotMatch(env, /GOOGLE_CLIENT_SECRET|GOOGLE_API_KEY/);
});
