import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';

test('Pharmacy revalidates on focus, deduplicates visibility/focus and rejects out-of-order refreshes', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
  const { act, createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  let source = readFileSync(new URL('../src/features/pharmacy/PharmacyManagement.jsx', import.meta.url), 'utf8');
  source = source.replace(/import '\.\/pharmacy\.css';/, '')
    .replace(/import ([A-Za-z]+) from [^;]+;/g, 'const $1=()=>null;')
    .replace(/import \{[^}]+\} from 'lucide-react';/, 'const PackagePlus=()=>null,RefreshCw=PackagePlus,Search=PackagePlus;')
    .replace(/import \{ fetchWithAuth \}[^;]+;/, 'const fetchWithAuth=(...args)=>globalThis.pharmacyRefreshFetch(...args);')
    .replace("'../../utils/clinicTime.js'", JSON.stringify(new URL('../src/utils/clinicTime.js', import.meta.url).href))
    .replace("'../../utils/pharmacyManagement'", JSON.stringify(new URL('../src/utils/pharmacyManagement.js', import.meta.url).href));
  const modulePath = new URL(`.pharmacy-refresh-${process.pid}.mjs`, import.meta.url);
  await writeFile(modulePath, (await transformWithOxc(source, 'PharmacyManagement.jsx', { jsx: { runtime: 'automatic' } })).code);
  let Pharmacy;
  try { Pharmacy = (await import(modulePath.href)).default; } finally { await unlink(modulePath); }
  const pending = [];
  globalThis.pharmacyRefreshFetch = async () => new Promise(resolve => pending.push(resolve));
  const root = createRoot(document.querySelector('#root'));
  const medicine = { id: 'medicine', brandName: 'Amoxicillin', labelEn: 'Amoxicillin', status: 'INACTIVE', unitPriceSdg: null, stock: {} };
  const respond = (index, item) => act(async () => pending[index]({ ok: true, json: async () => ({ items: [item], pagination: { page: 1, total: 1, totalPages: 1 } }) }));
  try {
    await act(async () => root.render(createElement(Pharmacy, { lang: 'en' })));
    await respond(0, medicine);
    assert.ok(document.querySelector('.pharmacy-admin-note'));
    await act(async () => {
      window.dispatchEvent(new window.Event('focus'));
      document.dispatchEvent(new window.Event('visibilitychange'));
    });
    assert.equal(pending.length, 2, 'one in-flight focus refresh, not two');
    await respond(1, { ...medicine, status: 'ACTIVE', unitPriceSdg: 2450 });
    assert.equal(document.querySelector('.pharmacy-admin-note'), null);
    assert.match(document.querySelector('.pharmacy-inventory-table').textContent, /2,450 SDG/);
    await act(async () => window.dispatchEvent(new window.Event('focus'))); // slow old refresh
    const refresh = [...document.querySelectorAll('.pharmacy-toolbar button')].find(button => button.textContent.trim() === 'Refresh');
    await act(async () => refresh.click()); // refresh is disabled while loading
    assert.equal(pending.length, 3);
    // Returning from Admin must supersede an older in-flight Pharmacy snapshot.
    await act(async () => {
      window.dispatchEvent(new window.Event('blur'));
      window.dispatchEvent(new window.Event('focus'));
      document.dispatchEvent(new window.Event('visibilitychange'));
    });
    assert.equal(pending.length, 4);
    await respond(3, { ...medicine, status: 'ACTIVE', unitPriceSdg: 3450 });
    await respond(2, medicine);
    assert.equal(document.querySelector('.pharmacy-admin-note'), null);
    assert.match(document.querySelector('.pharmacy-inventory-table').textContent, /3,450 SDG/);
    await act(async () => root.unmount());
    window.dispatchEvent(new window.Event('focus'));
    assert.equal(pending.length, 4, 'unmounted Pharmacy must remove its listeners');
  } finally { if (document.querySelector('#root')?.childElementCount) await act(async () => root.unmount()); dom.window.close(); delete globalThis.pharmacyRefreshFetch; }
});
