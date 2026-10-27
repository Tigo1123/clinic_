import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';

test('pricing controls snapshot the selected value before deferred React updates and merge queued row edits', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
  const { act, createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const source = readFileSync(new URL('../src/features/admin/AdminDashboard.jsx', import.meta.url), 'utf8');
  const tableSource = `export default ${source.slice(source.indexOf('function PricingTable('))}`;
  const modulePath = new URL(`.pricing-table-${process.pid}.mjs`, import.meta.url);
  await writeFile(modulePath, (await transformWithOxc(tableSource, 'PricingTable.jsx', { jsx: { runtime: 'automatic' } })).code);
  let PricingTable;
  try { PricingTable = (await import(modulePath.href)).default; } finally { await unlink(modulePath); }
  const root = createRoot(document.querySelector('#root'));
  const queued = [];
  const item = { id: 'medicine', labelEn: 'Amoxicillin', status: 'INACTIVE', unitPriceSdg: null };
  try {
    await act(async () => root.render(createElement(PricingTable, { title: 'Medicine pricing', kind: 'medicines', items: [item], lang: 'en', drafts: {}, setDrafts: update => queued.push(update), onSave() {} })));
    const select = document.querySelector('select');
    select.value = 'ACTIVE';
    await act(async () => select.dispatchEvent(new window.Event('change', { bubbles: true })));
    assert.equal(queued.length, 1);
    // Controlled selects can be restored before React invokes a queued updater.
    select.value = 'INACTIVE';
    const updated = queued.shift()({ 'medicines:medicine': { priceSdg: '1000', status: 'INACTIVE' } });
    assert.equal(updated['medicines:medicine'].status, 'ACTIVE');
    assert.equal(updated['medicines:medicine'].priceSdg, '1000');
    const input = document.querySelector('input');
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, '2000');
    await act(async () => input.dispatchEvent(new window.Event('input', { bubbles: true })));
    assert.equal(queued.length, 1);
    input.value = '';
    const repriced = queued.shift()(updated);
    assert.deepEqual(repriced['medicines:medicine'], { priceSdg: '2000', status: 'ACTIVE' });
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('Admin saves once, waits for persistence, surfaces failures and reloads authoritative values', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true, confirm: () => true });
  const { act, createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  let source = readFileSync(new URL('../src/features/admin/AdminDashboard.jsx', import.meta.url), 'utf8');
  source = source.replace(/import '\.\/clinicSetup\.css';/, '')
    .replace(/import ([A-Za-z]+) from [^;]+;/g, 'const $1 = () => null;')
    .replace(/import \{[^}]+\} from 'lucide-react';/, 'const Activity=()=>null,Building=Activity,CalendarDays=Activity,DollarSign=Activity,Sliders=Activity,Users=Activity;')
    .replace(/import \{ apiErrorMessage, fetchWithAuth \}[^;]+;/, 'const fetchWithAuth=(...args)=>globalThis.pricingTestFetch(...args); const apiErrorMessage=(payload,fallback)=>payload.error?.message||fallback;');
  const modulePath = new URL(`.pricing-admin-${process.pid}.mjs`, import.meta.url);
  await writeFile(modulePath, (await transformWithOxc(source, 'AdminDashboard.jsx', { jsx: { runtime: 'automatic' } })).code);
  let Admin;
  try { Admin = (await import(modulePath.href)).default; } finally { await unlink(modulePath); }
  let stored = { id: 'medicine', labelEn: 'Amoxicillin', unitPriceSdg: null, status: 'INACTIVE', updatedAt: '2020-01-01' };
  const requests = []; let finish;
  globalThis.pricingTestFetch = async (url, options = {}) => {
    if (options.method === 'PATCH') {
      requests.push(JSON.parse(options.body));
      return new Promise(resolve => { finish = resolve; });
    }
    return { ok: true, json: async () => url === '/api/admin/pricing' ? { doctors: [], services: [], medicines: [stored] } : [] };
  };
  const root = createRoot(document.querySelector('#root'));
  const render = async () => act(async () => root.render(createElement(Admin, { user: { role: 'ADMIN' }, lang: 'en', t: key => key })));
  const pricingTab = () => [...document.querySelectorAll('.menu-btn')].find(button => button.textContent === 'Pricing Management');
  const edit = async (price, status) => {
    const input = document.querySelector('input[aria-label="medicines price"]');
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, price);
    await act(async () => input.dispatchEvent(new window.Event('input', { bubbles: true })));
    const select = document.querySelector('select'); select.value = status;
    await act(async () => select.dispatchEvent(new window.Event('change', { bubbles: true })));
  };
  try {
    await render(); await act(async () => pricingTab().click());
    await edit('1000', 'ACTIVE');
    const save = document.querySelector('tbody button');
    await act(async () => { save.click(); save.click(); });
    assert.equal(requests.length, 1); assert.deepEqual(requests[0], { priceSdg: 1000, status: 'ACTIVE' });
    assert.equal(save.disabled, true); assert.equal(document.querySelector('[role="status"]'), null);
    await act(async () => finish({ ok: false, json: async () => ({ error: { code: 'MEDICINE_PRICE_UPDATE_FAILED', message: 'Failed to update medicine pricing.' } }) }));
    assert.match(document.querySelector('[role="alert"]').textContent, /Failed to update medicine pricing/);
    assert.equal(document.querySelector('[role="status"]'), null);
    assert.equal(stored.status, 'INACTIVE'); assert.equal(stored.unitPriceSdg, null);
    assert.equal(save.disabled, false);
    await act(async () => save.click());
    stored = { ...stored, unitPriceSdg: '1000', status: 'ACTIVE', updatedAt: '2026-10-27' };
    await act(async () => finish({ ok: true, json: async () => stored }));
    assert.match(document.querySelector('[role="status"]').textContent, /Official price updated/);
    assert.equal(document.querySelector('input').value, '1000'); assert.equal(document.querySelector('select').value, 'ACTIVE');
    // A tab reload reads the server, with the old draft cleared after success.
    await act(async () => document.querySelector('.menu-btn').click());
    await act(async () => pricingTab().click());
    assert.equal(document.querySelector('input').value, '1000'); assert.equal(document.querySelector('select').value, 'ACTIVE');
    for (const price of ['', '-1', '1.5']) {
      await edit(price, 'ACTIVE'); const before = requests.length;
      await act(async () => document.querySelector('tbody button').click());
      assert.equal(requests.length, before); assert.match(document.querySelector('[role="alert"]').textContent, /positive whole-number price/);
      assert.equal(document.querySelector('[role="status"]'), null);
    }
  } finally { await act(async () => root.unmount()); dom.window.close(); delete globalThis.pricingTestFetch; delete globalThis.confirm; }
});
