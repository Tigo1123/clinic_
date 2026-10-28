import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true, confirm: () => true });
const { act, createElement, StrictMode } = await import('react');
const { createRoot } = await import('react-dom/client');
window.sessionStorage.setItem('shifa_pricing_diagnostics', '1');
let source = await readFile(new URL('../src/features/admin/AdminDashboard.jsx', import.meta.url), 'utf8');
source = source.replace(/import '\.\/clinicSetup\.css';/, '')
  .replace(/import ([A-Za-z]+) from [^;]+;/g, 'const $1 = () => null;')
  .replace(/import \{[^}]+\} from 'lucide-react';/, 'const Activity=()=>null,Building=Activity,CalendarDays=Activity,DollarSign=Activity,Sliders=Activity,Users=Activity;')
  .replace(/import \{ useWorkflowRefresh \}[^;]+;/, 'const useWorkflowRefresh = (_topics, callback) => { globalThis.pricingDiagnosticRefresh = callback; };')
  .replace(/import \{ apiErrorMessage, fetchWithAuth \}[^;]+;/, 'const fetchWithAuth=(...args)=>globalThis.pricingDiagnosticFetch(...args);const apiErrorMessage=(_data,fallback)=>fallback;')
  .replace("'./pricingDiagnostics.js'", JSON.stringify(new URL('../src/features/admin/pricingDiagnostics.js', import.meta.url).href))
  .replace('createPricingDiagnostics()', 'createPricingDiagnostics({ allowed: true, host: window })');
