import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  Node: dom.window.Node, ShadowRoot: dom.window.ShadowRoot, HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element, DocumentFragment: dom.window.DocumentFragment,
  getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true,
});
const { default: i18n } = await import('../src/i18n.js');
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { I18nextProvider } = await import('react-i18next');
let source = await readFile(new URL('../src/components/PasswordField.jsx', import.meta.url), 'utf8');
source = source
  .replace(/import \{ useTheme \} from '[^']+';/, "const useTheme = () => ({ theme: localStorage.getItem('alshifa_theme') || 'light' });")
  .replace(/import \{ createPatientMuiTheme, patientStyleCaches \} from '[^']+';/, `const { createPatientMuiTheme, patientStyleCaches } = await import(${JSON.stringify(new URL('../src/utils/patientMuiTheme.js', import.meta.url).href)});`);
const moduleFile = new URL(`.password-field-${process.pid}.mjs`, import.meta.url);
await writeFile(moduleFile, (await transformWithOxc(source, 'PasswordField.jsx', { jsx: { runtime: 'automatic' } })).code);
let PasswordField;
try { PasswordField = (await import(moduleFile.href)).default; } finally { await unlink(moduleFile); }
let root;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  document.getElementById('root').replaceChildren();
});

async function mount({ language = 'en', mode = 'light', fields = ['Password'] } = {}) {
  await i18n.changeLanguage(language);
  localStorage.setItem('alshifa_theme', mode);
  root = createRoot(document.getElementById('root'));
  const form = createElement('form', null, fields.map(label => createElement(PasswordField, {
    key: label, label, value: globalThis.passwordValues?.[label] || '',
    onChange: event => { globalThis.passwordValues ||= {}; globalThis.passwordValues[label] = event.target.value; },
  })));
  await act(async () => root.render(createElement(I18nextProvider, { i18n }, form)));
}

test('password defaults masked, reveals and remasks without changing its value; toggles are independent', async () => {
  globalThis.passwordValues = { Current: 'Current123', New: 'NewPassword123' };
  await mount({ fields: ['Current', 'New'] });
  const inputs = [...document.querySelectorAll('input')];
  const toggles = [...document.querySelectorAll('button[aria-label]')];
  assert.equal(inputs.length, 2);
  assert.deepEqual(inputs.map(input => input.type), ['password', 'password']);
  assert.deepEqual(toggles.map(button => button.getAttribute('aria-label')), ['Show password', 'Show password']);
  toggles[0].focus();
  assert.equal(document.activeElement, toggles[0]);
  assert.equal(toggles[0].tabIndex, 0);
  await act(async () => toggles[0].click());
  assert.equal(inputs[0].type, 'text');
  assert.equal(inputs[0].value, 'Current123');
  assert.equal(inputs[1].type, 'password');
  assert.equal(toggles[0].getAttribute('aria-label'), 'Hide password');
  await act(async () => toggles[0].click());
  assert.equal(inputs[0].type, 'password');
  assert.equal(inputs[0].value, 'Current123');
  assert.equal(document.querySelectorAll('input[type="password"]').length, 2);
});

for (const [language, label] of [['ar', 'إظهار كلمة المرور'], ['en', 'Show password']]) {
  test(`${language} visibility label is localized`, async () => {
    await mount({ language });
    assert.equal(document.querySelector('button[aria-label]')?.getAttribute('aria-label'), label);
  });
}

for (const [language, mode] of [['ar', 'light'], ['ar', 'dark'], ['en', 'light'], ['en', 'dark']]) {
  test(`${language}/${mode} password field renders with localized direction and theme`, async () => {
    await mount({ language, mode });
    const input = document.querySelector('input');
    assert.ok(input);
    assert.equal(document.querySelector('.MuiFormControl-root') != null, true);
    assert.equal(document.querySelector('.MuiInputBase-root') != null, true);
  });
}

test('password entry routes use the shared field and no app route renders a raw password input', async () => {
  const files = [
    ['../src/App.jsx', ['RequiredPasswordChange', 'staff-password']],
    ['../src/components/StaffSecurityDialog.jsx', ['mfa-current-password', 'mfa-enroll-password']],
    ['../src/features/admin/AdminDashboard.jsx', ['staff-reset-new-password', 'staff-reset-admin-password']],
    ['../src/features/admin/ClinicSetupPanel.jsx', ["type: 'password'"]],
    ['../src/features/patient-auth/PatientAuthPages.jsx', ['PatientLogin', 'PatientForgotPassword', 'PatientRegister', 'offlineActivation', 'PasswordField']],
    ['../src/features/patient-dashboard/PatientPages.jsx', ['changePassword', 'enterPasswordToLink', 'enterPasswordToUnlink', 'currentPassword']],
  ];
  for (const [file, markers] of files) {
    const text = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(text, /PasswordField/);
    for (const marker of markers) assert.ok(text.includes(marker), `${file} missing ${marker}`);
    assert.doesNotMatch(text, /<input\b[^>]*\btype\s*=\s*["']password["']/i);
  }
});
