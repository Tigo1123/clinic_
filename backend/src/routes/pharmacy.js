import express from 'express';
import { z } from 'zod';
import { Prisma } from '../generated/prisma/index.js';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { allowRoles, ROLES } from '../middleware/policies.js';
import { validate } from '../middleware/validate.js';
import { sendError } from '../utils/apiError.js';
import { getClinicDateString } from '../utils/clinicTime.js';
import {
  batchOperationalState,
  buildMedicineIdentityKey,
  formularyIdParamsSchema,
  formularySearchSchema,
  inventoryPageSchema,
  inventoryReceiptSchema,
  isInventoryBatchUniqueViolation,
  isMedicineIdentityUniqueViolation,
  normalizeBatchNumber,
  pharmacistMedicineCreateSchema,
  pharmacistMedicineMetadataSchema,
  stockMovementSchema,
  summarizeMedicineStock
} from '../utils/medicineManagement.js';

const router = express.Router();
const readRoles = allowRoles(ROLES.PHARMACIST, ROLES.ADMIN);
const pharmacistOnly = allowRoles(ROLES.PHARMACIST);
const identityFields = ['brandName', 'genericName', 'strength', 'dosageForm'];
const paymentMethods = ['CASH', 'CARD', 'BANKAK', 'FAWRY'];
const prescriptionIdParamsSchema = z.object({ id: z.string().uuid() }).strict();

function apiFailure(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function publicMedicine(medicine, batches) {
  return {
    id: medicine.id,
    brandName: medicine.brandName,
    labelAr: medicine.labelAr,
    labelEn: medicine.labelEn,
    genericName: medicine.genericName,
    strength: medicine.strength,
    dosageForm: medicine.dosageForm,
    status: medicine.status,
    unitPriceSdg: medicine.unitPriceSdg == null ? null : Number(medicine.unitPriceSdg),
    updatedAt: medicine.updatedAt,
    stock: Array.isArray(batches)
      ? summarizeMedicineStock(batches, getClinicDateString())
      : batches
  };
}

function safeStockNumber(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw apiFailure(500, 'STOCK_SUMMARY_INVALID', 'Stock summary exceeds the supported numeric range.');
  }
  return number;
}

