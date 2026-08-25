import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildBatchPayload,
  buildMedicinePayload,
  buildMetadataPayload,
  buildPaymentPayload,
  updateMedicineField,
  newPaymentAttempt,
  paymentAttemptIsReflected,
  samePaymentAttempt
} from '../src/utils/pharmacyManagement.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (relative) => readFileSync(path.join(root, relative), 'utf8');

test('pharmacist medicine payload is allow-listed and supports optional opening stock', () => {
  const payload = buildMedicinePayload({
    brandName: ' Clinic Brand ', labelAr: ' دواء ', labelEn: ' Medicine ', genericName: ' Generic ',
    strength: ' 10 mg ', dosageForm: ' Tablet ', includeInitialBatch: true,
    batchNumber: ' Lot 1 ', expiryDate: '2029-02-01', receivedQuantity: '15', minReorderLevel: '3',
    status: 'ACTIVE', unitPriceSdg: 1, identityKey: 'forged', actorUserId: 'forged'
  });
  assert.deepEqual(payload, {
    brandName: 'Clinic Brand', labelAr: 'دواء', labelEn: 'Medicine', genericName: 'Generic',
    strength: '10 mg', dosageForm: 'Tablet',
    initialBatch: { batchNumber: 'Lot 1', expiryDate: '2029-02-01', qtyOnHand: 15, minReorderLevel: 3 }
  });
  for (const field of ['status', 'unitPriceSdg', 'identityKey', 'actorUserId']) assert.equal(field in payload, false);
});

test('catalog-only, metadata, and receipt payloads expose no price, status, or stock override', () => {
  const base = { brandName: 'B', labelAr: 'A', labelEn: 'E', genericName: 'G', strength: '1', dosageForm: 'T' };
  assert.equal('initialBatch' in buildMedicinePayload(base), false);
  assert.deepEqual(Object.keys(buildMetadataPayload({ ...base, status: 'ACTIVE', unitPriceSdg: 4 })).sort(), Object.keys(base).sort());
  assert.deepEqual(buildBatchPayload({ batchNumber: ' X ', expiryDate: '2029-01-01', receivedQuantity: '8', minReorderLevel: '2', qtyOnHand: 999 }), {
    batchNumber: 'X', expiryDate: '2029-01-01', receivedQuantity: 8, minReorderLevel: 2
  });
});

test('payment payload is minimal and exact-attempt retries reuse one idempotency key', () => {
  const payload = buildPaymentPayload('3400', 'BANKAK');
  assert.deepEqual(payload, { payments: [{ amountSdg: 3400, paymentMethod: 'BANKAK' }] });
  for (const field of ['total', 'outstanding', 'status', 'actorId', 'role', 'price']) assert.equal(field in payload, false);
  let calls = 0;
  const first = newPaymentAttempt('invoice-1', '3400', 'BANKAK', 1000, () => `key-${++calls}`);
  assert.equal(samePaymentAttempt(first, 'invoice-1', '3400', 'BANKAK'), true);
  assert.equal(samePaymentAttempt(first, 'invoice-1', '3399', 'BANKAK'), false);
  assert.equal(first.idempotencyKey, 'key-1');
  assert.equal(paymentAttemptIsReflected(first, { invoice: { id: 'invoice-1', paidAmountSdg: 4400 } }), true);
  assert.equal(paymentAttemptIsReflected(first, { invoice: { id: 'invoice-1', paidAmountSdg: 1000 } }), false);
  const nextPartialPayment = newPaymentAttempt('invoice-1', '1200', 'CASH', 4400, () => `key-${++calls}`);
  assert.equal(nextPartialPayment.idempotencyKey, 'key-2');
  assert.notEqual(nextPartialPayment.idempotencyKey, first.idempotencyKey);
  assert.equal(samePaymentAttempt(first, 'invoice-1', '3400', 'CASH'), false);
});

test('dashboard integrates bounded APIs, server payment state, and read-only movement history', () => {
  const management = source('src/features/pharmacy/PharmacyManagement.jsx');
  const payment = source('src/features/pharmacy/PharmacyPayment.jsx');
  const dashboard = source('src/features/pharmacy/PharmacyDashboard.jsx');
  assert.match(management, /Medicine & Inventory Management/);
  assert.match(management, /pageSize: '20'/);
  assert.match(management, /FORMULARY_MEDICINE_ALREADY_EXISTS/);
  assert.match(management, /FORMULARY_IDENTITY_IMMUTABLE/);
  assert.match(management, /INVENTORY_BATCH_ALREADY_EXISTS/);
  assert.match(management, /read-only and cannot be edited or deleted/);
  assert.doesNotMatch(management, /method: '(PUT|DELETE)'/);
  assert.match(payment, /Idempotency-Key/);
  assert.match(payment, /reconciliationRequired/);
  assert.match(payment, /Reconcile payment state/);
  assert.match(payment, /disabled=\{submitting \|\| reconciliationRequired\}/);
  assert.match(payment, /disabled=\{reconciliationRequired\}/);
  assert.match(payment, /if \(!responseReceived\) requireReconciliation\(true\)/);
  assert.match(payment, /attemptRef\.current = null/);
  assert.match(payment, /loadState\(\)/);
  assert.doesNotMatch(payment, /\/dispense/);
  assert.match(dashboard, /paymentState\?\.dispensingAllowed/);
});

