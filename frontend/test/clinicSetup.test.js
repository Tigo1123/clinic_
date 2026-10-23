import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';
import { clinicCopy, setupPayload } from '../src/features/admin/clinicSetup.js';

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, Node: dom.window.Node, ShadowRoot: dom.window.ShadowRoot, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, DocumentFragment: dom.window.DocumentFragment, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true });
const { createPatientMuiTheme } = await import('../src/utils/patientMuiTheme.js');
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
let source = await readFile(new URL('../src/features/admin/ClinicSetupPanel.jsx', import.meta.url), 'utf8');
source = source
  .replace(/import \{ useTheme \}[^;]+;/, "const useTheme = () => ({ theme: globalThis.setupTestMode || 'light' });")
  .replace(/import \{ fetchWithAuth \}[^;]+;/, 'const fetchWithAuth = (...args) => globalThis.setupTestRequest(...args);')
  .replace(/import PasswordField[^;]+;/, 'const PasswordField = ({label,value,onChange,name,autoComplete}) => <label>{label}<input name={name} aria-label={label} value={value} onChange={onChange} type="password" autoComplete={autoComplete}/></label>;')
  .replace(/import AdminSchedulePanel[^;]+;/, 'const AdminSchedulePanel = ({initialDoctorId}) => <div data-schedule-doctor={initialDoctorId}/>;')
  .replace("'../../utils/patientMuiTheme.js'", JSON.stringify(new URL('../src/utils/patientMuiTheme.js', import.meta.url).href))
  .replace("'../../utils/staffPasswordPolicy'", JSON.stringify(new URL('../src/utils/staffPasswordPolicy.js', import.meta.url).href))
  .replace("'./clinicSetup.js'", JSON.stringify(new URL('../src/features/admin/clinicSetup.js', import.meta.url).href));
const file = new URL(`.clinic-setup-${process.pid}.mjs`, import.meta.url);
await writeFile(file, (await transformWithOxc(source, 'ClinicSetupPanel.jsx', { jsx: { runtime: 'automatic' } })).code);
let Panel;
try { Panel = (await import(file.href)).default; } finally { await unlink(file); }
let root;
const reply = (data, ok = true) => ({ ok, headers: { get: (key) => key === 'X-Total-Count' ? String(Array.isArray(data) ? data.length : data.total || 0) : 'false' }, json: async () => data });
async function mount(lang = 'en', initialTab = 'doctors', handler = () => reply([])) {
  globalThis.setupTestRequest = handler;
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(createElement(Panel, { lang, initialTab })));
}
async function clickText(text, scope = document) {
  const button = [...scope.querySelectorAll('button')].find(item => item.textContent.trim() === text);
  assert.ok(button, text); await act(async () => button.click());
}
async function fill(name, value) {
  const input = document.querySelector(`input[name="${name}"]`); assert.ok(input, name);
  await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new window.Event('input', { bubbles: true })); });
}
async function submit() { await act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))); }
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; delete globalThis.setupTestRequest; delete globalThis.setupTestMode; });

test('payloads preserve decimal strings, immutable categories and staff authority boundaries', () => {
  const draft = { labelAr: ' اختبار ', labelEn: ' Test ', code: 'test', priceSdg: '17001', active: false, category: 'CONSULTATION', specialtyId: 'specialty', username: 'doctor@example.test', password: 'Temporary@123' };
  assert.equal(setupPayload('services', draft, false).priceSdg, '17001');
  assert.equal(setupPayload('labs', draft, false).category, 'LABORATORY');
  assert.equal(setupPayload('labs', draft, true).category, undefined);
  assert.equal(setupPayload('doctors', draft, true).password, undefined);
  assert.equal(setupPayload('doctors', draft, false).role, 'DOCTOR');
  assert.deepEqual(Object.keys(setupPayload('payments', draft, true)).sort(), ['active', 'labelAr', 'labelEn']);
});

for (const lang of ['ar', 'en']) for (const mode of ['light', 'dark']) test(`${lang}/${mode}: MUI controls, localized empty state and direction remain coherent`, async () => {
  globalThis.setupTestMode = mode;
  await mount(lang);
  const copy = clinicCopy[lang];
  assert.equal(document.querySelector('.clinic-setup-panel').dir, lang === 'ar' ? 'rtl' : 'ltr');
  assert.ok(document.querySelector('.MuiTabs-root'));
  assert.ok(document.querySelector('.MuiCard-root'));
  assert.match(document.body.textContent, new RegExp(copy.empty));
  assert.equal(document.querySelectorAll('[role=tab]').length, 5);
  const theme = createPatientMuiTheme(mode, lang === 'ar' ? 'rtl' : 'ltr');
  assert.equal(theme.palette.mode, mode); assert.equal(theme.direction, lang === 'ar' ? 'rtl' : 'ltr');
  await clickText(`${copy.add} ${copy.doctors}`);
  assert.equal(document.querySelector('[role=dialog]').closest('[dir]').dir, lang === 'ar' ? 'rtl' : 'ltr');
  assert.ok(document.querySelector('input[autocomplete=new-password]'));
  await submit();
  assert.match(document.body.textContent, new RegExp(copy.invalid));
  await clickText(copy.cancel, document.querySelector('[role=dialog]'));
});

