import { z } from 'zod';

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const ASCII_SPACES = / +/g;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_QUANTITY = 1_000_000_000;

function singleLine(name, max) {
  return z.string()
    .refine((value) => !CONTROL_CHARACTERS.test(value), `${name} must not contain control characters.`)
    .transform((value) => value.replace(/^ +| +$/g, '').replace(ASCII_SPACES, ' '))
    .pipe(z.string().min(1, `${name} is required.`).max(max, `${name} must be at most ${max} characters.`));
}

export const brandNameSchema = singleLine('brandName', 150);
export const medicineLabelSchema = singleLine('medicine label', 150);
export const genericNameSchema = singleLine('genericName', 150);
export const strengthSchema = singleLine('strength', 80);
export const dosageFormSchema = singleLine('dosageForm', 80);
export const batchNumberSchema = singleLine('batchNumber', 100);
export const uuidSchema = z.string().uuid();
export const quantitySchema = z.coerce.number().int().positive().max(MAX_QUANTITY);
export const reorderLevelSchema = z.coerce.number().int().min(0).max(MAX_QUANTITY);

export function isRealIsoDate(value) {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

export const expiryDateSchema = z.string().trim().refine(
  isRealIsoDate,
  'expiryDate must be a real calendar date in YYYY-MM-DD format.'
);

export const pharmacistMedicineSchema = z.object({
  brandName: brandNameSchema,
  labelAr: medicineLabelSchema,
  labelEn: medicineLabelSchema,
  genericName: genericNameSchema,
  strength: strengthSchema,
  dosageForm: dosageFormSchema
}).strict();

export const inventoryBatchSchema = z.object({
  batchNumber: batchNumberSchema,
  expiryDate: expiryDateSchema,
  qtyOnHand: quantitySchema,
  minReorderLevel: reorderLevelSchema.default(10)
}).strict();

export const pharmacistMedicineCreateSchema = pharmacistMedicineSchema.extend({
  initialBatch: inventoryBatchSchema.optional()
}).strict();

export const pharmacistMedicineMetadataSchema = pharmacistMedicineSchema.partial().strict().refine(
  (value) => Object.keys(value).length > 0,
  'At least one medicine metadata field is required.'
);

export const inventoryReceiptSchema = z.object({
  batchNumber: batchNumberSchema,
  expiryDate: expiryDateSchema,
  receivedQuantity: quantitySchema,
  minReorderLevel: reorderLevelSchema.default(10)
}).strict();

export const formularyIdParamsSchema = z.object({ id: uuidSchema }).strict();
export const formularySearchSchema = z.object({
  search: singleLine('search', 150).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional()
}).strict();

export const inventoryPageSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25)
}).strict();

export const stockMovementSchema = z.object({
  movementType: z.enum(['OPENING_BALANCE', 'RECEIPT', 'DISPENSE']),
  quantityDelta: z.number().int().refine((value) => value !== 0, 'quantityDelta must not be zero.'),
  resultingBalance: z.number().int().min(0),
  actorUserId: uuidSchema.nullable().optional(),
  referenceType: singleLine('referenceType', 50).optional(),
  referenceId: singleLine('referenceId', 150).optional(),
  reason: singleLine('reason', 500).optional(),
  idempotencyKey: singleLine('idempotencyKey', 200).optional()
}).strict().superRefine((movement, ctx) => {
  const positive = movement.movementType === 'OPENING_BALANCE' || movement.movementType === 'RECEIPT';
  if (positive && movement.quantityDelta <= 0) {
    ctx.addIssue({ code: 'custom', path: ['quantityDelta'], message: `${movement.movementType} quantityDelta must be positive.` });
  }
  if (movement.movementType === 'DISPENSE' && movement.quantityDelta >= 0) {
    ctx.addIssue({ code: 'custom', path: ['quantityDelta'], message: 'DISPENSE quantityDelta must be negative.' });
  }
  if (movement.movementType !== 'OPENING_BALANCE' && !movement.actorUserId) {
    ctx.addIssue({ code: 'custom', path: ['actorUserId'], message: `${movement.movementType} requires an authenticated actor.` });
  }
});

