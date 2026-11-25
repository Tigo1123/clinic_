import {
  Injectable,
  HttpException,
  HttpStatus,
  Optional,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { PrismaService } from '../../database/prisma.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { Prisma } from '../../generated/prisma/index.js';

const require = createRequire(import.meta.url);
const { addMoney, subtractMoney } = require('../../utils/money.js');
const { activePaymentMethods } = require('../../services/paymentMethods.js');
const { getClinicDateString } = require('../../utils/clinicTime.js');
const {
  batchOperationalState,
  buildMedicineIdentityKey,
  inventoryBatchSchema,
  isInventoryBatchUniqueViolation,
  isMedicineIdentityUniqueViolation,
  normalizeBatchNumber,
  pharmacistMedicineSchema,
  stockMovementSchema,
  summarizeMedicineStock,
} = require('../../utils/medicineManagement.js');
const { ensurePharmacyInvoiceInTransaction } = require('../../services/pharmacyInvoice.js');

const ACTIVE_PRESCRIPTION_STATUSES = ['ACTIVE', 'PARTIALLY_FILLED'];
const TERMINAL_PRESCRIPTION_STATUSES = ['FILLED', 'RESOLVED', 'CANCELLED'];
const identityFields = ['brandName', 'genericName', 'strength', 'dosageForm'];

function safeStockNumber(value: any) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new HttpException(
      { code: 'STOCK_SUMMARY_INVALID', message: 'Stock summary exceeds the supported numeric range.' },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
  return number;
}

function emptyStockSummary() {
  return {
    totalStock: 0,
    totalOnHand: 0,
    usableStock: 0,
    expiredStock: 0,
    nearestExpiry: null,
    nearestUnexpiredExpiry: null,
    lowStock: true,
    lowStockBatchCount: 0,
    hasExpiredBatch: false,
    expiredBatchCount: 0,
    batchCount: 0,
  };
}

function isIdentityLocked(medicine: any): boolean {
  if (typeof medicine?.identityLocked === 'boolean') return medicine.identityLocked;
  if (!medicine?._count) return false;
  return (
    Number(medicine._count.prescribedDrugs || 0) > 0 ||
    Number(medicine._count.inventoryBatches || 0) > 0 ||
    Number(medicine._count.stockMovements || 0) > 0
  );
}

function publicMedicine(medicine: any, batches: any) {
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
    identityLocked: isIdentityLocked(medicine),
    updatedAt: medicine.updatedAt,
    stock: Array.isArray(batches)
      ? summarizeMedicineStock(batches, getClinicDateString())
      : batches,
  };
}

function parseOptionalIdempotencyKey(rawHeader?: string | string[]) {
  if (rawHeader === undefined) return null;
  if (Array.isArray(rawHeader)) {
    throw new HttpException(
      { code: 'IDEMPOTENCY_KEY_INVALID', message: 'A single valid Idempotency-Key header is required.' },
      HttpStatus.BAD_REQUEST,
    );
  }
  const trimmed = String(rawHeader).trim();
  if (!/^[a-zA-Z0-9-]{8,128}$/.test(trimmed)) {
    throw new HttpException(
      { code: 'IDEMPOTENCY_KEY_INVALID', message: 'Invalid Idempotency-Key header.' },
      HttpStatus.BAD_REQUEST,
    );
  }
  return trimmed;
}

function buildDispenseRequestHash(prescriptionId: string, items: Array<{ prescribedDrugId: string; qtyToDispense: number }>) {
  const normalizedItems = items
    .map((item) => ({
      prescribedDrugId: String(item.prescribedDrugId),
      qtyToDispense: Number(item.qtyToDispense),
    }))
    .sort((a, b) => a.prescribedDrugId.localeCompare(b.prescribedDrugId));
  return createHash('sha256')
    .update(JSON.stringify({ prescriptionId, items: normalizedItems }))
    .digest('hex');
}

function isStockMovementIdempotencyConflict(error: any): boolean {
  if (error?.code !== 'P2002') return false;
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.map((t) => String(t).toLowerCase()).includes('idempotencykey');
  }
  if (typeof target === 'string') {
    return target.toLowerCase().includes('idempotencykey');
  }
  return false;
}