test('load failures show a retry and a successful retry replaces the error', async () => {
  let fail = true;
  await mount('en', 'services', () => fail ? Promise.reject(new Error('Network')) : reply({ items: [], total: 0 }));
  assert.match(document.querySelector('[role=alert]').textContent, /Unable to load/);
  fail = false; await clickText('Retry');
  assert.match(document.body.textContent, /No entries yet/);
});

test('service creation requires confirmation, sends a decimal string, and retains the form on duplicate errors', async () => {
  const writes = [];
  await mount('en', 'services', (url, options) => {
    if (!options) return reply({ items: [], total: 0 });
    writes.push({ url, options }); return reply({ error: { code: 'CATALOG_DUPLICATE' } }, false);
  });
  await clickText('Add Medical services');
  for (const [name, value] of [['labelAr', 'خدمة محلية'], ['labelEn', 'Local service'], ['code', 'local-service'], ['priceSdg', '17001']]) await fill(name, value);
  await submit(); assert.equal(writes.length, 0);
  const dialogs = document.querySelectorAll('[role=dialog]'); assert.equal(dialogs.length, 2);
  await clickText('Save', dialogs[1]);
  assert.equal(writes.length, 1);
  assert.equal(JSON.parse(writes[0].options.body).priceSdg, '17001');
  assert.match(document.body.textContent, /already exists/);
  assert.equal(document.querySelector('input[name=labelEn]').value, 'Local service');
});

test('payment settings never expose account/card fields or a method deletion action', async () => {
  await mount('en', 'payments', () => reply([{ code: 'CARD', labelAr: 'بطاقة', labelEn: 'Card / POS', active: true }]));
  await clickText('Edit');
  assert.equal(document.querySelector('input[name=code]'), null);
  assert.equal(document.querySelector('input[name=priceSdg]'), null);
  assert.equal(document.querySelectorAll('[name=cardNumber],[name=cvv],[name=pin]').length, 0);
  assert.match(document.body.textContent, /Never enter card numbers/);
});

test('successful service creation closes the editor, clears the draft, and reloads the list', async () => {
  let created = null; let reads = 0;
  await mount('en', 'services', (url, options) => {
    if (!options) { reads++; return reply({ items: created ? [created] : [], total: created ? 1 : 0 }); }
    const payload = JSON.parse(options.body);
    created = { id: 'local-service', ...payload }; return reply(created);
  });
  await clickText('Add Medical services');
  for (const [name, value] of [['labelAr', 'خدمة محلية'], ['labelEn', 'Created service'], ['code', 'created-service'], ['priceSdg', '17001']]) await fill(name, value);
  await submit();
  await clickText('Save', document.querySelectorAll('[role=dialog]')[1]);
  assert.ok(reads >= 2);
  assert.match(document.querySelector('.clinic-setup-panel').textContent, /Changes saved/);
  assert.match(document.querySelector('.clinic-setup-panel article').textContent, /Created service/);
});

test('doctor edit uses the profile API, preserves account secrets, and opens that doctor’s schedule', async () => {
  const writes = [];
  const doctor = { id: 'doctor-fixture', fullNameAr: 'طبيب', fullNameEn: 'Doctor fixture', specialtyId: 'specialty-fixture', consultationFee: 17001, status: 'ACTIVE', account: { status: 'ACTIVE' }, hasSchedule: false };
  await mount('en', 'doctors', (url, options) => {
    if (options) { writes.push({ url, payload: JSON.parse(options.body) }); return reply(doctor); }
    return reply(url === '/api/specialties' ? [{ id: 'specialty-fixture', nameAr: 'الباطنية', nameEn: 'Internal Medicine', active: true }] : [doctor]);
  });
  await clickText('Working schedule');
  assert.equal(document.querySelector('[data-schedule-doctor]').getAttribute('data-schedule-doctor'), doctor.id);
  await clickText('Edit'); await fill('labelEn', 'Edited doctor'); await submit();
  await clickText('Save', document.querySelectorAll('[role=dialog]')[1]);
  assert.equal(writes[0].url, '/api/admin/doctors/doctor-fixture');
  assert.equal(writes[0].payload.fullNameEn, 'Edited doctor');
  assert.equal(writes[0].payload.specialtyId, 'specialty-fixture');
  assert.equal(writes[0].payload.password, undefined);
  assert.equal(writes[0].payload.username, undefined);
});

test('doctor configuration reaches doctor 61 through bounded server pages', async () => {
  const doctors = Array.from({ length: 61 }, (_, i) => ({ id: `doctor-${i + 1}`, fullNameEn: `Paging doctor ${i + 1}`, status: 'ACTIVE', account: { status: 'ACTIVE' } }));
  const pages = [];
  await mount('en', 'doctors', (url) => {
    if (url === '/api/specialties') return reply([]);
    const params = new URL(url, 'https://example.invalid').searchParams;
    const page = Number(params.get('page')); pages.push(page);
    assert.equal(params.get('pageSize'), '12');
    const response = reply(doctors.slice((page - 1) * 12, page * 12));
    response.headers.get = () => String(doctors.length);
    return response;
  });
  for (let i = 0; i < 5; i++) await clickText('Next');
  assert.match(document.querySelector('.clinic-setup-panel').textContent, /Paging doctor 61/);
  assert.deepEqual(pages, [1, 2, 3, 4, 5, 6]);
});