const file = new URL(`.pricing-diagnostics-${process.pid}.mjs`, import.meta.url);
await writeFile(file, (await transformWithOxc(source, 'AdminDashboard.jsx', { jsx: { runtime: 'automatic' } })).code);
let Admin;
try { Admin = (await import(file.href)).default; } finally { await unlink(file); }
let root;
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; delete globalThis.pricingDiagnosticFetch; window.__SHIFA_PRICING_DIAGNOSTICS__?.clear(); });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const fields = { doctors: 'consultationFee', services: 'baseFeeSdg', medicines: 'unitPriceSdg' };
const rows = () => Object.fromEntries(Object.entries(fields).map(([kind, field]) => [kind, [{ id: 'shared-id', labelEn: kind, fullNameEn: kind, category: kind === 'services' ? 'LABORATORY' : undefined, [field]: 100, status: 'INACTIVE' }]]));
const row = kind => document.querySelector(`input[aria-label="${kind} price"]`)?.closest('tr');
const tab = index => document.querySelectorAll('.menu-btn')[index];
const click = async button => act(async () => button.click());
async function eventsAfterSettling() {
  await act(async () => new Promise(resolve => window.setTimeout(resolve, 0)));
  return window.__SHIFA_PRICING_DIAGNOSTICS__.getEvents();
}
async function edit(kind, value, status = 'ACTIVE') {
  await act(async () => {
    const input = row(kind).querySelector('input');
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    const select = row(kind).querySelector('select'); select.value = status;
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}
async function mount(request) {
  globalThis.pricingDiagnosticFetch = request;
  root = createRoot(document.querySelector('#root'));
  await act(async () => root.render(createElement(StrictMode, null, createElement(Admin, { user: { role: 'ADMIN' }, lang: 'en', t: key => key }))));
  await click(tab(2));
}

for (const kind of Object.keys(fields)) test(`${kind}: slow old GET body completes after Save; newly saved value/status must remain`, async () => {
  const oldBody = deferred(), patch = deferred(); let reads = 0; const writes = [];
  const initial = rows();
  await mount(async (url, options = {}) => {
    if (options.method === 'PATCH') { writes.push(JSON.parse(options.body)); return patch.promise; }
    if (url !== '/api/admin/pricing') return response([]);
    reads++;
    if (reads === 1) return { ...response(null), json: () => oldBody.promise };
    return response(initial);
  });
  await click(tab(0)); await click(tab(2)); // Newer GET exposes editable rows; the old body ignores abort.
  await edit(kind, '875'); await click(row(kind).querySelector('button'));
  assert.deepEqual(writes, [{ priceSdg: 875, status: 'ACTIVE' }]);
  await act(async () => patch.resolve(response({ ...initial[kind][0], [fields[kind]]: 875, status: 'ACTIVE' })));
  await act(async () => oldBody.resolve(initial));
  assert.equal(row(kind).querySelector('input').value, '875');
  assert.equal(row(kind).querySelector('select').value, 'ACTIVE');
  assert.equal(row(kind).querySelector('button').disabled, false);
  const events = await eventsAfterSettling();
  const late = events.find(event => event.type === 'request.end' && event.olderGetCompletedAfterSave);
  assert.equal(late.applied, false); assert.equal(late.overwroteNewerState, false);
  assert.ok(late.wouldOverwriteSavedRows.includes(`${kind}:shared-id`));
  const final = events.filter(event => event.type === 'ui.settled').at(-1);
  assert.equal(final.requestsPending, 0); assert.equal(final.rows[0].rendered.priceSdg, '875');
  assert.equal(final.rows[0].saving, false); assert.equal(final.rows[0].rendered.saveDisabled, false);
  const starts = events.filter(event => event.type === 'request.start');
  assert.equal(new Set(starts.map(event => event.requestId)).size, starts.length);
  assert.ok(events.every(event => !Number.isNaN(Date.parse(event.timestamp))));
});

test('rapid repeated saves, concurrent categories with equal IDs, and navigation preserve both authoritative responses', async () => {
  const initial = rows(), writes = [], reads = [];
  await mount(async (url, options = {}) => {
    if (options.method === 'PATCH') { const pending = deferred(); writes.push({ ...pending, url, payload: JSON.parse(options.body) }); return pending.promise; }
    if (url !== '/api/admin/pricing') return response([]);
    if (!reads.length) { reads.push(null); return response(initial); }
    const pending = deferred(); reads.push(pending); return pending.promise;
  });
  await edit('doctors', '1200'); await edit('medicines', '450');
  const doctorSave = row('doctors').querySelector('button'), medicineSave = row('medicines').querySelector('button');
  await act(async () => { for (let i = 0; i < 12; i++) doctorSave.click(); medicineSave.click(); });
  assert.equal(writes.length, 2); assert.equal(doctorSave.disabled, true); assert.equal(medicineSave.disabled, true);
  await click(tab(0)); await click(tab(2)); // GET starts while both PATCHes are pending.
  await act(async () => writes[1].resolve(response({ ...initial.medicines[0], unitPriceSdg: 450, status: 'ACTIVE' })));
  assert.equal(row('doctors').querySelector('button').disabled, true, 'another category saving must not clear this row lock');
  await act(async () => writes[0].resolve(response({ ...initial.doctors[0], consultationFee: 1200, status: 'ACTIVE' })));
  await act(async () => reads[1].resolve(response(initial)));
  assert.equal(row('doctors').querySelector('input').value, '1200');
  assert.equal(row('medicines').querySelector('input').value, '450');
  await edit('medicines', '650'); await click(row('medicines').querySelector('button'));
  assert.equal(writes[2].payload.priceSdg, 650, 'a later Save must use the latest draft, not the previous one');
  await act(async () => writes[2].resolve(response({ ...initial.medicines[0], unitPriceSdg: 650, status: 'ACTIVE' })));
  assert.equal(row('medicines').querySelector('input').value, '650');
  const events = await eventsAfterSettling();
  assert.ok(events.some(event => event.type === 'save.blocked' && event.reason === 'duplicate'));
  assert.ok(events.some(event => event.type === 'request.start' && event.refreshStartedBeforeSaveCompleted && event.pendingSaveActions.length === 2));
  const final = events.filter(event => event.type === 'ui.settled').at(-1);
  assert.equal(final.rows.find(row => row.kind === 'doctors').rendered.priceSdg, '1200');
  assert.equal(final.rows.find(row => row.kind === 'medicines').rendered.priceSdg, '650');
});

test('refresh during Save is deferred and final revalidation keeps the persisted value', async () => {
  const initial = rows(), patch = deferred(); let reads = 0, saved = false;
  await mount(async (url, options = {}) => {
    if (options.method === 'PATCH') return patch.promise;
    if (url !== '/api/admin/pricing') return response([]);
    reads++; return response(saved ? { ...initial, services: [{ ...initial.services[0], baseFeeSdg: 950, status: 'ACTIVE' }] } : initial);
  });
  await edit('services', '950'); await click(row('services').querySelector('button'));
  await act(async () => { globalThis.pricingDiagnosticRefresh(['catalog']); globalThis.pricingDiagnosticRefresh(['reconnected']); });
  assert.equal(reads, 1);
  saved = true;
  await act(async () => patch.resolve(response({ ...initial.services[0], baseFeeSdg: 950, status: 'ACTIVE' })));
  assert.equal(reads, 2, 'coalesced revalidation must start after Save settles');
  assert.equal(row('services').querySelector('input').value, '950');
  assert.equal(row('services').querySelector('button').disabled, false);
  const events = await eventsAfterSettling();
  assert.ok(events.some(event => event.type === 'refresh.requested' && event.deferred));
  const end = events.find(event => event.type === 'save.end');
  const revalidation = events.filter(event => event.type === 'request.start' && event.method === 'GET').at(-1);
  assert.ok(revalidation.sequence > end.sequence);
  assert.equal(revalidation.refreshStartedBeforeSaveCompleted, false);
});

test('Save remains busy until the response body finishes and logs a failed response without clearing the draft', async () => {
  const body = deferred(), initial = rows(); const writes = [];
  await mount(async (url, options = {}) => {
    if (options.method === 'PATCH') { writes.push(options); return { ...response(null, 500), json: () => body.promise }; }
    return response(url === '/api/admin/pricing' ? initial : []);
  });
  await edit('medicines', '725'); await click(row('medicines').querySelector('button'));
  assert.equal(row('medicines').querySelector('button').disabled, true);
  assert.equal(window.__SHIFA_PRICING_DIAGNOSTICS__.getEvents().some(event => event.type === 'request.end' && event.method === 'PATCH'), false);
  await act(async () => body.resolve({ error: { code: 'MEDICINE_PRICE_UPDATE_FAILED', message: 'PRIVATE TOKEN DETAIL' }, token: 'PRIVATE TOKEN DETAIL' }));
  assert.equal(row('medicines').querySelector('input').value, '725');
  assert.equal(row('medicines').querySelector('button').disabled, false);
  const events = await eventsAfterSettling();
  const end = events.find(event => event.type === 'request.end' && event.method === 'PATCH');
  assert.equal(end.status, 500); assert.equal(end.response.errorCode, 'MEDICINE_PRICE_UPDATE_FAILED');
  assert.equal(end.applied, false); assert.equal(writes.length, 1);
  assert.match(writes[0].headers['X-Request-ID'], /^pricing-patch-/);
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE TOKEN DETAIL/);
});

test('validation and cancelled confirmation log the click without sending a PATCH', async () => {
  let patches = 0;
  await mount(async (url, options = {}) => { if (options.method === 'PATCH') patches++; return response(url === '/api/admin/pricing' ? rows() : []); });
  await edit('services', '0'); await click(row('services').querySelector('button'));
  await edit('services', '900');
  globalThis.confirm = () => false;
  try { await click(row('services').querySelector('button')); } finally { globalThis.confirm = () => true; }
  const events = await eventsAfterSettling();
  assert.equal(patches, 0);
  assert.deepEqual(events.filter(event => event.type === 'save.blocked').map(event => event.reason), ['validation', 'cancelled']);
});
