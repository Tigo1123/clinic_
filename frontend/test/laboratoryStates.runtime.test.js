import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';
import { pagingReplacements } from './helpers/staffPagingHarness.js';

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
let source = await readFile(new URL('../src/features/laboratory/LaboratoryDashboard.jsx', import.meta.url), 'utf8');
source = await pagingReplacements(source, 'labStateFetch', 'labStatePaging');
source = source.replace(/import \{ useWorkflowRefresh \}[^;]+;/, 'const useWorkflowRefresh = (_topics, callback) => { globalThis.labRefresh = callback; };')
  .replace(/import \{ apiErrorMessage, fetchWithAuth \}[^;]+;/, 'const fetchWithAuth = (...args) => globalThis.labStateFetch(...args); const apiErrorMessage = (_body, fallback) => fallback;')
  .replace(/import RoleHero[^;]+;/, 'const RoleHero = () => null;')
  .replace("'../../utils/labOrderVersions'", JSON.stringify(new URL('../src/utils/labOrderVersions.js', import.meta.url).href))
  .replace(/import '\.\/laboratoryDashboard.css';/, '');
const file = new URL(`.laboratory-states-${process.pid}.mjs`, import.meta.url);
await writeFile(file, (await transformWithOxc(source, 'LaboratoryDashboard.jsx', { jsx: { runtime: 'automatic' } })).code);
let Laboratory;
try { Laboratory = (await import(file.href)).default; } finally { await unlink(file); }
const patient = { fullNameAr: 'مريض الاختبار', fullNameEn: 'Test patient', fileNumber: 'MRN-1' };
const service = { id: 'service', category: 'LABORATORY', labelAr: 'صورة دم', labelEn: 'Blood count', baseFeeSdg: 10 };
const order = (status = 'SAMPLE_COLLECTED') => ({ id: 'order', patient, doctor: patient, orderDate: '2026-10-20', status, items: [{ id: 'item', resultVersion: 0, service, resultValue: null }] });
const response = (body, ok = true) => ({ ok, status: ok ? 200 : 503, headers: { get: () => 'false' }, json: async () => body });
let root;
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; delete globalThis.labStateFetch; });
async function mount(request, lang = 'en') {
  globalThis.labStateFetch = request;
  root = createRoot(document.querySelector('#root'));
  await act(async () => root.render(createElement(Laboratory, { lang })));
}
const button = text => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === text);
async function click(node) { await act(async () => node.click()); }
async function input(node, value) {
  await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(node, value); node.dispatchEvent(new window.Event('input', { bubbles: true })); });
}
const normal = path => response(path.includes('/pending?') ? [order()] : path.includes('/services') ? [service] : []);

for (const lang of ['ar', 'en']) test(`${lang}: failed Lab reads have retry alerts without false empty states`, async () => {
  let failed = true;
  await mount(async path => failed ? response({ error: { message: 'PRIVATE ENGLISH' } }, false) : normal(path), lang);
  assert.ok(document.querySelectorAll('[role="alert"]').length >= 2);
  assert.doesNotMatch(document.body.textContent, /PRIVATE ENGLISH|No custom tests are awaiting|لا توجد فحوصات مخصصة بانتظار/);
  await click(document.querySelector('#laboratory-tab-history'));
  assert.doesNotMatch(document.body.textContent, /There are no completed|لا توجد طلبات مختبرية مكتملة/);
  assert.match(document.querySelector('#laboratory-order-panel [role="alert"]').textContent, lang === 'ar' ? /تعذر/ : /Unable/);
  failed = false;
  await act(async () => globalThis.labRefresh());
  assert.equal(document.querySelectorAll('[role="alert"]').length, 0);
  assert.match(document.body.textContent, lang === 'ar' ? /لا توجد طلبات مختبرية مكتملة/ : /There are no completed/);
});

