import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { withLoginSubmissionLock } from '../src/features/patient-auth/loginSubmission.js';

const patientPage = await readFile(new URL('../src/features/patient-auth/PatientAuthPages.jsx', import.meta.url), 'utf8');
const staffPage = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const authStyles = await readFile(new URL('../src/features/patient-auth/patientAuth.css', import.meta.url), 'utf8');
const translations = await readFile(new URL('../src/i18n.js', import.meta.url), 'utf8');
const passwordField = await readFile(new URL('../src/components/PasswordField.jsx', import.meta.url), 'utf8');

test('login submission lock keeps a delayed request single-flight and releases after server errors', async () => {
  const lock = { current: false };
  const busyTransitions = [];
  let calls = 0;
  let finishRequest;
  const delayedRequest = new Promise((resolve, reject) => { finishRequest = { resolve, reject }; });
  const first = withLoginSubmissionLock(lock, value => busyTransitions.push(value), async () => {
    calls++;
    await delayedRequest;
  });

  assert.equal(lock.current, true);
  assert.deepEqual(busyTransitions, [true]);
  assert.equal(await withLoginSubmissionLock(lock, value => busyTransitions.push(value), async () => { calls++; }), false);
  assert.equal(calls, 1, 'a second submit while the request is pending must not invoke transport');

  finishRequest.reject(Object.assign(new Error('Synthetic authorization failure'), { status: 503 }));
  await assert.rejects(first, /Synthetic authorization failure/);
  assert.equal(lock.current, false);
  assert.deepEqual(busyTransitions, [true, false]);

  const recovered = await withLoginSubmissionLock(lock, value => busyTransitions.push(value), async () => { calls++; });
  assert.equal(recovered, true, 'a failed request must release the lock for a retry');
  assert.equal(calls, 2);
  assert.deepEqual(busyTransitions, [true, false, true, false]);
});

test('patient and staff login retain their authentication endpoints, routing and busy-state semantics', () => {
  const patientStart = patientPage.indexOf('export function PatientLogin');
  const patientEnd = patientPage.indexOf('export function PatientForgotPassword');
  const patientLogin = patientPage.slice(patientStart, patientEnd);
  const staffStart = staffPage.indexOf('function LoginView');
  const staffEnd = staffPage.indexOf('/* ==========================================\n   ROLE DASHBOARDS CONTAINER', staffStart);
  const staffLogin = staffPage.slice(staffStart, staffEnd);

  assert.match(patientLogin, /withLoginSubmissionLock\(submitInFlight,setLoading/);
  assert.match(patientLogin, /apiRequest\('\/api\/auth\/login'/);
  assert.match(patientLogin, /data\.user\.role/);
  assert.match(patientLogin, /navigate\('\/patient'/);
  assert.match(patientLogin, /aria-busy=\{loading\}/);
  assert.match(patientLogin, /disabled=\{loading\}/);
  assert.match(patientLogin, /to="\/forgot-password"/);
  assert.match(patientLogin, /to="\/register"/);

  assert.match(staffLogin, /withLoginSubmissionLock\(submitInFlight, setSubmitting/);
  assert.match(staffLogin, /startStaffLogin\(\{ username, password \}, finalizeLogin\)/);
  assert.match(staffLogin, /result\.state === 'MFA_REQUIRED'/);
  assert.match(staffLogin, /completeStaffMfa\(/);
  assert.match(staffLogin, /completeStaffMfaRecovery\(/);
  assert.match(staffLogin, /aria-busy=\{submitting\}/);
  assert.match(staffLogin, /disabled=\{submitting\}/);
  assert.doesNotMatch(staffLogin, /placeholder="••/);
});

test('both login screens keep the medical mark with the form introduction and use theme-token styling', () => {
  const patientStart = patientPage.indexOf('export function PatientLogin');
  const patientEnd = patientPage.indexOf('export function PatientForgotPassword');
  const patientLogin = patientPage.slice(patientStart, patientEnd);
  const patientShellStart = patientPage.indexOf('function AuthShell(');
  const patientShellEnd = patientPage.indexOf('\nfunction Field(', patientShellStart);
  const patientShell = patientPage.slice(patientShellStart, patientShellEnd);
  const staffStart = staffPage.indexOf('if (view === \'login\')');
  const staffEnd = staffPage.indexOf('return (\n    <div className="app-layout">', staffStart);
  const staffShell = staffPage.slice(staffStart, staffEnd);
  const staffFormStart = staffPage.indexOf('function LoginView');
  const staffFormEnd = staffPage.indexOf('/* ==========================================\n   ROLE DASHBOARDS CONTAINER', staffFormStart);
  const staffLogin = staffPage.slice(staffFormStart, staffFormEnd);

  assert.match(patientShell, /patient-auth-login-intro/);
  assert.match(patientShell, /patient-auth-login-intro__icon/);
  assert.match(patientShell, /facilityName && <p className="patient-auth-product-line">/);
  assert.doesNotMatch(patientShell, /patient-auth-login-icon|Stethoscope/);
  assert.doesNotMatch(patientLogin, /patient-auth-illustration|doctor3dScene/);
  assert.match(staffShell, /patient-auth-stage--login/);
  assert.match(staffLogin, /patient-auth-login-intro/);
  assert.match(staffLogin, /patient-auth-login-intro__icon/);
  assert.match(staffLogin, /showProductIdentity && <p className="patient-auth-product-line">/);
  assert.match(staffShell, /patientPortalShort/);
  assert.match(translations, /patientPortalShort: 'بوابة المرضى'/);
  assert.match(translations, /patientPortalShort: 'Patient portal'/);
  assert.match(patientShell, /\(!facilityName \|\| !isLogin\).*brand-product-descriptor/);
  assert.doesNotMatch(staffShell, /patient-auth-login-icon|Stethoscope/);
  assert.doesNotMatch(staffShell, /patient-auth-illustration|staff3dScene/);
  assert.match(patientLogin, /<Field label=\{t\('password'\)\} type="password"/);
  assert.match(staffLogin, /<PasswordField id="staff-password"/);
  assert.match(passwordField, /aria-pressed=\{visible\}/);
  assert.match(passwordField, /aria-label=\{visible \? t\('hidePassword'\) : t\('showPassword'\)\}/);
  assert.match(authStyles, /--auth-ink: var\(--text-primary\)/);
  assert.match(authStyles, /--auth-surface: var\(--bg-card\)/);
  assert.match(authStyles, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(authStyles, /background: transparent/);
  assert.match(authStyles, /@media \(max-width: 380px\)/);
  assert.match(authStyles, /@media \(max-height: 660px\) and \(max-width: 880px\)/);
  assert.match(authStyles, /patient-auth-shell--login \.patient-auth-topbar[\s\S]*?height: auto/);
  assert.match(authStyles, /patient-auth-shell--staff \.patient-auth-topbar[\s\S]*?height: auto/);
  const secondPassStart = authStyles.indexOf('/* Second-pass login composition');
  const secondPassEnd = authStyles.indexOf('@media (max-width: 640px)', secondPassStart);
  const secondPassStyles = authStyles.slice(secondPassStart, secondPassEnd === -1 ? undefined : secondPassEnd);
  assert.doesNotMatch(secondPassStyles, /patient-auth-shell--register|patient-auth-shell--flow/);
});