function canonicalComponent(value, schema) {
  return schema.parse(value).replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function lengthPrefix(value) {
  return `${Buffer.byteLength(value, 'utf8')}:${value}`;
}

export function buildMedicineIdentityKey(input) {
  return [
    canonicalComponent(input.brandName, brandNameSchema),
    canonicalComponent(input.genericName, genericNameSchema),
    canonicalComponent(input.strength, strengthSchema),
    canonicalComponent(input.dosageForm, dosageFormSchema)
  ].map(lengthPrefix).join('');
}

export function normalizeBatchNumber(value) {
  return batchNumberSchema.parse(value).replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

export function isMedicineIdentityUniqueViolation(error) {
  if (error?.code !== 'P2002') return false;

  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.length === 1 && String(target[0]).toLowerCase() === 'identitykey';
  }
  if (typeof target !== 'string') return false;

  const normalizedTarget = target.replace(/["'`\s]/g, '').toLowerCase();
  return normalizedTarget === 'identitykey'
    || normalizedTarget === 'drugformulary_identitykey_key'
    || normalizedTarget.endsWith('.drugformulary_identitykey_key');
}

export function isInventoryBatchUniqueViolation(error) {
  if (error?.code !== 'P2002') return false;

  const target = error.meta?.target;
  if (Array.isArray(target)) {
    const normalized = target.map((field) => String(field).toLowerCase()).sort();
    return normalized.length === 3
      && normalized.join(',') === ['drugid', 'expirydate', 'normalizedbatchnumber'].sort().join(',');
  }
  if (typeof target !== 'string') return false;

  const normalizedTarget = target.replace(/["'`\s]/g, '').toLowerCase();
  return normalizedTarget === 'inventorybatch_drugid_normalizedbatchnumber_expirydate_key'
    || normalizedTarget.endsWith('.inventorybatch_drugid_normalizedbatchnumber_expirydate_key');
}

export function summarizeMedicineStock(batches, clinicDate) {
  let totalStock = 0;
  let usableStock = 0;
  let expiredStock = 0;
  let nearestExpiry = null;
  let expiredBatchCount = 0;
  let lowStockBatchCount = 0;

  for (const batch of batches) {
    const quantity = Number(batch.qtyOnHand);
    const reorderLevel = Number(batch.minReorderLevel);
    totalStock += quantity;
    const expired = batch.expiryDate < clinicDate;
    if (expired) {
      expiredBatchCount += 1;
      if (quantity > 0) expiredStock += quantity;
      continue;
    }
    if (quantity > 0) {
      usableStock += quantity;
      if (!nearestExpiry || batch.expiryDate < nearestExpiry) nearestExpiry = batch.expiryDate;
    }
    if (quantity <= reorderLevel) lowStockBatchCount += 1;
  }

  return {
    totalStock,
    totalOnHand: totalStock,
    usableStock,
    expiredStock,
    nearestExpiry,
    nearestUnexpiredExpiry: nearestExpiry,
    lowStock: usableStock === 0 || lowStockBatchCount > 0,
    lowStockBatchCount,
    hasExpiredBatch: expiredBatchCount > 0,
    expiredBatchCount,
    batchCount: batches.length
  };
}

export function batchOperationalState(batch, clinicDate) {
  const expired = batch.expiryDate < clinicDate;
  const today = batch.expiryDate === clinicDate;
  const millisecondsPerDay = 86_400_000;
  const daysUntilExpiry = Math.round(
    (Date.parse(`${batch.expiryDate}T00:00:00Z`) - Date.parse(`${clinicDate}T00:00:00Z`)) / millisecondsPerDay
  );
  return {
    expired,
    expiresToday: today,
    nearExpiry: !expired && daysUntilExpiry <= 90,
    lowStock: Number(batch.qtyOnHand) <= Number(batch.minReorderLevel)
  };
}
