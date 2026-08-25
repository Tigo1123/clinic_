import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMedicineIdentityKey,
  expiryDateSchema,
  inventoryBatchSchema,
  inventoryReceiptSchema,
  isInventoryBatchUniqueViolation,
  isMedicineIdentityUniqueViolation,
  normalizeBatchNumber,
  pharmacistMedicineSchema,
  stockMovementSchema
} from '../src/utils/medicineManagement.js';

const medicine = {
  brandName: 'Acme Relief',
  labelAr: 'دواء أكمي',
  labelEn: 'Acme Relief Display',
  genericName: 'Paracetamol',
  strength: '500 mg',
  dosageForm: 'Tablet'
};

test('medicine identity canonicalizes equivalent casing and spaces', () => {
  const first = buildMedicineIdentityKey(medicine);
  const second = buildMedicineIdentityKey({
    ...medicine,
    brandName: '  ACME   RELIEF ',
    genericName: ' paracetamol ',
    strength: '500   MG',
    dosageForm: ' TABLET '
  });
  assert.equal(first, second);
});

test('medicine identity distinguishes different brands with the same clinical components', () => {
  assert.notEqual(
    buildMedicineIdentityKey(medicine),
    buildMedicineIdentityKey({ ...medicine, brandName: 'Another Brand' })
  );
});

test('single-line medicine and batch fields reject control characters', () => {
  assert.equal(pharmacistMedicineSchema.safeParse({ ...medicine, brandName: 'Acme\nRelief' }).success, false);
  assert.equal(inventoryBatchSchema.safeParse({
    batchNumber: 'LOT\r001', expiryDate: '2028-02-29', qtyOnHand: 1, minReorderLevel: 0
  }).success, false);
});

test('expiry validation rejects impossible dates and accepts a real leap day', () => {
  assert.equal(expiryDateSchema.safeParse('2026-02-30').success, false);
  assert.equal(expiryDateSchema.parse('2028-02-29'), '2028-02-29');
  assert.equal(expiryDateSchema.safeParse('2027-02-29').success, false);
});

test('batch identity canonicalizes equivalent casing and spaces', () => {
  assert.equal(normalizeBatchNumber(' Lot   AB-01 '), normalizeBatchNumber('lot ab-01'));
});

test('pharmacist medicine schema rejects server-owned identity, price, and status fields', () => {
  for (const field of ['identityKey', 'unitPriceSdg', 'status']) {
    assert.equal(pharmacistMedicineSchema.safeParse({ ...medicine, [field]: 'forged' }).success, false);
  }
});

test('stock movement validation enforces direction and non-negative resulting balances', () => {
  assert.equal(stockMovementSchema.safeParse({
    movementType: 'OPENING_BALANCE', quantityDelta: 10, resultingBalance: 10
  }).success, true);
  assert.equal(stockMovementSchema.safeParse({
    movementType: 'RECEIPT', quantityDelta: -1, resultingBalance: 9,
    actorUserId: '10000000-0000-4000-8000-000000000001'
  }).success, false);
  assert.equal(stockMovementSchema.safeParse({
    movementType: 'DISPENSE', quantityDelta: 1, resultingBalance: 9,
    actorUserId: '10000000-0000-4000-8000-000000000001'
  }).success, false);
  assert.equal(stockMovementSchema.safeParse({
    movementType: 'DISPENSE', quantityDelta: -1, resultingBalance: -1,
    actorUserId: '10000000-0000-4000-8000-000000000001'
  }).success, false);
  assert.equal(stockMovementSchema.safeParse({
    movementType: 'DISPENSE', quantityDelta: -1, resultingBalance: 9
  }).success, false);
});

test('formulary identity P2002 matching is narrow', () => {
  assert.equal(isMedicineIdentityUniqueViolation({
    code: 'P2002', meta: { target: ['identityKey'] }
  }), true);
  assert.equal(isMedicineIdentityUniqueViolation({
    code: 'P2002', meta: { target: 'DrugFormulary_identityKey_key' }
  }), true);
  assert.equal(isMedicineIdentityUniqueViolation({
    code: 'P2002', meta: { target: ['drugId', 'normalizedBatchNumber', 'expiryDate'] }
  }), false);
  assert.equal(isMedicineIdentityUniqueViolation({
    code: 'P2002', meta: { target: 'StockMovement_idempotencyKey_key' }
  }), false);
  assert.equal(isMedicineIdentityUniqueViolation({ code: 'P2002' }), false);
});

test('inventory batch P2002 matching and receipt mass assignment are narrow', () => {
  assert.equal(isInventoryBatchUniqueViolation({
    code: 'P2002', meta: { target: ['drugId', 'normalizedBatchNumber', 'expiryDate'] }
  }), true);
  assert.equal(isInventoryBatchUniqueViolation({
    code: 'P2002', meta: { target: 'InventoryBatch_drugId_normalizedBatchNumber_expiryDate_key' }
  }), true);
  assert.equal(isInventoryBatchUniqueViolation({
    code: 'P2002', meta: { target: ['identityKey'] }
  }), false);
  for (const field of ['qtyOnHand', 'normalizedBatchNumber', 'resultingBalance', 'actorUserId', 'movementType']) {
    assert.equal(inventoryReceiptSchema.safeParse({
      batchNumber: 'LOT-1', expiryDate: '2035-01-01', receivedQuantity: 4, [field]: 'forged'
    }).success, false);
  }
});
