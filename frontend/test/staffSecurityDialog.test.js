import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, Node: dom.window.Node, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, ShadowRoot: dom.window.ShadowRoot, DocumentFragment: dom.window.DocumentFragment, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true });
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { I18nextProvider } = await import('react-i18next');
const { default: i18n } = await import('../src/i18n.js');
async function compile(path, replace) {
 let source = await readFile(new URL(path, import.meta.url), 'utf8'); source = replace(source);
 const file = new URL(`.security-dialog-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url);
 await writeFile(file, (await transformWithOxc(source, path, { jsx: { runtime: 'automatic' } })).code);
 try { return await import(file.href); } finally { await unlink(file); }
}
const password = await compile('../src/components/PasswordField.jsx', source => source
 .replace(/import \{ useTheme \}[^;]+;/, "const useTheme = () => ({ theme: 'light' });")
 .replace("'../utils/patientMuiTheme.js'", JSON.stringify(new URL('../src/utils/patientMuiTheme.js', import.meta.url).href)));
globalThis.securityPasswordField = password.default;
const dialog = await compile('../src/components/StaffSecurityDialog.jsx', source => source
 .replace(/import \{ getPublicConfig \}[^;]+;/, 'const getPublicConfig = () => ({ staffMfaRequired: globalThis.securityRequired });')
 .replace(/import \{ clearStaffSession \}[^;]+;/, 'const clearStaffSession = () => {};')
 .replace(/import \{ disconnectStaffSocket, connectStaffSocket \}[^;]+;/, 'const disconnectStaffSocket = () => {}; const connectStaffSocket = () => {};')
 .replace(/import \{\n  confirmMfaEnrollment,[\s\S]*?\} from '\.\.\/services\/staffMfa';/, `const { mfaManagementErrorKey } = await import(${JSON.stringify(new URL('../src/services/staffMfa.js', import.meta.url).href)}); const disableMfa = (...args) => globalThis.securityDisable(...args); const regenerateMfaRecoveryCodes = () => {}; const confirmMfaEnrollment = () => {}; const startMfaEnrollment = () => {};`)
 .replace(/import MfaCodeInput[^;]+;/, `import MfaCodeInput from ${JSON.stringify(new URL('../src/components/MfaCodeInput.js', import.meta.url).href)};`)
 .replace(/import \{ fetchWithAuth, apiErrorMessage \}[^;]+;/, 'const fetchWithAuth = () => {}; const apiErrorMessage = () => "";')
 .replace(/import PasswordField[^;]+;/, 'const PasswordField = globalThis.securityPasswordField;'));
let root;
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; delete globalThis.securityRequired; delete globalThis.securityDisable; });
async function mount(language = 'en', required = false) {
 await i18n.changeLanguage(language); globalThis.securityRequired = required;
 root = createRoot(document.getElementById('root'));
 await act(async () => root.render(createElement(I18nextProvider, { i18n }, createElement(dialog.default, { user: { mfaEnabled: true }, onClose() {}, t: key => i18n.t(key) }))));
}
async function open() { await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === i18n.t('disableMfa')).click()); }
async function passwordValue(value) { const input = document.querySelector('#mfa-current-password'); await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new window.Event('input', { bubbles: true })); }); }
for (const lang of ['ar', 'en']) test(`${lang}: disable dialog has one current-password label, masks by default and matches its eye state`, async () => {
 await mount(lang); await open();
 const input = document.querySelector('#mfa-current-password'); assert.equal(input.type, 'password'); assert.equal(input.labels.length, 1); assert.equal(input.labels[0].textContent, i18n.t('currentPassword'));
 await passwordValue('SyntheticExample123!'); assert.equal(input.type, 'password');
 const toggle = input.closest('.shifa-password-field').querySelector('button');
 await act(async () => toggle.click()); assert.equal(input.type, 'text'); assert.equal(toggle.getAttribute('aria-pressed'), 'true');
 await act(async () => toggle.click()); assert.equal(input.type, 'password'); assert.equal(toggle.getAttribute('aria-pressed'), 'false');
});
test('dialog submits leading-zero proof intact and displays a server failure without calling it a credential failure', async () => {
 const calls = []; globalThis.securityDisable = async (...args) => { calls.push(args); throw { status: 500, code: 'INTERNAL_SERVER_ERROR', message: 'Private server detail' }; };
 await mount(); await open(); await passwordValue('SyntheticExample123!');
 document.querySelector('#mfa-proof').value = '012345';
 await act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
 assert.deepEqual(calls[0], ['SyntheticExample123!', 'totp', '012345']);
 assert.equal(document.querySelector('[role=alert]').textContent, i18n.t('mfaServiceUnavailable'));
 assert.equal(document.body.textContent.includes('Private server detail'), false);
});
test('required MFA policy disables the disable action and explains why', async () => {
 await mount('ar', true);
 assert.equal([...document.querySelectorAll('button')].find(button => button.textContent === i18n.t('disableMfa')).disabled, true);
 assert.ok(document.body.textContent.includes(i18n.t('mfaRequiredPolicy')));
});