async function loadStockSummaries(drugIds, clinicDate = getClinicDateString()) {
  if (drugIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw(Prisma.sql`
    SELECT
      "drugId",
      COALESCE(SUM("qtyOnHand"), 0)::text AS "totalStock",
      COALESCE(SUM("qtyOnHand") FILTER (
        WHERE "expiryDate" >= ${clinicDate} AND "qtyOnHand" > 0
      ), 0)::text AS "usableStock",
      COALESCE(SUM("qtyOnHand") FILTER (
        WHERE "expiryDate" < ${clinicDate} AND "qtyOnHand" > 0
      ), 0)::text AS "expiredStock",
      MIN("expiryDate") FILTER (
        WHERE "expiryDate" >= ${clinicDate} AND "qtyOnHand" > 0
      ) AS "nearestExpiry",
      BOOL_OR("expiryDate" < ${clinicDate}) AS "hasExpiredBatch",
      BOOL_OR(
        "expiryDate" >= ${clinicDate}
        AND "qtyOnHand" <= "minReorderLevel"
      ) AS "batchBelowReorderLevel",
      COUNT(*)::text AS "batchCount"
    FROM "InventoryBatch"
    WHERE "drugId" IN (${Prisma.join(drugIds)})
    GROUP BY "drugId"
  `);
  return new Map(rows.map((row) => {
    const totalStock = safeStockNumber(row.totalStock);
    const usableStock = safeStockNumber(row.usableStock);
    return [row.drugId, {
      totalStock,
      usableStock,
      expiredStock: safeStockNumber(row.expiredStock),
      nearestExpiry: row.nearestExpiry,
      lowStock: usableStock === 0 || row.batchBelowReorderLevel,
      hasExpiredBatch: row.hasExpiredBatch,
      batchCount: safeStockNumber(row.batchCount)
    }];
  }));
}

function emptyStockSummary() {
  return {
    totalStock: 0,
    usableStock: 0,
    expiredStock: 0,
    nearestExpiry: null,
    lowStock: true,
    hasExpiredBatch: false,
    batchCount: 0
  };
}

function handleMutationError(error, res, next) {
  if (isMedicineIdentityUniqueViolation(error)) {
    return sendError(res, 409, 'FORMULARY_MEDICINE_ALREADY_EXISTS', 'A matching medicine already exists.');
  }
  if (isInventoryBatchUniqueViolation(error)) {
    return sendError(res, 409, 'INVENTORY_BATCH_ALREADY_EXISTS', 'This inventory batch already exists for the medicine and expiry date.');
  }
  if (error?.status && error?.code) return sendError(res, error.status, error.code, error.message);
  return next(error);
}

async function lockMedicine(tx, id) {
  const locked = await tx.$queryRaw`SELECT "id" FROM "DrugFormulary" WHERE "id" = ${id} FOR UPDATE`;
  if (locked.length !== 1) throw apiFailure(404, 'FORMULARY_MEDICINE_NOT_FOUND', 'Medicine was not found.');
}

router.get('/formulary', authenticate, readRoles, validate(formularySearchSchema, 'query'), async (req, res, next) => {
  try {
    const { search, status, page, pageSize } = req.query;
    const where = {
      ...(status && { status }),
      ...(search && {
        OR: ['brandName', 'labelAr', 'labelEn', 'genericName', 'strength', 'dosageForm']
          .map((field) => ({ [field]: { contains: search, mode: 'insensitive' } }))
      })
    };
    const [total, medicines] = await Promise.all([
      prisma.drugFormulary.count({ where }),
      prisma.drugFormulary.findMany({
        where,
        select: {
          id: true, brandName: true, labelAr: true, labelEn: true,
          genericName: true, strength: true, dosageForm: true,
          status: true, unitPriceSdg: true, updatedAt: true
        },
        orderBy: [{ brandName: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);
    const stockByDrug = await loadStockSummaries(medicines.map((medicine) => medicine.id));
    return res.json({
      items: medicines.map((medicine) => publicMedicine(
        medicine,
        stockByDrug.get(medicine.id) || emptyStockSummary()
      )),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/formulary/:id', authenticate, readRoles, validate(formularyIdParamsSchema, 'params'), async (req, res, next) => {
  try {
    const medicine = await prisma.drugFormulary.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, brandName: true, labelAr: true, labelEn: true,
        genericName: true, strength: true, dosageForm: true,
        status: true, unitPriceSdg: true, updatedAt: true
      }
    });
    if (!medicine) return sendError(res, 404, 'FORMULARY_MEDICINE_NOT_FOUND', 'Medicine was not found.');
    const summaries = await loadStockSummaries([medicine.id]);
    return res.json(publicMedicine(medicine, summaries.get(medicine.id) || emptyStockSummary()));
  } catch (error) {
    return next(error);
  }
});

router.post('/formulary', authenticate, pharmacistOnly, validate(pharmacistMedicineCreateSchema), async (req, res, next) => {
  try {
    const { initialBatch, ...metadata } = req.body;
    const identityKey = buildMedicineIdentityKey(metadata);
    const result = await prisma.$transaction(async (tx) => {
      const medicine = await tx.drugFormulary.create({
        data: { ...metadata, identityKey, status: 'INACTIVE', unitPriceSdg: null }
      });
      let batch = null;
      if (initialBatch) {
        if (initialBatch.expiryDate <= getClinicDateString()) {
          throw apiFailure(422, 'INVENTORY_EXPIRY_INVALID', 'Inventory expiry must be after the current clinic date.');
        }
        batch = await tx.inventoryBatch.create({
          data: {
            drugId: medicine.id,
            batchNumber: initialBatch.batchNumber,
            normalizedBatchNumber: normalizeBatchNumber(initialBatch.batchNumber),
            expiryDate: initialBatch.expiryDate,
            qtyOnHand: initialBatch.qtyOnHand,
            minReorderLevel: initialBatch.minReorderLevel
          }
        });
        const movement = stockMovementSchema.parse({
          movementType: 'OPENING_BALANCE',
          quantityDelta: initialBatch.qtyOnHand,
          resultingBalance: initialBatch.qtyOnHand,
          actorUserId: req.user.id,
          referenceType: 'FORMULARY_INITIAL_BATCH',
          referenceId: batch.id,
          reason: 'Initial inventory recorded during proactive medicine creation.'
        });
        await tx.stockMovement.create({ data: {
          ...movement, drugId: medicine.id, inventoryBatchId: batch.id
        } });
      }
      await tx.tenantAuditLog.create({ data: {
        userId: req.user.id,
        action: 'FORMULARY_MEDICINE_CREATED',
        details: JSON.stringify({
          medicineId: medicine.id,
          initialBatchId: batch?.id || null,
          initialQuantity: batch?.qtyOnHand || null
        }),
        ipAddress: req.ip || 'unknown'
      } });
      return { medicine, batch };
    });
    return res.status(201).json({ medicine: publicMedicine(result.medicine, result.batch ? [result.batch] : []) });
  } catch (error) {
    return handleMutationError(error, res, next);
  }
});

router.patch('/formulary/:id/metadata', authenticate, pharmacistOnly,
  validate(formularyIdParamsSchema, 'params'), validate(pharmacistMedicineMetadataSchema), async (req, res, next) => {
    try {
      const medicine = await prisma.$transaction(async (tx) => {
        await lockMedicine(tx, req.params.id);
        const current = await tx.drugFormulary.findUnique({
          where: { id: req.params.id },
          include: { _count: { select: { prescribedDrugs: true, inventoryBatches: true, stockMovements: true } } }
        });
        const changedFields = Object.keys(req.body).filter((field) => req.body[field] !== current[field]);
        if (changedFields.length === 0) return current;
        const used = current._count.prescribedDrugs > 0
          || current._count.inventoryBatches > 0
          || current._count.stockMovements > 0;
        if (used && changedFields.some((field) => identityFields.includes(field))) {
          throw apiFailure(409, 'FORMULARY_IDENTITY_IMMUTABLE', 'Identity-defining medicine metadata cannot be changed after clinical or inventory use.');
        }
        const nextMetadata = {
          brandName: req.body.brandName ?? current.brandName,
          genericName: req.body.genericName ?? current.genericName,
          strength: req.body.strength ?? current.strength,
          dosageForm: req.body.dosageForm ?? current.dosageForm
        };
        const updated = await tx.drugFormulary.update({
          where: { id: current.id },
          data: {
            ...req.body,
            ...(changedFields.some((field) => identityFields.includes(field)) && {
              identityKey: buildMedicineIdentityKey(nextMetadata)
            })
          }
        });
        await tx.tenantAuditLog.create({ data: {
          userId: req.user.id,
          action: 'FORMULARY_METADATA_UPDATED',
          details: JSON.stringify({ medicineId: current.id, changedFields }),
          ipAddress: req.ip || 'unknown'
        } });
        return updated;
      });
      const summaries = await loadStockSummaries([medicine.id]);
      return res.json({
        medicine: publicMedicine(medicine, summaries.get(medicine.id) || emptyStockSummary())
      });
    } catch (error) {
      return handleMutationError(error, res, next);
    }
  });

router.get('/formulary/:id/batches', authenticate, readRoles,
  validate(formularyIdParamsSchema, 'params'), validate(inventoryPageSchema, 'query'), async (req, res, next) => {
    try {
      const medicine = await prisma.drugFormulary.findUnique({ where: { id: req.params.id }, select: { id: true } });
      if (!medicine) return sendError(res, 404, 'FORMULARY_MEDICINE_NOT_FOUND', 'Medicine was not found.');
      const { page, pageSize } = req.query;
      const today = getClinicDateString();
      const usableCount = await prisma.inventoryBatch.count({ where: { drugId: medicine.id, expiryDate: { gte: today } } });
      const skip = (page - 1) * pageSize;
      const usableTake = Math.max(0, Math.min(pageSize, usableCount - skip));
      const usable = usableTake === 0 ? [] : await prisma.inventoryBatch.findMany({
        where: { drugId: medicine.id, expiryDate: { gte: today } },
        orderBy: [{ expiryDate: 'asc' }, { batchNumber: 'asc' }, { id: 'asc' }],
        skip,
        take: usableTake,
        select: { id: true, batchNumber: true, expiryDate: true, qtyOnHand: true, minReorderLevel: true, ledgerVersion: true }
      });
      const remaining = pageSize - usable.length;
      const expiredSkip = Math.max(0, skip - usableCount);
      const expired = remaining === 0 ? [] : await prisma.inventoryBatch.findMany({
        where: { drugId: medicine.id, expiryDate: { lt: today } },
        orderBy: [{ expiryDate: 'desc' }, { batchNumber: 'asc' }, { id: 'asc' }],
        skip: expiredSkip,
        take: remaining,
        select: { id: true, batchNumber: true, expiryDate: true, qtyOnHand: true, minReorderLevel: true, ledgerVersion: true }
      });
      const total = await prisma.inventoryBatch.count({ where: { drugId: medicine.id } });
      return res.json({
        items: [...usable, ...expired].map((batch) => ({ ...batch, state: batchOperationalState(batch, today) })),
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
      });
    } catch (error) {
      return next(error);
    }
  });

router.post('/formulary/:id/batches', authenticate, pharmacistOnly,
  validate(formularyIdParamsSchema, 'params'), validate(inventoryReceiptSchema), async (req, res, next) => {
    try {
      if (req.body.expiryDate <= getClinicDateString()) {
        return sendError(res, 422, 'INVENTORY_EXPIRY_INVALID', 'Inventory expiry must be after the current clinic date.');
      }
      const batch = await prisma.$transaction(async (tx) => {
        await lockMedicine(tx, req.params.id);
        const created = await tx.inventoryBatch.create({ data: {
          drugId: req.params.id,
          batchNumber: req.body.batchNumber,
          normalizedBatchNumber: normalizeBatchNumber(req.body.batchNumber),
          expiryDate: req.body.expiryDate,
          qtyOnHand: req.body.receivedQuantity,
          minReorderLevel: req.body.minReorderLevel
        } });
        const movement = stockMovementSchema.parse({
          movementType: 'RECEIPT',
          quantityDelta: req.body.receivedQuantity,
          resultingBalance: req.body.receivedQuantity,
          actorUserId: req.user.id,
          referenceType: 'INVENTORY_BATCH_RECEIPT',
          referenceId: created.id,
          reason: 'New inventory batch received.'
        });
        await tx.stockMovement.create({ data: {
          ...movement, drugId: req.params.id, inventoryBatchId: created.id
        } });
        await tx.tenantAuditLog.create({ data: {
          userId: req.user.id,
          action: 'INVENTORY_BATCH_RECEIVED',
          details: JSON.stringify({
            medicineId: req.params.id,
            batchId: created.id,
            receivedQuantity: req.body.receivedQuantity
          }),
          ipAddress: req.ip || 'unknown'
        } });
        return created;
      });
      return res.status(201).json({ batch: {
        id: batch.id,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        qtyOnHand: batch.qtyOnHand,
        minReorderLevel: batch.minReorderLevel,
        ledgerVersion: batch.ledgerVersion,
        state: batchOperationalState(batch, getClinicDateString())
      } });
    } catch (error) {
      return handleMutationError(error, res, next);
    }
  });

router.get('/formulary/:id/movements', authenticate, readRoles,
  validate(formularyIdParamsSchema, 'params'), validate(inventoryPageSchema, 'query'), async (req, res, next) => {
    try {
      const medicine = await prisma.drugFormulary.findUnique({ where: { id: req.params.id }, select: { id: true } });
      if (!medicine) return sendError(res, 404, 'FORMULARY_MEDICINE_NOT_FOUND', 'Medicine was not found.');
      const { page, pageSize } = req.query;
      const [total, movements] = await Promise.all([
        prisma.stockMovement.count({ where: { drugId: medicine.id } }),
        prisma.stockMovement.findMany({
          where: { drugId: medicine.id },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true, movementType: true, quantityDelta: true, resultingBalance: true,
            referenceType: true, referenceId: true, createdAt: true,
            inventoryBatch: { select: { id: true, batchNumber: true } },
            actor: { select: { id: true, username: true, role: true } }
          }
        })
      ]);
      return res.json({ items: movements.map((movement) => ({
        id: movement.id,
        movementType: movement.movementType,
        batch: movement.inventoryBatch,
        quantityDelta: movement.quantityDelta,
        resultingBalance: movement.resultingBalance,
        referenceType: movement.referenceType,
        referenceId: movement.referenceId,
        actor: movement.actor,
        createdAt: movement.createdAt
      })), pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
    } catch (error) {
      return next(error);
    }
  });

router.get('/prescriptions/:id/payment-state', authenticate, readRoles,
  validate(prescriptionIdParamsSchema, 'params'), async (req, res, next) => {
    try {
      const prescription = await prisma.prescription.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          status: true,
          invoices: {
            where: {
              invoiceType: 'PHARMACY',
              paymentStatus: { not: 'REFUNDED' }
            },
            orderBy: { invoiceDate: 'desc' },
            take: 1,
            select: {
              id: true,
              totalAmountSdg: true,
              paymentStatus: true
            }
          }
        }
      });
      if (!prescription) {
        return sendError(res, 404, 'PRESCRIPTION_NOT_FOUND', 'Prescription was not found.');
      }
      if (prescription.status === 'CANCELLED') {
        return sendError(res, 409, 'PHARMACY_PRESCRIPTION_INVALID_STATE', 'Cancelled prescriptions do not have an actionable pharmacy payment state.');
      }
      const invoice = prescription.invoices[0];
      if (!invoice) {
        return res.json({
          prescriptionId: prescription.id,
          invoice: null,
          dispensingAllowed: false,
          allowedPaymentMethods: paymentMethods
        });
      }
      const totalAmountSdg = Number(invoice.totalAmountSdg);
      const paymentAggregate = await prisma.payment.aggregate({
        where: { invoiceId: invoice.id },
        _sum: { amountSdg: true }
      });
      const paidAmountSdg = Number(paymentAggregate._sum.amountSdg || 0);
      return res.json({
        prescriptionId: prescription.id,
        invoice: {
          id: invoice.id,
          totalAmountSdg,
          paidAmountSdg,
          outstandingAmountSdg: Math.max(0, totalAmountSdg - paidAmountSdg),
          paymentStatus: invoice.paymentStatus
        },
        dispensingAllowed: invoice.paymentStatus === 'PAID',
        allowedPaymentMethods: paymentMethods
      });
    } catch (error) {
      return next(error);
    }
  });

export default router;