test('Lab rejects reversed reference bounds, keeps the draft, and sends only one pending save', async () => {
  let finish; const writes = [];
  await mount(async (path, options) => {
    if (options?.method === 'PUT') { writes.push(JSON.parse(options.body)); return new Promise(resolve => { finish = resolve; }); }
    return normal(path);
  });
  await click(document.querySelector('.laboratory-order-card'));
  await input(document.querySelector('input[type="text"]'), '13.5');
  await input(document.querySelector('[aria-label="Reference range minimum"]'), '20');
  await input(document.querySelector('[aria-label="Reference range maximum"]'), '10');
  await click(button('Save Test Result'));
  assert.equal(writes.length, 0); assert.match(document.querySelector('[role="alert"]').textContent, /minimum must not exceed/);
  assert.equal(document.querySelector('input[type="text"]').value, '13.5');
  await input(document.querySelector('[aria-label="Reference range minimum"]'), '10');
  await input(document.querySelector('[aria-label="Reference range maximum"]'), '20');
  const save = button('Save Test Result');
  await act(async () => { save.click(); save.click(); });
  assert.equal(writes.length, 1); assert.equal(save.disabled, true);
  assert.equal(writes[0].expectedVersion, 0); assert.equal(writes[0].isOutOfRange, false);
  await act(async () => finish({ ...response({ error: { code: 'LAB_RESULT_CONFLICT' } }, false), status: 409 }));
  assert.match(document.querySelector('[role="alert"]').textContent, /Another user changed/);
  assert.equal(document.querySelector('input[type="text"]').value, '13.5');
  assert.equal(button('Save Test Result').disabled, false);
});

test('a finalized-result conflict shows the retained draft alongside the read-only recorded result', async () => {
  let finalized = false;
  await mount(async (path, options) => {
    if (options?.method === 'PUT') {
      finalized = true;
      return { ...response({ error: { code: 'LAB_RESULT_FINALIZED' } }, false), status: 409 };
    }
    if (path.includes('/pending?') && finalized) {
      const completed = order('COMPLETED'); completed.items[0].resultValue = '14'; completed.items[0].resultVersion = 1;
      return response([completed]);
    }
    return normal(path);
  });
  await click(document.querySelector('.laboratory-order-card'));
  await input(document.querySelector('input[type="text"]'), '13.5');
  await click(button('Save Test Result'));
  assert.match(document.querySelector('[role="alert"]').textContent, /no longer editable/);
  assert.match(document.querySelector('[role="note"]').textContent, /Unsaved entry for review: 13\.5/);
  assert.match(document.querySelector('.laboratory-results-panel').textContent, /Recorded result: 14/);
  assert.equal(document.querySelector('.laboratory-results-panel input'), null);
});

test('Lab history retains its last good snapshot and ignores older refresh responses', async () => {
  const released = { ...order('COMPLETED'), releasedToPatientAt: '2026-10-20T12:00:00Z' };
  const pending = []; let hold = false;
  await mount(async path => {
    if (path.endsWith('/history')) return hold ? new Promise(resolve => pending.push(resolve)) : response([released]);
    return normal(path);
  });
  await click(document.querySelector('#laboratory-tab-history'));
  assert.equal(document.querySelectorAll('.laboratory-order-card').length, 1);
  hold = true;
  let old, latest;
  await act(async () => { old = globalThis.labRefresh(); latest = globalThis.labRefresh(); });
  await act(async () => { pending[1](response([released])); await latest; });
  await act(async () => { pending[0](response([])); await old; });
  assert.equal(document.querySelectorAll('.laboratory-order-card').length, 1);
  let failed;
  await act(async () => { failed = globalThis.labRefresh(); });
  await act(async () => { pending[2](response({}, false)); await failed; });
  assert.equal(document.querySelectorAll('.laboratory-order-card').length, 1);
  assert.ok(document.querySelector('#laboratory-order-panel [role="alert"]'));
});

test('Lab tabs support arrow navigation and a single tab stop', async () => {
  await mount(async path => normal(path));
  const work = document.querySelector('#laboratory-tab-work'), history = document.querySelector('#laboratory-tab-history');
  work.focus();
  await act(async () => work.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  assert.equal(document.activeElement, history); assert.equal(history.tabIndex, 0); assert.equal(work.tabIndex, -1);
  assert.equal(document.querySelector('[role="tabpanel"]').getAttribute('aria-labelledby'), history.id);
});