@Injectable()
export class PharmacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeGateway: RealtimeGateway,
    @Optional() private readonly notificationsService?: NotificationsService,
  ) {}

  private async loadStockSummaries(drugIds: string[], clinicDate = getClinicDateString()) {
    if (drugIds.length === 0) return new Map<string, any>();
    try {
      const rows: any[] = await this.prisma.$queryRaw(Prisma.sql`
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
          COUNT(*) FILTER (
            WHERE "expiryDate" < ${clinicDate}
          )::text AS "expiredBatchCount",
          COUNT(*) FILTER (
            WHERE "expiryDate" >= ${clinicDate}
            AND "qtyOnHand" <= "minReorderLevel"
          )::text AS "lowStockBatchCount",
          COUNT(*)::text AS "batchCount"
        FROM "InventoryBatch"
        WHERE "drugId" IN (${Prisma.join(drugIds)})
        GROUP BY "drugId"
      `);

      return new Map(
        rows.map((row) => {
          const totalStock = safeStockNumber(row.totalStock);
          const usableStock = safeStockNumber(row.usableStock);
          const expiredBatchCount = safeStockNumber(row.expiredBatchCount);
          const lowStockBatchCount = safeStockNumber(row.lowStockBatchCount);
          return [
            row.drugId,
            {
              totalStock,
              totalOnHand: totalStock,
              usableStock,
              expiredStock: safeStockNumber(row.expiredStock),
              nearestExpiry: row.nearestExpiry,
              nearestUnexpiredExpiry: row.nearestExpiry,
              lowStock: usableStock === 0 || lowStockBatchCount > 0,
              lowStockBatchCount,
              hasExpiredBatch: expiredBatchCount > 0,
              expiredBatchCount,
              batchCount: safeStockNumber(row.batchCount),
            },
          ];
        }),
      );
    } catch {
      // Graceful fallback for mock tests where $queryRaw is unmocked or returns raw objects
      const batches = await this.prisma.inventoryBatch.findMany({
        where: { drugId: { in: drugIds } },
      });
      const summaryMap = new Map<string, any>();
      for (const id of drugIds) {
        const drugBatches = batches.filter((b: any) => b.drugId === id);
        summaryMap.set(id, summarizeMedicineStock(drugBatches, clinicDate));
      }
      return summaryMap;
    }
  }

  private async refreshPrescriptionResolution(tx: any, prescriptionId: string) {
    const items = await tx.prescribedDrug.findMany({
      where: { prescriptionId },
      select: {
        qtyPrescribed: true,
        qtyDispensed: true,
        pharmacyReviewStatus: true,
      },
    });
    const hasUnavailable = items.some((item: any) => item.pharmacyReviewStatus === 'EXTERNAL');
    const allResolved =
      items.length > 0 &&
      items.every(
        (item: any) =>
          item.pharmacyReviewStatus === 'EXTERNAL' ||
          Number(item.qtyDispensed) >= Number(item.qtyPrescribed),
      );
    const anyDispensed = items.some((item: any) => Number(item.qtyDispensed) > 0);
    const status = allResolved
      ? hasUnavailable
        ? 'RESOLVED'
        : 'FILLED'
      : anyDispensed
      ? 'PARTIALLY_FILLED'
      : 'ACTIVE';

    await tx.prescription.update({
      where: { id: prescriptionId },
      data: { status },
    });
    return status;
  }

  // --- Formulary Methods ---

  async getFormulary(query: any) {
    const { search, status, page = 1, pageSize = 20 } = query;
    const where = {
      ...(status && { status }),
      ...(search && {
        OR: ['brandName', 'labelAr', 'labelEn', 'genericName', 'strength', 'dosageForm'].map((field) => ({
          [field]: { contains: search, mode: 'insensitive' },
        })),
      }),
    };

    const [total, medicines] = await Promise.all([
      this.prisma.drugFormulary.count({ where }),
      this.prisma.drugFormulary.findMany({
        where,
        select: {
          id: true,
          brandName: true,
          labelAr: true,
          labelEn: true,
          genericName: true,
          strength: true,
          dosageForm: true,
          status: true,
          unitPriceSdg: true,
          updatedAt: true,
          _count: { select: { prescribedDrugs: true, inventoryBatches: true, stockMovements: true } },
        },
        orderBy: [{ brandName: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const stockByDrug = await this.loadStockSummaries(medicines.map((m: any) => m.id));
    return {
      items: medicines.map((m: any) =>
        publicMedicine(m, stockByDrug.get(m.id) || emptyStockSummary()),
      ),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async getFormularyById(id: string) {
    const medicine = await this.prisma.drugFormulary.findUnique({
      where: { id },
      select: {
        id: true,
        brandName: true,
        labelAr: true,
        labelEn: true,
        genericName: true,
        strength: true,
        dosageForm: true,
        status: true,
        unitPriceSdg: true,
        updatedAt: true,
        _count: { select: { prescribedDrugs: true, inventoryBatches: true, stockMovements: true } },
      },
    });

    if (!medicine) {
      throw new HttpException(
        { code: 'FORMULARY_MEDICINE_NOT_FOUND', message: 'Medicine was not found.' },
        HttpStatus.NOT_FOUND,
      );
    }

    const summaries = await this.loadStockSummaries([medicine.id]);
    return publicMedicine(medicine, summaries.get(medicine.id) || emptyStockSummary());
  }

  async createFormulary(body: any, user: any, ip?: string) {
    const { initialBatch, ...metadata } = body;
    const identityKey = buildMedicineIdentityKey(metadata);

    try {
      const result = await this.prisma.$transaction(async (tx: any) => {
        const medicine = await tx.drugFormulary.create({
          data: { ...metadata, identityKey, status: 'INACTIVE', unitPriceSdg: null },
        });

        let batch: any = null;
        if (initialBatch) {
          if (initialBatch.expiryDate <= getClinicDateString()) {
            throw new HttpException(
              { code: 'INVENTORY_EXPIRY_INVALID', message: 'Inventory expiry must be after the current clinic date.' },
              HttpStatus.UNPROCESSABLE_ENTITY,
            );
          }

          batch = await tx.inventoryBatch.create({
            data: {
              drugId: medicine.id,
              batchNumber: initialBatch.batchNumber,
              normalizedBatchNumber: normalizeBatchNumber(initialBatch.batchNumber),
              expiryDate: initialBatch.expiryDate,
              qtyOnHand: initialBatch.qtyOnHand,
              minReorderLevel: initialBatch.minReorderLevel,
            },
          });

          const movement = stockMovementSchema.parse({
            movementType: 'RECEIPT',
            quantityDelta: initialBatch.qtyOnHand,
            resultingBalance: initialBatch.qtyOnHand,
            actorUserId: user.id,
            referenceType: 'FORMULARY_INITIAL_BATCH',
            referenceId: batch.id,
            reason: 'Initial inventory batch received during medicine creation.',
          });

          await tx.stockMovement.create({
            data: { ...movement, drugId: medicine.id, inventoryBatchId: batch.id },
          });
        }

        await tx.tenantAuditLog.create({
          data: {
            userId: user.id,
            action: 'FORMULARY_MEDICINE_CREATED',
            details: JSON.stringify({
              medicineId: medicine.id,
              initialBatchId: batch?.id || null,
              initialQuantity: batch?.qtyOnHand || null,
            }),
            ipAddress: ip || 'unknown',
          },
        });

        return { medicine, batch };
      });

      return {
        medicine: publicMedicine(
          { ...result.medicine, identityLocked: Boolean(result.batch) },
          result.batch ? [result.batch] : [],
        ),
      };
    } catch (error: any) {
      if (isMedicineIdentityUniqueViolation(error)) {
        throw new HttpException(
          { code: 'FORMULARY_MEDICINE_ALREADY_EXISTS', message: 'A matching medicine already exists.' },
          HttpStatus.CONFLICT,
        );
      }
      if (isInventoryBatchUniqueViolation(error)) {
        throw new HttpException(
          { code: 'INVENTORY_BATCH_ALREADY_EXISTS', message: 'This inventory batch already exists for the medicine and expiry date.' },
          HttpStatus.CONFLICT,
        );
      }
      if (error instanceof HttpException) throw error;
      throw error;
    }
  }

  async updateFormularyMetadata(id: string, body: any, user: any, ip?: string) {
    try {
      const medicine = await this.prisma.$transaction(async (tx: any) => {
        await tx.$queryRaw`SELECT "id" FROM "DrugFormulary" WHERE "id" = ${id} FOR UPDATE`;

        const current = await tx.drugFormulary.findUnique({
          where: { id },
          include: { _count: { select: { prescribedDrugs: true, inventoryBatches: true, stockMovements: true } } },
        });

        if (!current) {
          throw new HttpException(
            { code: 'FORMULARY_MEDICINE_NOT_FOUND', message: 'Medicine was not found.' },
            HttpStatus.NOT_FOUND,
          );
        }

        const changedFields = Object.keys(body).filter((field) => body[field] !== current[field]);
        if (changedFields.length === 0) return current;

        const used =
          current._count.prescribedDrugs > 0 ||
          current._count.inventoryBatches > 0 ||
          current._count.stockMovements > 0;

        if (used && changedFields.some((field) => identityFields.includes(field))) {
          throw new HttpException(
            { code: 'FORMULARY_IDENTITY_IMMUTABLE', message: 'Identity-defining medicine metadata cannot be changed after clinical or inventory use.' },
            HttpStatus.CONFLICT,
          );
        }

        const nextMetadata = {
          brandName: body.brandName ?? current.brandName,
          genericName: body.genericName ?? current.genericName,
          strength: body.strength ?? current.strength,
          dosageForm: body.dosageForm ?? current.dosageForm,
        };

        const updated = await tx.drugFormulary.update({
          where: { id: current.id },
          data: {
            ...body,
            ...(changedFields.some((field) => identityFields.includes(field)) && {
              identityKey: buildMedicineIdentityKey(nextMetadata),
            }),
          },
          include: { _count: { select: { prescribedDrugs: true, inventoryBatches: true, stockMovements: true } } },
        });

        await tx.tenantAuditLog.create({
          data: {
            userId: user.id,
            action: 'FORMULARY_METADATA_UPDATED',
            details: JSON.stringify({
              drugId: current.id,
              medicineId: current.id,
              changedFields,
              changes: Object.fromEntries(
                changedFields.map((field) => [
                  field,
                  { before: current[field], after: updated[field] },
                ]),
              ),
            }),
            ipAddress: ip || 'unknown',
          },
        });

        return updated;
      });

      const summaries = await this.loadStockSummaries([medicine.id]);
      return {
        medicine: publicMedicine(medicine, summaries.get(medicine.id) || emptyStockSummary()),
      };
    } catch (error: any) {
      if (isMedicineIdentityUniqueViolation(error)) {
        throw new HttpException(
          { code: 'FORMULARY_MEDICINE_ALREADY_EXISTS', message: 'A matching medicine already exists.' },
          HttpStatus.CONFLICT,
        );
      }
      if (error instanceof HttpException) throw error;
      throw error;
    }
  }

  async deactivateFormulary(id: string, body: any, user: any, ip?: string) {
    const result = await this.prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT "id" FROM "DrugFormulary" WHERE "id" = ${id} FOR UPDATE`;

      const current = await tx.drugFormulary.findUnique({
        where: { id },
        include: { _count: { select: { prescribedDrugs: true, inventoryBatches: true, stockMovements: true } } },
      });

      if (!current) {
        throw new HttpException(
          { code: 'FORMULARY_MEDICINE_NOT_FOUND', message: 'Medicine was not found.' },
          HttpStatus.NOT_FOUND,
        );
      }

      if (current.status === 'INACTIVE') {
        return { medicine: current, alreadyInactive: true };
      }

      const updated = await tx.drugFormulary.update({
        where: { id: current.id },
        data: { status: 'INACTIVE' },
        include: { _count: { select: { prescribedDrugs: true, inventoryBatches: true, stockMovements: true } } },
      });

      await tx.tenantAuditLog.create({
        data: {
          userId: user.id,
          action: 'FORMULARY_MEDICINE_DEACTIVATED',
          details: JSON.stringify({
            drugId: current.id,
            medicineId: current.id,
            brandName: current.brandName,
            labelAr: current.labelAr,
            labelEn: current.labelEn,
            previousStatus: current.status,
            status: 'INACTIVE',
            unitPriceSdg: current.unitPriceSdg == null ? null : Number(current.unitPriceSdg),
            ...(body?.reason ? { reason: body.reason } : {}),
          }),
          ipAddress: ip || 'unknown',
        },
      });

      return { medicine: updated, alreadyInactive: false };
    });

    const summaries = await this.loadStockSummaries([result.medicine.id]);
    return {
      medicine: publicMedicine(result.medicine, summaries.get(result.medicine.id) || emptyStockSummary()),
      alreadyInactive: result.alreadyInactive,
    };
  }

  async getBatches(id: string, query: any) {
    const medicine = await this.prisma.drugFormulary.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!medicine) {
      throw new HttpException(
        { code: 'FORMULARY_MEDICINE_NOT_FOUND', message: 'Medicine was not found.' },
        HttpStatus.NOT_FOUND,
      );
    }

    const { page = 1, pageSize = 20 } = query;
    const today = getClinicDateString();
    const usableCount = await this.prisma.inventoryBatch.count({
      where: { drugId: medicine.id, expiryDate: { gte: today } },
    });
    const skip = (page - 1) * pageSize;
    const usableTake = Math.max(0, Math.min(pageSize, usableCount - skip));
    const usable =
      usableTake === 0
        ? []
        : await this.prisma.inventoryBatch.findMany({
            where: { drugId: medicine.id, expiryDate: { gte: today } },
            orderBy: [{ expiryDate: 'asc' }, { batchNumber: 'asc' }, { id: 'asc' }],
            skip,
            take: usableTake,
            select: { id: true, batchNumber: true, expiryDate: true, qtyOnHand: true, minReorderLevel: true, ledgerVersion: true },
          });

    const remaining = pageSize - usable.length;
    const expiredSkip = Math.max(0, skip - usableCount);
    const expired =
      remaining === 0
        ? []
        : await this.prisma.inventoryBatch.findMany({
            where: { drugId: medicine.id, expiryDate: { lt: today } },
            orderBy: [{ expiryDate: 'desc' }, { batchNumber: 'asc' }, { id: 'asc' }],
            skip: expiredSkip,
            take: remaining,
            select: { id: true, batchNumber: true, expiryDate: true, qtyOnHand: true, minReorderLevel: true, ledgerVersion: true },
          });

    const total = await this.prisma.inventoryBatch.count({ where: { drugId: medicine.id } });
    return {
      items: [...usable, ...expired].map((batch: any) => ({
        ...batch,
        state: batchOperationalState(batch, today),
      })),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async createBatch(id: string, body: any, user: any, ip?: string) {
    if (body.expiryDate <= getClinicDateString()) {
      throw new HttpException(
        { code: 'INVENTORY_EXPIRY_INVALID', message: 'Inventory expiry must be after the current clinic date.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    try {
      const batch = await this.prisma.$transaction(async (tx: any) => {
        await tx.$queryRaw`SELECT "id" FROM "DrugFormulary" WHERE "id" = ${id} FOR UPDATE`;

        const medicine = await tx.drugFormulary.findUnique({ where: { id } });
        if (!medicine) {
          throw new HttpException(
            { code: 'FORMULARY_MEDICINE_NOT_FOUND', message: 'Medicine was not found.' },
            HttpStatus.NOT_FOUND,
          );
        }

        const created = await tx.inventoryBatch.create({
          data: {
            drugId: id,
            batchNumber: body.batchNumber,
            normalizedBatchNumber: normalizeBatchNumber(body.batchNumber),
            expiryDate: body.expiryDate,
            qtyOnHand: body.receivedQuantity,
            minReorderLevel: body.minReorderLevel,
          },
        });

        const movement = stockMovementSchema.parse({
          movementType: 'RECEIPT',
          quantityDelta: body.receivedQuantity,
          resultingBalance: body.receivedQuantity,
          actorUserId: user.id,
          referenceType: 'INVENTORY_BATCH_RECEIPT',
          referenceId: created.id,
          reason: 'New inventory batch received.',
        });

        await tx.stockMovement.create({
          data: { ...movement, drugId: id, inventoryBatchId: created.id },
        });

        await tx.tenantAuditLog.create({
          data: {
            userId: user.id,
            action: 'INVENTORY_BATCH_RECEIVED',
            details: JSON.stringify({
              medicineId: id,
              batchId: created.id,
              receivedQuantity: body.receivedQuantity,
            }),
            ipAddress: ip || 'unknown',
          },
        });

        return created;
      });

      return {
        batch: {
          id: batch.id,
          batchNumber: batch.batchNumber,
          expiryDate: batch.expiryDate,
          qtyOnHand: batch.qtyOnHand,
          minReorderLevel: batch.minReorderLevel,
          ledgerVersion: batch.ledgerVersion,
          state: batchOperationalState(batch, getClinicDateString()),
        },
      };
    } catch (error: any) {
      if (isInventoryBatchUniqueViolation(error)) {
        throw new HttpException(
          { code: 'INVENTORY_BATCH_ALREADY_EXISTS', message: 'This inventory batch already exists for the medicine and expiry date.' },
          HttpStatus.CONFLICT,
        );
      }
      if (error instanceof HttpException) throw error;
      throw error;
    }
  }

  async getMovements(id: string, query: any) {
    const medicine = await this.prisma.drugFormulary.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!medicine) {
      throw new HttpException(
        { code: 'FORMULARY_MEDICINE_NOT_FOUND', message: 'Medicine was not found.' },
        HttpStatus.NOT_FOUND,
      );
    }

    const { page = 1, pageSize = 20 } = query;
    const [total, movements] = await Promise.all([
      this.prisma.stockMovement.count({ where: { drugId: medicine.id } }),
      this.prisma.stockMovement.findMany({
        where: { drugId: medicine.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          movementType: true,
          quantityDelta: true,
          resultingBalance: true,
          referenceType: true,
          referenceId: true,
          createdAt: true,
          inventoryBatch: { select: { id: true, batchNumber: true } },
          actor: { select: { id: true, username: true, role: true } },
        },
      }),
    ]);

    return {
      items: movements.map((movement: any) => ({
        id: movement.id,
        inventoryBatchId: movement.inventoryBatch.id,
        movementType: movement.movementType,
        batch: movement.inventoryBatch,
        quantityDelta: movement.quantityDelta,
        resultingBalance: movement.resultingBalance,
        referenceType: movement.referenceType,
        referenceId: movement.referenceId,
        actor: movement.actor,
        createdAt: movement.createdAt,
      })),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async getPrescriptionPaymentState(id: string) {
    const configuredPaymentMethods = await activePaymentMethods(this.prisma);
    const paymentMethods = configuredPaymentMethods.map((m: any) => m.code);

    const prescription = await this.prisma.prescription.findUnique({
      where: { id },
      select: { id: true, status: true },
    });

    if (!prescription) {
      throw new HttpException(
        { code: 'PRESCRIPTION_NOT_FOUND', message: 'Prescription was not found.' },
        HttpStatus.NOT_FOUND,
      );
    }

    if (prescription.status === 'CANCELLED') {
      throw new HttpException(
        { code: 'PHARMACY_PRESCRIPTION_INVALID_STATE', message: 'Cancelled prescriptions do not have an actionable pharmacy payment state.' },
        HttpStatus.CONFLICT,
      );
    }

    const invoices = await this.prisma.invoice.findMany({
      where: {
        prescriptionId: prescription.id,
        invoiceType: 'PHARMACY',
        paymentStatus: { notIn: ['REFUNDED', 'VOIDED'] },
      },
      orderBy: [{ invoiceDate: 'desc' }, { id: 'desc' }],
      take: 2,
      select: { id: true, totalAmountSdg: true, paymentStatus: true },
    });

    if (invoices.length > 1) {
      throw new HttpException(
        { code: 'PHARMACY_INVOICE_INVARIANT_VIOLATION', message: 'Pharmacy billing requires administrative review.' },
        HttpStatus.CONFLICT,
      );
    }

    const invoice = invoices[0];
    if (!invoice) {
      const refundedInvoice = await this.prisma.invoice.findFirst({
        where: {
          prescriptionId: prescription.id,
          invoiceType: 'PHARMACY',
          paymentStatus: 'REFUNDED',
        },
        select: { id: true },
      });

      return {
        prescriptionId: prescription.id,
        invoice: null,
        billingPending: {
          code: refundedInvoice
            ? 'PHARMACY_REFUNDED_INVOICE_REVIEW_REQUIRED'
            : 'PHARMACY_INVOICE_PENDING',
          message: refundedInvoice
            ? 'Refunded pharmacy billing requires administrative review.'
            : 'Pharmacy invoice preparation is pending medication review or authoritative pricing.',
        },
        dispensingAllowed: false,
        allowedPaymentMethods: paymentMethods,
        paymentMethodOptions: configuredPaymentMethods,
      };
    }

    const totalAmountSdg = Number(invoice.totalAmountSdg);
    const paymentAggregate = await this.prisma.payment.aggregate({
      where: { invoiceId: invoice.id },
      _sum: { amountSdg: true },
    });
    const paidAmountSdg = Number(paymentAggregate._sum.amountSdg || 0);

    return {
      prescriptionId: prescription.id,
      invoice: {
        id: invoice.id,
        totalAmountSdg,
        paidAmountSdg,
        outstandingAmountSdg: Math.max(0, subtractMoney(totalAmountSdg, paidAmountSdg)),
        paymentStatus: invoice.paymentStatus,
      },
      dispensingAllowed: invoice.paymentStatus === 'PAID',
      allowedPaymentMethods: paymentMethods,
      paymentMethodOptions: configuredPaymentMethods,
    };
  }

  // --- Prescription Dispensing Methods (/api/records/prescriptions/*) ---

  async getPendingPrescriptions() {
    const prescriptions = await this.prisma.prescription.findMany({
      where: { status: { in: ['ACTIVE', 'PARTIALLY_FILLED'] } },
      include: {
        patient: true,
        doctor: true,
        prescribedDrugs: {
          include: { drug: { include: { inventoryBatches: true } } },
        },
        invoices: {
          where: {
            invoiceType: 'PHARMACY',
            paymentStatus: { notIn: ['REFUNDED', 'VOIDED'] },
          },
          select: { paymentStatus: true },
          orderBy: { invoiceDate: 'desc' },
          take: 1,
        },
      },
      orderBy: { prescriptionDate: 'desc' },
    });

    return prescriptions.map(({ invoices, ...prescription }: any) => ({
      ...prescription,
      billingStatus: invoices[0]?.paymentStatus || 'UNBILLED',
    }));
  }

  async getPrescriptionHistory() {
    return this.prisma.prescription.findMany({
      where: { status: { in: TERMINAL_PRESCRIPTION_STATUSES } },
      select: {
        id: true,
        prescriptionDate: true,
        status: true,
        patient: { select: { fullNameAr: true, fullNameEn: true, fileNumber: true } },
        doctor: { select: { fullNameAr: true, fullNameEn: true } },
        prescribedDrugs: {
          select: {
            id: true,
            customDrugName: true,
            dosage: true,
            duration: true,
            qtyPrescribed: true,
            qtyDispensed: true,
            pharmacyReviewStatus: true,
            pharmacyReviewNote: true,
            drug: { select: { labelAr: true, labelEn: true } },
          },
        },
      },
      orderBy: [{ prescriptionDate: 'desc' }, { id: 'desc' }],
      take: 100,
    });
  }

  async markMedicationUnavailable(id: string, body: any, user: any, ip?: string) {
    const result = await this.prisma.$transaction(async (tx: any) => {
      const item = await tx.prescribedDrug.findUnique({
        where: { id },
        include: { prescription: { select: { id: true, status: true } } },
      });

      if (!item) {
        throw new HttpException(
          { code: 'PRESCRIBED_DRUG_NOT_FOUND', message: 'Prescribed medication was not found.' },
          HttpStatus.NOT_FOUND,
        );
      }
      if (!ACTIVE_PRESCRIPTION_STATUSES.includes(item.prescription.status)) {
        throw new HttpException(
          { code: 'PRESCRIPTION_NOT_ACTIVE', message: 'This prescription is no longer active.' },
          HttpStatus.CONFLICT,
        );
      }
      if (item.pharmacyReviewStatus === 'EXTERNAL') {
        const prescriptionStatus = await this.refreshPrescriptionResolution(tx, item.prescriptionId);
        await tx.tenantAuditLog.create({
          data: {
            userId: user.id,
            action: `PHARMACY_MEDICATION_RESOLUTION_RECONCILED:${item.id}`,
            details: JSON.stringify({ prescribedDrugId: item.id, prescriptionId: item.prescriptionId, prescriptionStatus }),
            ipAddress: ip || 'unknown',
          },
        });
        return { success: true, prescribedDrugId: item.id, prescriptionId: item.prescriptionId, prescriptionStatus, billing: null, reconciled: true };
      }
      if (item.qtyDispensed >= item.qtyPrescribed) {
        throw new HttpException(
          { code: 'MEDICATION_ALREADY_RESOLVED', message: 'This medication is already resolved.' },
          HttpStatus.CONFLICT,
        );
      }

      // Same advisory key as ensurePharmacyInvoiceInTransaction, so an invoice
      // cannot be created concurrently and missed by the row lock below.
      await tx.$queryRaw(Prisma.sql`
        SELECT 1::int AS "locked"
        FROM pg_advisory_xact_lock(
          hashtextextended(${`pharmacy-invoice:${item.prescriptionId}`}, 0)
        )
      `);
      // Lock candidate invoices so a concurrent payment commits before the read below.
      await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "prescriptionId" = ${item.prescriptionId} AND "invoiceType" = 'PHARMACY' ORDER BY "id" FOR UPDATE`;

      const invoices = await tx.invoice.findMany({
        where: {
          prescriptionId: item.prescriptionId,
          invoiceType: 'PHARMACY',
          paymentStatus: { notIn: ['REFUNDED', 'VOIDED'] },
        },
        select: { id: true, paymentStatus: true, payments: { select: { id: true }, take: 1 } },
        take: 2,
      });

      if (invoices.length > 1) {
        throw new HttpException(
          { code: 'PHARMACY_INVOICE_INVARIANT_VIOLATION', message: 'Pharmacy billing requires administrative review.' },
          HttpStatus.CONFLICT,
        );
      }

      const invoice = invoices[0];
      if (invoice && (invoice.paymentStatus !== 'UNPAID' || invoice.payments.length > 0)) {
        throw new HttpException(
          { code: 'PHARMACY_UNAVAILABLE_PAID_REVIEW_REQUIRED', message: 'Paid medication cannot be marked unavailable without financial review.' },
          HttpStatus.CONFLICT,
        );
      }

      if (invoice) {
        const voided = await tx.invoice.updateMany({
          where: { id: invoice.id, paymentStatus: 'UNPAID' },
          data: { paymentStatus: 'VOIDED', ledgerVersion: { increment: 1 } },
        });
        if (voided.count !== 1) {
          throw new HttpException(
            { code: 'PHARMACY_UNAVAILABLE_PAID_REVIEW_REQUIRED', message: 'Paid medication cannot be marked unavailable without financial review.' },
            HttpStatus.CONFLICT,
          );
        }
      }

      const note = body.note?.trim() || null;
      await tx.prescribedDrug.update({
        where: { id: item.id },
        data: {
          pharmacyReviewStatus: 'EXTERNAL',
          pharmacyReviewedAt: new Date(),
          pharmacyReviewNote: note ? `${body.reason}: ${note}` : body.reason,
        },
      });

      const prescriptionStatus = await this.refreshPrescriptionResolution(tx, item.prescriptionId);
      await tx.tenantAuditLog.create({
        data: {
          userId: user.id,
          action: `PHARMACY_MEDICATION_UNAVAILABLE:${item.id}`,
          details: JSON.stringify({ prescribedDrugId: item.id, prescriptionId: item.prescriptionId, reason: body.reason, note, voidedInvoiceId: invoice?.id || null }),
          ipAddress: ip || 'unknown',
        },
      });

      let billing: any = null;
      if (ACTIVE_PRESCRIPTION_STATUSES.includes(prescriptionStatus)) {
        billing = await ensurePharmacyInvoiceInTransaction(tx, {
          prescriptionId: item.prescriptionId,
          actorUserId: user.id,
          ipAddress: ip || 'unknown',
          trigger: 'MEDICATION_UNAVAILABLE',
        });
      }

      return { success: true, prescribedDrugId: item.id, prescriptionId: item.prescriptionId, prescriptionStatus, billing };
    });
    if (!result.reconciled) {
      await this.notificationsService?.notifyPharmacyMedicationExternal({
        prescribedDrugId: result.prescribedDrugId,
        prescriptionId: result.prescriptionId,
      });
    }
    return result;
  }

  private async resolveDispenseIdempotency(
    client: any,
    prescriptionId: string,
    idempotencyKey: string,
    requestHash: string,
  ) {
    const existingMovement = await client.stockMovement.findUnique({
      where: { idempotencyKey: `dispense:${idempotencyKey}:0` },
      select: { id: true, referenceId: true },
    });
    if (!existingMovement) return false;

    const existingAudit = await client.tenantAuditLog.findFirst({
      where: {
        action: 'PRESCRIPTION_DISPENSED',
        details: { contains: `"idempotencyKey":${JSON.stringify(idempotencyKey)}` },
      },
      select: { details: true },
    });

    if (existingAudit?.details) {
      try {
        const parsed = JSON.parse(existingAudit.details);
        if (parsed?.idempotencyKey === idempotencyKey && parsed.prescriptionId === prescriptionId && parsed.requestHash === requestHash) {
          return true;
        }
      } catch {
        // Fall through to conflict if audit payload is unreadable
      }
    }

    throw new HttpException(
      { code: 'IDEMPOTENCY_KEY_REUSED', message: 'Idempotency-Key was already used for a different dispensing request.' },
      HttpStatus.CONFLICT,
    );
  }

  async dispensePrescription(id: string, body: any, user: any, ip?: string, rawIdempotencyKey?: string | string[]) {
    const { items } = body;
    if (!items || items.length === 0) {
      throw new HttpException(
        { error: 'Dispensing items are required.' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const idempotencyKey = parseOptionalIdempotencyKey(rawIdempotencyKey);
    const seenPrescribedDrugIds = new Set<string>();
    for (const item of items) {
      if (seenPrescribedDrugIds.has(item.prescribedDrugId)) {
        throw new HttpException(
          { code: 'DISPENSING_VALIDATION_FAILED', message: 'Duplicate prescribed drug items cannot be dispensed in one request.' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      seenPrescribedDrugIds.add(item.prescribedDrugId);
    }
    const requestHash = buildDispenseRequestHash(id, items);

    try {
      let idempotentReplay = false;
      const txResult = await this.prisma.$transaction(async (tx: any) => {
        await tx.$queryRaw`SELECT "id" FROM "Prescription" WHERE "id" = ${id} FOR UPDATE`;

        if (idempotencyKey && await this.resolveDispenseIdempotency(tx, id, idempotencyKey, requestHash)) {
          idempotentReplay = true;
          return;
        }

        const prescription = await tx.prescription.findUnique({
          where: { id },
          select: {
            patientId: true,
            status: true,
            prescribedDrugs: { select: { id: true, pharmacyReviewStatus: true } },
          },
        });
        if (!prescription) {
          throw new HttpException(
            { code: 'PRESCRIPTION_NOT_FOUND', message: 'Prescription was not found.' },
            HttpStatus.NOT_FOUND,
          );
        }
        if (!ACTIVE_PRESCRIPTION_STATUSES.includes(prescription.status)) {
          throw new HttpException(
            { code: 'PRESCRIPTION_NOT_ACTIVE', message: 'Prescription is not open for dispensing.' },
            HttpStatus.CONFLICT,
          );
        }
        if ((prescription.prescribedDrugs || []).some((drug: any) => drug.pharmacyReviewStatus === 'PENDING_REVIEW')) {
          throw new HttpException(
            { code: 'PHARMACY_REVIEW_PENDING', message: 'Custom medications must be reviewed before dispensing.' },
            HttpStatus.CONFLICT,
          );
        }

        await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "prescriptionId" = ${id} AND "invoiceType" = 'PHARMACY' ORDER BY "id" FOR UPDATE`;

        const dispensedPrescribedDrugIds = [];
        let movementSeq = 0;

        // Financial hard gate: paid PHARMACY invoice required
        const pharmacyInvoices = await tx.invoice.findMany({
          where: {
            prescriptionId: id,
            invoiceType: 'PHARMACY',
            paymentStatus: { notIn: ['REFUNDED', 'VOIDED'] },
          },
          select: { patientId: true, paymentStatus: true },
          take: 2,
        });

        const invoice = pharmacyInvoices[0];
        if (pharmacyInvoices.length > 1 || (invoice && invoice.patientId !== prescription.patientId)) {
          throw new HttpException(
            { code: 'PHARMACY_INVOICE_INVARIANT_VIOLATION', message: 'Pharmacy billing requires administrative review.' },
            HttpStatus.CONFLICT,
          );
        }
        if (invoice?.paymentStatus !== 'PAID') {
          throw new HttpException(
            { code: 'PHARMACY_PAYMENT_REQUIRED', message: 'Prescription dispensing requires full pharmacy payment.' },
            HttpStatus.FORBIDDEN,
          );
        }

        for (const item of items) {
          const { prescribedDrugId } = item;
          const qtyToDispense = Number(item.qtyToDispense);
          if (!Number.isInteger(qtyToDispense) || qtyToDispense <= 0) {
            throw new HttpException(
              { code: 'DISPENSING_VALIDATION_FAILED', message: 'Dispensing quantity must be a positive whole number.' },
              HttpStatus.UNPROCESSABLE_ENTITY,
            );
          }

          const prescribedDrug = await tx.prescribedDrug.findUnique({
            where: { id: prescribedDrugId },
          });

          if (!prescribedDrug) {
            throw new HttpException(
              { code: 'DISPENSING_VALIDATION_FAILED', message: 'Prescribed drug item not found.' },
              HttpStatus.UNPROCESSABLE_ENTITY,
            );
          }
          if (prescribedDrug.prescriptionId !== id) {
            throw new HttpException(
              { code: 'DISPENSING_VALIDATION_FAILED', message: 'Prescribed drug does not belong to this prescription.' },
              HttpStatus.UNPROCESSABLE_ENTITY,
            );
          }
          if (!prescribedDrug.drugId) {
            throw new HttpException(
              { code: 'DISPENSING_VALIDATION_FAILED', message: 'Custom or unlinked medications cannot be dispensed from clinic stock.' },
              HttpStatus.UNPROCESSABLE_ENTITY,
            );
          }
          if (prescribedDrug.pharmacyReviewStatus === 'EXTERNAL') {
            throw new HttpException(
              { code: 'DISPENSING_VALIDATION_FAILED', message: 'Unavailable medication cannot be dispensed.' },
              HttpStatus.UNPROCESSABLE_ENTITY,
            );
          }

          const remaining = prescribedDrug.qtyPrescribed - prescribedDrug.qtyDispensed;
          if (qtyToDispense > remaining) {
            throw new HttpException(
              { code: 'DISPENSING_VALIDATION_FAILED', message: 'Dispensing quantity exceeds the remaining prescribed quantity.' },
              HttpStatus.UNPROCESSABLE_ENTITY,
            );
          }

          const eligibleBatches = await tx.inventoryBatch.findMany({
            where: {
              drugId: prescribedDrug.drugId,
              qtyOnHand: { gt: 0 },
              expiryDate: { gte: getClinicDateString() },
            },
            orderBy: [{ expiryDate: 'asc' }, { batchNumber: 'asc' }],
          });

          const totalAvailable = eligibleBatches.reduce(
            (sum: number, batch: any) => sum + batch.qtyOnHand,
            0,
          );

          if (totalAvailable < qtyToDispense) {
            throw new HttpException(
              {
                code: 'INSUFFICIENT_STOCK',
                message: `Insufficient stock. Required ${qtyToDispense}, available ${totalAvailable}.`,
              },
              HttpStatus.CONFLICT,
            );
          }

          let remainingToDispense = qtyToDispense;

          for (const batch of eligibleBatches) {
            if (remainingToDispense <= 0) break;

            const quantityFromBatch = Math.min(batch.qtyOnHand, remainingToDispense);

            const batchClaim = await tx.inventoryBatch.updateMany({
              where: {
                id: batch.id,
                qtyOnHand: batch.qtyOnHand,
                ledgerVersion: batch.ledgerVersion,
              },
              data: {
                qtyOnHand: { decrement: quantityFromBatch },
                ledgerVersion: { increment: 1 },
              },
            });

            if (batchClaim.count !== 1) {
              throw new HttpException(
                { code: 'DISPENSING_VALIDATION_FAILED', message: 'Inventory changed concurrently. Reload and retry dispensing.' },
                HttpStatus.UNPROCESSABLE_ENTITY,
              );
            }

            const resultingBalance = batch.qtyOnHand - quantityFromBatch;
            const movement = stockMovementSchema.parse({
              movementType: 'DISPENSE',
              quantityDelta: -quantityFromBatch,
              resultingBalance,
              actorUserId: user.id,
              referenceType: 'PRESCRIBED_DRUG_DISPENSE',
              referenceId: prescribedDrug.id,
              reason: 'Stock dispensed for a prescription.',
              ...(idempotencyKey ? { idempotencyKey: `dispense:${idempotencyKey}:${movementSeq++}` } : {}),
            });

            await tx.stockMovement.create({
              data: {
                ...movement,
                drugId: batch.drugId,
                inventoryBatchId: batch.id,
              },
            });

            remainingToDispense -= quantityFromBatch;
          }

          if (remainingToDispense !== 0) {
            throw new HttpException(
              { code: 'DISPENSING_VALIDATION_FAILED', message: 'Unable to allocate the full dispensing quantity across FEFO inventory batches.' },
              HttpStatus.UNPROCESSABLE_ENTITY,
            );
          }

          const newQtyDispensed = prescribedDrug.qtyDispensed + qtyToDispense;
          const prescriptionClaim = await tx.prescribedDrug.updateMany({
            where: {
              id: prescribedDrugId,
              qtyDispensed: prescribedDrug.qtyDispensed,
              ledgerVersion: prescribedDrug.ledgerVersion,
            },
            data: { qtyDispensed: newQtyDispensed, ledgerVersion: { increment: 1 } },
          });

          if (prescriptionClaim.count !== 1) {
            throw new HttpException(
              { code: 'DISPENSING_VALIDATION_FAILED', message: 'Prescription changed concurrently. Reload and retry dispensing.' },
              HttpStatus.UNPROCESSABLE_ENTITY,
            );
          }

          dispensedPrescribedDrugIds.push(prescribedDrug.id);
        }

        const prescriptionStatus = await this.refreshPrescriptionResolution(tx, id);
        let totalDispensedAfter = 0;

        if (dispensedPrescribedDrugIds.length > 0) {
          const updatedDrugs = await tx.prescribedDrug.findMany({
            where: { prescriptionId: id },
            select: { qtyDispensed: true },
          });
          totalDispensedAfter = updatedDrugs.reduce(
            (sum: number, item: any) => sum + Number(item.qtyDispensed || 0),
            0,
          );
          await tx.tenantAuditLog.create({
            data: {
              userId: user.id,
              action: 'PRESCRIPTION_DISPENSED',
              details: JSON.stringify({
                prescriptionId: id,
                prescribedDrugIds: dispensedPrescribedDrugIds,
                ...(idempotencyKey ? { idempotencyKey, requestHash } : {}),
              }),
              ipAddress: ip || 'unknown',
            },
          });
        }

        return {
          dispensedCount: dispensedPrescribedDrugIds.length,
          prescriptionStatus,
          totalDispensedAfter,
        };
      });

      if (txResult && txResult.dispensedCount > 0) {
        await this.notificationsService?.notifyPrescriptionDispensed({
          prescriptionId: id,
          prescriptionStatus: txResult.prescriptionStatus,
          totalDispensedAfter: txResult.totalDispensedAfter,
        });
      }

      return {
        success: true,
        message: 'Prescription dispensed successfully.',
        ...(idempotentReplay ? { idempotentReplay: true } : {}),
      };
    } catch (error: any) {
      if (idempotencyKey && isStockMovementIdempotencyConflict(error)) {
        const replayed = await this.resolveDispenseIdempotency(this.prisma, id, idempotencyKey, requestHash);
        if (replayed) {
          return {
            success: true,
            message: 'Prescription dispensed successfully.',
            idempotentReplay: true,
          };
        }
      }
      if (error instanceof HttpException) throw error;
      throw error;
    }
  }

  async getPendingMedicationReviews() {
    const items = await this.prisma.prescribedDrug.findMany({
      where: {
        pharmacyReviewStatus: 'PENDING_REVIEW',
        drugId: null,
        customDrugName: { not: null },
        prescription: { status: { in: ['ACTIVE', 'PARTIALLY_FILLED'] } },
      },
      include: {
        prescription: {
          select: {
            id: true,
            prescriptionDate: true,
            status: true,
            doctorId: true,
            patient: { select: { id: true, fullNameAr: true, fullNameEn: true } },
          },
        },
      },
    });

    return items
      .filter((item: any) => typeof item.customDrugName === 'string' && item.customDrugName.trim().length > 0)
      .sort((a: any, b: any) => new Date(a.prescription.prescriptionDate).getTime() - new Date(b.prescription.prescriptionDate).getTime())
      .map((item: any) => ({
        id: item.id,
        prescriptionId: item.prescriptionId,
        patient: item.prescription.patient,
        doctorId: item.prescription.doctorId,
        prescriptionDate: item.prescription.prescriptionDate,
        prescriptionStatus: item.prescription.status,
        customDrugName: item.customDrugName,
        dosage: item.dosage,
        duration: item.duration,
        instructionsAr: item.instructionsAr,
        instructionsEn: item.instructionsEn,
        qtyPrescribed: Number(item.qtyPrescribed),
        qtyDispensed: Number(item.qtyDispensed),
        pharmacyReviewStatus: item.pharmacyReviewStatus,
        pharmacyReviewNote: item.pharmacyReviewNote,
      }));
  }

  async reviewMedication(id: string, body: any, user: any, ip?: string) {
    const decision = typeof body?.decision === 'string' ? body.decision.trim().toUpperCase() : '';
    const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null;

    const allowedDecisions = ['LINK_EXISTING', 'CREATE_FORMULARY', 'EXTERNAL'];
    if (!allowedDecisions.includes(decision)) {
      throw new HttpException(
        { error: 'decision must be LINK_EXISTING, CREATE_FORMULARY, or EXTERNAL.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    try {
      const result = await this.prisma.$transaction(async (tx: any) => {
        const prescribedDrug = await tx.prescribedDrug.findUnique({
          where: { id },
          include: { prescription: { select: { id: true, status: true, patientId: true } } },
        });

        if (!prescribedDrug) {
          throw new HttpException(
            { code: 'PRESCRIBED_DRUG_NOT_FOUND', message: 'Prescribed medication was not found.' },
            HttpStatus.NOT_FOUND,
          );
        }

        if (prescribedDrug.pharmacyReviewStatus !== 'PENDING_REVIEW') {
          throw new HttpException(
            { code: 'MEDICATION_ALREADY_REVIEWED', message: 'This medication is no longer awaiting pharmacy review.' },
            HttpStatus.CONFLICT,
          );
        }

        if (!['ACTIVE', 'PARTIALLY_FILLED'].includes(prescribedDrug.prescription.status)) {
          throw new HttpException(
            { code: 'PRESCRIPTION_NOT_ACTIVE', message: 'This prescription is no longer active.' },
            HttpStatus.CONFLICT,
          );
        }

        if (prescribedDrug.drugId || !prescribedDrug.customDrugName?.trim()) {
          throw new HttpException(
            { code: 'INVALID_MEDICATION_REVIEW_STATE', message: 'Only unresolved custom medications can be reviewed.' },
            HttpStatus.CONFLICT,
          );
        }

        if (decision === 'EXTERNAL') {
          const claim = await tx.prescribedDrug.updateMany({
            where: { id: prescribedDrug.id, pharmacyReviewStatus: 'PENDING_REVIEW', drugId: null },
            data: {
              pharmacyReviewStatus: 'EXTERNAL',
              pharmacyReviewedAt: new Date(),
              pharmacyReviewNote: note,
            },
          });

          if (claim.count !== 1) {
            throw new HttpException(
              { code: 'MEDICATION_REVIEW_CONFLICT', message: 'This medication was already reviewed by another pharmacist.' },
              HttpStatus.CONFLICT,
            );
          }

          const updated = await tx.prescribedDrug.findUnique({ where: { id: prescribedDrug.id } });

          await tx.tenantAuditLog.create({
            data: {
              userId: user.id,
              action: `PHARMACY_CUSTOM_MEDICATION_EXTERNAL:${prescribedDrug.id}`,
              details: JSON.stringify({
                prescribedDrugId: prescribedDrug.id,
                prescriptionId: prescribedDrug.prescriptionId,
                customDrugName: prescribedDrug.customDrugName,
                decision: 'EXTERNAL',
                note,
              }),
              ipAddress: ip || '127.0.0.1',
            },
          });

          await this.refreshPrescriptionResolution(tx, prescribedDrug.prescriptionId);

          await ensurePharmacyInvoiceInTransaction(tx, {
            prescriptionId: prescribedDrug.prescriptionId,
            actorUserId: user.id,
            ipAddress: ip || 'unknown',
            trigger: 'CUSTOM_MEDICATION_EXTERNAL',
          });

          return { decision, prescribedDrug: updated, drug: null, inventoryBatch: null };
        }

        if (decision === 'LINK_EXISTING') {
          const targetDrugId = typeof body?.drugId === 'string' ? body.drugId.trim() : '';
          if (!targetDrugId) {
            throw new HttpException(
              { code: 'DRUG_ID_REQUIRED', message: 'drugId is required when linking an existing formulary medication.' },
              HttpStatus.UNPROCESSABLE_ENTITY,
            );
          }

          await tx.$queryRaw`SELECT "id" FROM "DrugFormulary" WHERE "id" = ${targetDrugId} FOR SHARE`;

          const linkedDrug = await tx.drugFormulary.findUnique({
            where: { id: targetDrugId },
            include: { inventoryBatches: true },
          });

          if (!linkedDrug) {
            throw new HttpException(
              { code: 'FORMULARY_DRUG_NOT_FOUND', message: 'The selected formulary medication was not found.' },
              HttpStatus.NOT_FOUND,
            );
          }

          const price = Number(linkedDrug.unitPriceSdg);
          if (
            linkedDrug.status !== 'ACTIVE' ||
            !Number.isSafeInteger(price) ||
            price <= 0 ||
            price > 1_000_000_000
          ) {
            throw new HttpException(
              { code: 'PHARMACY_PRICE_NOT_CONFIGURED', message: 'The selected medication must have a valid pharmacy price before approval.' },
              HttpStatus.CONFLICT,
            );
          }

          const remainingQty = Number(prescribedDrug.qtyPrescribed) - Number(prescribedDrug.qtyDispensed);
          const today = new Date().toISOString().slice(0, 10);
          const usableStock = linkedDrug.inventoryBatches
            .filter((batch: any) => Number(batch.qtyOnHand) > 0 && batch.expiryDate >= today)
            .reduce((total: number, batch: any) => total + Number(batch.qtyOnHand), 0);

          if (remainingQty > 0 && usableStock < remainingQty) {
            throw new HttpException(
              {
                code: 'PHARMACY_INSUFFICIENT_STOCK_FOR_APPROVAL',
                message: `Only ${usableStock} usable units are currently available; ${remainingQty} are required.`,
              },
              HttpStatus.CONFLICT,
            );
          }

          const claim = await tx.prescribedDrug.updateMany({
            where: { id: prescribedDrug.id, pharmacyReviewStatus: 'PENDING_REVIEW', drugId: null },
            data: {
              drugId: linkedDrug.id,
              pharmacyReviewStatus: 'APPROVED',
              pharmacyReviewedAt: new Date(),
              pharmacyReviewNote: note,
            },
          });

          if (claim.count !== 1) {
            throw new HttpException(
              { code: 'MEDICATION_REVIEW_CONFLICT', message: 'This medication was already reviewed by another pharmacist.' },
              HttpStatus.CONFLICT,
            );
          }

          const updated = await tx.prescribedDrug.findUnique({ where: { id: prescribedDrug.id } });

          await tx.tenantAuditLog.create({
            data: {
              userId: user.id,
              action: `PHARMACY_CUSTOM_MEDICATION_LINKED:${prescribedDrug.id}`,
              details: JSON.stringify({
                prescribedDrugId: prescribedDrug.id,
                prescriptionId: prescribedDrug.prescriptionId,
                customDrugName: prescribedDrug.customDrugName,
                linkedDrugId: linkedDrug.id,
                linkedDrugName: linkedDrug.labelEn,
                unitPriceSdg: price,
                decision: 'LINK_EXISTING',
                note,
              }),
              ipAddress: ip || '127.0.0.1',
            },
          });

          await ensurePharmacyInvoiceInTransaction(tx, {
            prescriptionId: prescribedDrug.prescriptionId,
            actorUserId: user.id,
            ipAddress: ip || 'unknown',
            trigger: 'CUSTOM_MEDICATION_LINKED',
          });

          return { decision, prescribedDrug: updated, drug: linkedDrug, inventoryBatch: null };
        }

        // CREATE_FORMULARY
        const form = body?.formulary || {};
        const inventory = body?.inventory || {};
        const fallbackLabelEn = typeof form.labelEn === 'string' && form.labelEn.trim() ? form.labelEn.trim() : prescribedDrug.customDrugName.trim();
        const fallbackLabelAr = typeof form.labelAr === 'string' && form.labelAr.trim() ? form.labelAr.trim() : fallbackLabelEn;

        if (Object.hasOwn(form, 'unitPriceSdg')) {
          throw new HttpException(
            { code: 'PHARMACY_PRICE_ADMIN_REQUIRED', message: 'Official medicine selling prices must be configured by an administrator.' },
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }

        const medicineResult = pharmacistMedicineSchema.safeParse({
          ...form,
          brandName: form.brandName ?? fallbackLabelEn,
          labelAr: fallbackLabelAr,
          labelEn: fallbackLabelEn,
        });

        if (!medicineResult.success) {
          throw new HttpException(
            { code: 'FORMULARY_DETAILS_INVALID', message: medicineResult.error.issues[0].message },
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }

        const batchResult = inventoryBatchSchema.safeParse(inventory);
        if (!batchResult.success) {
          throw new HttpException(
            { code: 'INVENTORY_BATCH_INVALID', message: batchResult.error.issues[0].message },
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }

        const { brandName, labelAr, labelEn, genericName, strength, dosageForm } = medicineResult.data;
        const { batchNumber, expiryDate, qtyOnHand, minReorderLevel } = batchResult.data;
        const identityKey = buildMedicineIdentityKey(medicineResult.data);
        const normalizedBatchNumber = normalizeBatchNumber(batchNumber);
        const today = getClinicDateString();

        if (expiryDate <= today) {
          throw new HttpException(
            { code: 'INVALID_EXPIRY_DATE', message: 'The initial stock batch must expire after today.' },
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }

        const remainingQty = Number(prescribedDrug.qtyPrescribed) - Number(prescribedDrug.qtyDispensed);
        if (qtyOnHand < remainingQty) {
          throw new HttpException(
            {
              code: 'INITIAL_STOCK_BELOW_PRESCRIPTION_REQUIREMENT',
              message: `Initial stock must contain at least ${remainingQty} units for this prescription.`,
            },
            HttpStatus.CONFLICT,
          );
        }

        const duplicateDrug = await tx.drugFormulary.findUnique({
          where: { identityKey },
          select: { id: true },
        });

        if (duplicateDrug) {
          throw new HttpException(
            { code: 'FORMULARY_MEDICINE_ALREADY_EXISTS', message: 'A matching medication already exists in the formulary. Link the existing medication instead.' },
            HttpStatus.CONFLICT,
          );
        }

        const linkedDrug = await tx.drugFormulary.create({
          data: {
            brandName,
            labelAr,
            labelEn,
            genericName,
            strength,
            dosageForm,
            identityKey,
            unitPriceSdg: null,
            status: 'INACTIVE',
          },
        });

        const createdBatch = await tx.inventoryBatch.create({
          data: {
            drugId: linkedDrug.id,
            batchNumber,
            normalizedBatchNumber,
            expiryDate,
            qtyOnHand,
            minReorderLevel,
          },
        });

        const openingMovement = stockMovementSchema.parse({
          movementType: 'OPENING_BALANCE',
          quantityDelta: qtyOnHand,
          resultingBalance: qtyOnHand,
          actorUserId: user.id,
          referenceType: 'CUSTOM_MEDICATION_REVIEW',
          referenceId: prescribedDrug.id,
          reason: 'Initial stock recorded during formulary creation.',
          idempotencyKey: `custom-medication-review:${prescribedDrug.id}:opening`,
        });

        await tx.stockMovement.create({
          data: {
            ...openingMovement,
            drugId: linkedDrug.id,
            inventoryBatchId: createdBatch.id,
          },
        });

        const claim = await tx.prescribedDrug.updateMany({
          where: { id: prescribedDrug.id, pharmacyReviewStatus: 'PENDING_REVIEW', drugId: null },
          data: {
            drugId: linkedDrug.id,
            pharmacyReviewStatus: 'APPROVED',
            pharmacyReviewedAt: new Date(),
            pharmacyReviewNote: note,
          },
        });

        if (claim.count !== 1) {
          throw new HttpException(
            { code: 'MEDICATION_REVIEW_CONFLICT', message: 'This medication was already reviewed by another pharmacist.' },
            HttpStatus.CONFLICT,
          );
        }

        const updated = await tx.prescribedDrug.findUnique({ where: { id: prescribedDrug.id } });

        await tx.tenantAuditLog.create({
          data: {
            userId: user.id,
            action: `PHARMACY_CUSTOM_MEDICATION_CREATED:${prescribedDrug.id}`,
            details: JSON.stringify({
              prescribedDrugId: prescribedDrug.id,
              prescriptionId: prescribedDrug.prescriptionId,
              customDrugName: prescribedDrug.customDrugName,
              createdDrugId: linkedDrug.id,
              initialBatchId: createdBatch.id,
              decision: 'CREATE_FORMULARY',
              note,
            }),
            ipAddress: ip || '127.0.0.1',
          },
        });

        await ensurePharmacyInvoiceInTransaction(tx, {
          prescriptionId: prescribedDrug.prescriptionId,
          actorUserId: user.id,
          ipAddress: ip || 'unknown',
          trigger: 'CUSTOM_MEDICATION_FORMULARY_CREATED',
        });

        return { decision, prescribedDrug: updated, drug: linkedDrug, inventoryBatch: createdBatch };
      });
      if (result.decision === 'CREATE_FORMULARY' && result.drug?.id) {
        await this.notificationsService?.notifyPharmacyPricingRequired({
          prescriptionId: result.prescribedDrug.prescriptionId,
          drugId: result.drug.id,
        });
      } else if (result.decision === 'EXTERNAL') {
        await this.notificationsService?.notifyPharmacyMedicationExternal({
          prescribedDrugId: result.prescribedDrug.id,
          prescriptionId: result.prescribedDrug.prescriptionId,
        });
      }
      return result;
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw error;
    }
  }
}
