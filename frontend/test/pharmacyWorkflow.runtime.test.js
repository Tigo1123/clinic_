import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';

const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  IS_REACT_ACT_ENVIRONMENT: true
});
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');

async function compile(relativePath, replacements = []) {
  let source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  for (const [pattern, replacement] of replacements) source = source.replace(pattern, replacement);
  const compiled = await transformWithOxc(source, relativePath.split('/').at(-1), { jsx: { runtime: 'automatic' } });
  const output = new URL(`.pharmacy-runtime-${process.pid}-${relativePath.split('/').at(-1)}.mjs`, import.meta.url);
  await writeFile(output, compiled.code);
  return output;
}

const file = (relative) => JSON.stringify(new URL(relative, import.meta.url).href);
const dialogModule = await compile('../src/components/ui/Dialog.jsx', [
  ["'../../utils/scrollLock.js'", file('../src/utils/scrollLock.js')]
]);
const pharmacyPath = '../src/features/staff/pharmacy/';
const mockedApi = 'const fetchWithAuth = (...args) => globalThis.pharmacyFetch(...args); const apiErrorMessage = (body, fallback) => body?.error?.message || fallback;';
const mockDependencies = [
  [/import \{ (?:apiErrorMessage, )?fetchWithAuth \}[^;]+;/, mockedApi],
  ["'./pharmacyHelpers'", file(pharmacyPath + 'pharmacyHelpers.js')]
];
const managementModule = await compile(pharmacyPath + 'PharmacyManagement.jsx', [
  ...mockDependencies,
  ["'../../../components/ui/Dialog'", JSON.stringify(dialogModule.href)]
]);
const paymentModule = await compile(pharmacyPath + 'PharmacyPayment.jsx', mockDependencies);
let Inventory, Payment;
try {
  Inventory = (await import(managementModule.href)).default;
  Payment = (await import(paymentModule.href)).default;
} finally {
  await Promise.all([dialogModule, managementModule, paymentModule].map(unlink));
}

let root;
const reply = (data, status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
const dialog = () => document.querySelector('[role="dialog"]');
const button = (label, scope = document) => [...scope.querySelectorAll('button')].find((item) => item.textContent.trim() === label);
async function click(label, scope) {
  const control = button(label, scope);
  assert.ok(control, label);
  await act(async () => control.click());
}
async function setInput(selector, value) {
  await act(async () => {
    const input = document.querySelector(selector);
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}
async function mount(Component, props) {
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(createElement(Component, props)));
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
});

test('a used medicine permits label corrections, shows them when reopened, and requires explicit deactivation confirmation', async () => {
  let medicine = {
    id: 'medicine-1', labelEn: 'Original label', labelAr: 'الاسم الأصلي', brandName: 'Brand',
    genericName: 'Generic', strength: '5 mg', dosageForm: 'Tablet', status: 'ACTIVE',
    unitPriceSdg: 1500, identityLocked: true, stock: { totalOnHand: 12, usableStock: 10 }
  };
  const requests = [];
  globalThis.pharmacyFetch = async (url, options) => {
    if (url.endsWith('/metadata')) {
      requests.push({ url, options });
      medicine = { ...medicine, ...JSON.parse(options.body) };
      return reply({ medicine });
    }
    if (url.endsWith('/deactivate')) {
      requests.push({ url, options });
      medicine = { ...medicine, status: 'INACTIVE' };
      return reply({ medicine });
    }
    return reply(url.includes('?') ? { items: [medicine], pagination: { page: 1, totalPages: 1, total: 1 } } : medicine);
  };
  await mount(Inventory, { lang: 'en' });
  await click('⋮');
  await click('Edit metadata');
  assert.equal(document.querySelector('#medicine-strength').readOnly, true);
  assert.equal(document.querySelector('#medicine-labelEn').value, 'Original label');
  assert.equal(button('Save', dialog()).disabled, true);
  await setInput('#medicine-labelEn', 'Corrected label');
  await click('Save', dialog());
  assert.deepEqual(JSON.parse(requests[0].options.body), { labelEn: 'Corrected label' });
  await click('⋮');
  await click('Edit metadata');
  assert.equal(document.querySelector('#medicine-labelEn').value, 'Corrected label');
  await click('Cancel', dialog());
  await click('⋮');
  await click('Deactivate medicine');
  assert.match(dialog().textContent, /Stock, prescription and invoice history are kept/);
  await click('Cancel', dialog());
  assert.equal(requests.length, 1);
  await click('⋮');
  await click('Deactivate medicine');
  await click('Confirm deactivation', dialog());
  assert.equal(requests[1].options.method, 'POST');
  assert.match(document.body.textContent, /Inactive/);
  assert.match(document.body.textContent, /reactivate/);
  await click('⋮');
  assert.equal(button('Deactivate medicine'), undefined);
});

test('an uncertain partial payment is replayed with the same amount and key after refresh and remount', async () => {
  const prescriptionId = 'rx-payment';
  const paymentAttempts = new Map();
  const amountSent = [];
  let serverPaid = 0;
  globalThis.pharmacyFetch = async (url, options) => {
    if (url.endsWith('/payment-state')) {
      return reply({
        prescriptionId,
        invoice: { id: 'invoice-1', paidAmountSdg: serverPaid, totalAmountSdg: 2000, outstandingAmountSdg: 2000 - serverPaid, paymentStatus: serverPaid ? 'PARTIALLY_PAID' : 'UNPAID' },
        dispensingAllowed: false,
        allowedPaymentMethods: ['CASH']
      });
    }
    amountSent.push({ key: options.headers['Idempotency-Key'], body: JSON.parse(options.body) });
    if (amountSent.length === 1) {
      serverPaid += amountSent[0].body.payments[0].amountSdg;
      throw new Error('Connection closed before response');
    }
    return reply({ idempotentReplay: true });
  };
  await mount(Payment, { prescriptionId, lang: 'en', paymentAttempts });
  await setInput('input[type=number]', '500');
  await click('Record payment');
  assert.ok(button('Retry payment'));
  await act(async () => root.unmount());
  await mount(Payment, { prescriptionId, lang: 'en', paymentAttempts });
  await click('Reconcile payment state');
  assert.equal(button('Record payment').disabled, true);
  await click('Retry payment');
  assert.deepEqual(amountSent, [
    { key: amountSent[0].key, body: { payments: [{ amountSdg: 500, paymentMethod: 'CASH' }] } },
    amountSent[0]
  ]);
  assert.equal(serverPaid, 500);
  assert.equal(paymentAttempts.size, 0);
  assert.equal(button('Record payment').disabled, false);
});