test('reception pharmacy billing is read-only while non-pharmacy payment controls remain', () => {
  const reception = source('src/features/reception/ReceptionDashboard.jsx');
  assert.match(reception, /Reception may issue the invoice only\. Pharmacy payment is recorded by the pharmacist\./);
  assert.match(reception, /!selectedPharmacyBillingPrescription && <>/);
  assert.match(reception, /Pay Consultation/);
  assert.match(reception, /Pay Laboratory/);
});

test('pharmacist price and status remain display-only', () => {
  const management = source('src/features/pharmacy/PharmacyManagement.jsx');
  assert.match(management, /Official price/);
  assert.doesNotMatch(management, /unitPriceSdg[^\n]*(onChange|setForm)/);
  assert.doesNotMatch(management, /name="(unitPriceSdg|status)"/);
});

test('each Add Medicine text field updates only its own immutable state property', () => {
  const fields = ['brandName', 'labelAr', 'labelEn', 'genericName', 'strength', 'dosageForm'];
  const entered = Object.fromEntries(fields.map((field) => [field, `${field}-before`]));

  for (const field of fields) {
    const next = updateMedicineField(entered, field, `${field}-after`);
    assert.notEqual(next, entered, `${field} update must return a new state object`);
    assert.equal(next[field], `${field}-after`);
    for (const other of fields.filter((candidate) => candidate !== field)) {
      assert.equal(next[other], entered[other], `${field} must preserve ${other}`);
    }
  }
});

test('Add Medicine controls have stable unique IDs, matching names and explicit labels', () => {
  const management = source('src/features/pharmacy/PharmacyManagement.jsx');
  assert.match(management, /htmlFor=\{id\}/);
  assert.match(management, /<input id=\{id\}/);
  assert.match(management, /key=\{name\} id=\{`medicine-\$\{name\}`\} name=\{name\}/);
  assert.match(management, /dir=\{name === 'labelAr' \? 'rtl' : 'ltr'\}/);
  assert.match(management, /updateMedicineField\(current, name, event\.target\.value\)/);

  const fields = ['brandName', 'labelAr', 'labelEn', 'genericName', 'strength', 'dosageForm'];
  const ids = fields.map((field) => `medicine-${field}`);
  assert.equal(new Set(ids).size, fields.length);
});

test('formulary search is submit-driven and opening or typing in the dialog cannot request it', () => {
  const management = source('src/features/pharmacy/PharmacyManagement.jsx');
  assert.match(management, /onChange=\{\(event\) => setSearchInput\(event\.target\.value\)\}/);
  assert.doesNotMatch(management, /setSearchInput\([^\n]*loadFormulary/);
  assert.match(management, /onSubmit=\{\(event\) => \{ event\.preventDefault\(\); setSearch\(searchInput\.trim\(\)\); setSearchSubmission/);
  assert.match(management, /\[loadFormulary, refreshToken, search, searchSubmission, status\]/);
  assert.doesNotMatch(management, /setDialog\('create'\)[^\n]*loadFormulary/);
});

test('one search submission has one effect-owned request and keeps latest-response protection', () => {
  const management = source('src/features/pharmacy/PharmacyManagement.jsx');
  const submit = management.match(/<form className="pharmacy-toolbar" onSubmit=\{([\s\S]*?)\}>/)?.[1] || '';
  assert.equal((submit.match(/setSearchSubmission/g) || []).length, 1);
  assert.equal((submit.match(/loadFormulary/g) || []).length, 0);
  assert.match(management, /const requestId = \+\+formularyRequestRef\.current/);
  assert.match(management, /if \(requestId === formularyRequestRef\.current\) \{\s*setItems\(data\.items \|\| \[\]\)/);
  assert.match(management, /return \(\) => \{ formularyRequestRef\.current \+= 1; \}/);
});

test('dialog close identity stays stable so ordinary field rerenders preserve focus', () => {
  const management = source('src/features/pharmacy/PharmacyManagement.jsx');
  assert.match(management, /const closeDialog = useCallback\([\s\S]*?\}, \[\]\);/);
  assert.match(management, /<Dialog open=\{dialog === 'create'\}[\s\S]*?onClose=\{closeDialog\}/);
});
