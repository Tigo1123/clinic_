import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (relative) => readFileSync(path.join(root, relative), 'utf8');

test('GENERAL invoice requests send catalog identity and quantity without browser pricing', () => {
  const reception = source('src/features/reception/ReceptionDashboard.jsx');
  assert.match(reception, /invoiceType === 'GENERAL'/);
  assert.match(reception, /serviceId: service\.id/);
  assert.match(reception, /quantity: service\.qty/);
  const generalPayload = reception.slice(
    reception.indexOf("if (invoiceType === 'GENERAL')"),
    reception.indexOf("const res = await fetchWithAuth('/api/billing/invoice'")
  );
  assert.doesNotMatch(generalPayload, /unitPriceSdg|subtotal|total:/);
});

test('admin pricing management covers consultations, services, laboratory, and pharmacy catalogues', () => {
  const admin = source('src/features/admin/AdminDashboard.jsx');
  assert.match(admin, /Pricing Management/);
  assert.match(admin, /\/api\/admin\/pricing/);
  assert.match(admin, /Consultation Fees/);
  assert.match(admin, /Clinical & Laboratory Services/);
  assert.match(admin, /Pharmacy Selling Prices/);
  assert.match(admin, /Historical invoices remain unchanged/);
});

test('laboratory and pharmacy workflows cannot submit official selling prices', () => {
  const laboratory = source('src/features/laboratory/LaboratoryDashboard.jsx');
  const pharmacy = source('src/features/pharmacy/PharmacyDashboard.jsx');
  const pharmacyUtils = source('src/utils/pharmacyManagement.js');
  const labCreatePayload = laboratory.slice(
    laboratory.indexOf("if (decision === 'CREATE_SERVICE')"),
    laboratory.indexOf('setReviewingId(request.id)')
  );
  const pharmacyCreatePayload = pharmacyUtils.slice(
    pharmacyUtils.indexOf('export function buildMedicationReviewPayload'),
    pharmacyUtils.indexOf('export function customMedicineRequiresReview')
  );
  assert.doesNotMatch(labCreatePayload, /baseFeeSdg|baseFeeUsd/);
  assert.doesNotMatch(pharmacyCreatePayload, /unitPriceSdg/);
  assert.doesNotMatch(pharmacy, /\/api\/records\/drugs\/\$\{drug\.id\}\/price/);
  assert.match(laboratory, /Create for Admin Pricing/);
  assert.match(pharmacy, /Administrators price and activate new medicines/);
});

test('nullable official prices remain visibly unconfigured instead of displaying zero', () => {
  const admin = source('src/features/admin/AdminDashboard.jsx');
  const reception = source('src/features/reception/ReceptionDashboard.jsx');
  const pharmacy = source('src/features/pharmacy/PharmacyDashboard.jsx');

  assert.match(admin, /currentPrice == null \? ''/);
  assert.match(admin, /Not configured/);
  assert.match(reception, /baseFeeSdg == null \? null/);
  assert.match(reception, /Pricing required/);
  assert.match(pharmacy, /Not set/);
});
