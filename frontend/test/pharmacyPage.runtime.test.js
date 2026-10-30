import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { transformWithOxc } from 'vite';
import { JSDOM } from 'jsdom';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

async function compile(name, path, replace) {
  const source = replace(await readFile(new URL(path, import.meta.url), 'utf8'));
  const file = new URL(`.pharmacy-${name}-${process.pid}.mjs`, import.meta.url);
  await writeFile(file, (await transformWithOxc(source, `${name}.jsx`, { jsx: { runtime: 'automatic' } })).code);
  try { return (await import(file.href)).default; } finally { await unlink(file); }
}
const Page = await compile('page', '../src/features/pharmacy/PharmacyPage.jsx', source => source.replace("import('./PharmacyDashboard')", 'globalThis.pharmacyModuleImport()').replace('window.location.reload()', 'globalThis.reloadPharmacyPage()'));
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
async function mount(Component, props = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.querySelector('#root'));
  await act(async () => root.render(createElement(StrictMode, null, createElement(Component, props, createElement('div', { id: 'workspace' }, 'Pharmacy')))));
  return async () => { await act(async () => root.unmount()); dom.window.close(); };
}
const click = () => act(async () => document.querySelector('button').click());

test('Pharmacy module rejection shows localized error and Retry reloads the module graph', async () => {
  globalThis.pharmacyModuleImport = () => Promise.reject(Error('RAW ENGLISH IMPORT ERROR'));
  const cleanup = await mount(Page, { lang: 'ar' });
  try {
    assert.match(document.querySelector('[role=alert]').textContent, /[\u0600-\u06ff]/u); assert.doesNotMatch(document.body.textContent, /RAW ENGLISH/);
    let reloads = 0; globalThis.reloadPharmacyPage = () => { reloads++; };
    await click(); assert.equal(reloads, 1); assert.equal(document.querySelector('[role=status]'), null);
  } finally { await cleanup(); delete globalThis.pharmacyModuleImport; delete globalThis.reloadPharmacyPage; }
});
test('pending module can be cancelled; a stale module result cannot replace error', async () => {
  const slow = deferred(); globalThis.pharmacyModuleImport = () => slow.promise;
  const cleanup = await mount(Page, { lang: 'en' });
  try {
    assert.ok(document.querySelector('[role=status]')); await click(); assert.ok(document.querySelector('[role=alert]'));
    await act(async () => slow.resolve({ default: () => createElement('div', { id: 'stale' }, 'Stale') }));
    assert.equal(document.querySelector('#stale'), null); assert.ok(document.querySelector('[role=alert]'));
  } finally { await cleanup(); delete globalThis.pharmacyModuleImport; delete globalThis.reloadPharmacyPage; }
});

const Payment = await compile('payment', '../src/features/pharmacy/PharmacyPayment.jsx', source => source
  .replace("import { apiErrorMessage, fetchWithAuth } from '../../services/staffApi';", "const fetchWithAuth=(...args)=>globalThis.pharmacyPaymentFetch(...args);const apiErrorMessage=()=>'';")
  .replace("'../../services/pharmacyReads.js'", JSON.stringify(new URL('../src/services/pharmacyReads.js', import.meta.url).href))
  .replace("'../../utils/pharmacyManagement'", JSON.stringify(new URL('../src/utils/pharmacyManagement.js', import.meta.url).href)));
for (const lang of ['ar', 'en']) for (const status of [401, 403, 500]) test(`payment-state ${status} renders ${lang} error and Retry instead of billing-pending copy`, async () => {
  let failure = true;
  globalThis.pharmacyPaymentFetch = async () => new Response(JSON.stringify(failure ? { error: 'RAW PRIVATE ENGLISH ERROR' } : { prescriptionId: 'rx', invoice: null, billingPending: { code: 'PHARMACY_INVOICE_PENDING' }, dispensingAllowed: false, allowedPaymentMethods: [] }), { status: failure ? status : 200 });
  const cleanup = await mount(Payment, { prescriptionId: 'rx', lang });
  try {
    const error = document.querySelector('[role=alert]'); assert.ok(error); assert.equal(document.querySelector('[role=status]'), null);
    assert.equal(/[\u0600-\u06ff]/u.test(error.textContent), lang === 'ar'); assert.doesNotMatch(error.textContent, /RAW PRIVATE/);
    failure = false; await click(); assert.equal(document.querySelector('[role=alert]'), null); assert.match(document.body.textContent, lang === 'ar' ? /قيد التجهيز/ : /is being prepared automatically/);
  } finally { await cleanup(); delete globalThis.pharmacyPaymentFetch; }
});
test('malformed payment-state cannot enable dispensing or become fake billing-pending', async () => {
  const states = []; globalThis.pharmacyPaymentFetch = async () => new Response('{}');
  const cleanup = await mount(Payment, { prescriptionId: 'rx', lang: 'en', onStateChange: state => states.push(state) });
  try { assert.match(document.querySelector('[role=alert]').textContent, /invalid data/); assert.equal(document.querySelector('[role=status]'), null); assert.equal(states.some(state => state?.dispensingAllowed), false); }
  finally { await cleanup(); delete globalThis.pharmacyPaymentFetch; }
});
test('pending payment-state is cancellable and stops loading without a response', async () => {
  globalThis.pharmacyPaymentFetch = () => new Promise(() => {});
  const cleanup = await mount(Payment, { prescriptionId: 'rx', lang: 'en' });
  try { assert.ok(document.querySelector('[role=status]')); await click(); assert.equal(document.querySelector('[role=status]'), null); assert.match(document.querySelector('[role=alert]').textContent, /cancelled/); }
  finally { await cleanup(); delete globalThis.pharmacyPaymentFetch; }
});

for (const lang of ['ar', 'en']) for (const hasInvoice of [false, true]) test(`payment refresh preserves ${hasInvoice ? 'invoice totals' : 'confirmed billing-pending snapshot'} and exposes ${lang} failure`, async () => {
  let fail = false;
  const payload = { prescriptionId: 'rx', invoice: hasInvoice ? { id: 'invoice', totalAmountSdg: 500, paidAmountSdg: 100, outstandingAmountSdg: 400, paymentStatus: 'PARTIALLY_PAID' } : null, billingPending: { code: 'PHARMACY_INVOICE_PENDING' }, dispensingAllowed: false, allowedPaymentMethods: ['CASH'] };
  globalThis.pharmacyPaymentFetch = async () => new Response(JSON.stringify(fail ? { error: 'RAW BACKEND ENGLISH' } : payload), { status: fail ? 500 : 200 });
  const cleanup = await mount(Payment, { prescriptionId: 'rx', lang });
  try {
    assert.equal(document.querySelector('[role=alert]'), null);
    fail = true; await click();
    assert.ok(document.querySelector('[role=alert]'));
    assert.equal(/[\u0600-\u06ff]/u.test(document.querySelector('[role=alert]').textContent), lang === 'ar');
    assert.doesNotMatch(document.body.textContent, /RAW BACKEND/);
    assert.match(document.body.textContent, hasInvoice ? /500/ : lang === 'ar' ? /قيد التجهيز/ : /being prepared automatically/);
    fail = false; await click(); assert.equal(document.querySelector('[role=alert]'), null);
  } finally { await cleanup(); delete globalThis.pharmacyPaymentFetch; }
});
