import { Prisma } from '../generated/prisma/index.js';
import prisma from '../db.js';

const LOCKED_EXCHANGE_RATE = 1500;
const MAX_MONEY_SDG = 1_000_000_000;
const MAX_INVOICE_QUANTITY = 10_000;

function isConfiguredPrice(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 && amount <= MAX_MONEY_SDG;
}

function pending(code, message, prescriptionId) {
  return { invoice: null, existing: false, pending: true, code, message, prescriptionId };
}

export async function ensurePharmacyInvoiceInTransaction(tx, {
  prescriptionId,
  actorUserId,
  ipAddress = 'unknown',
  trigger = 'PRESCRIPTION_CREATED'
}) {
  await tx.$queryRaw(Prisma.sql`
    SELECT 1::int AS "locked"
    FROM pg_advisory_xact_lock(
      hashtextextended(${`pharmacy-invoice:${prescriptionId}`}, 0)
    )
  `);

  const existingInvoices = await tx.invoice.findMany({
    where: {
      prescriptionId,
      invoiceType: 'PHARMACY',
      paymentStatus: { not: 'REFUNDED' }
    },
    include: { items: true },
    orderBy: [{ invoiceDate: 'desc' }, { id: 'desc' }],
    take: 2
  });

  if (existingInvoices.length > 1) {
    return pending(
      'PHARMACY_INVOICE_INVARIANT_VIOLATION',
      'Pharmacy billing requires administrative review.',
      prescriptionId
    );
  }

  if (existingInvoices.length === 1) {
    return { invoice: existingInvoices[0], existing: true, pending: false, prescriptionId };
  }

  const refundedInvoice = await tx.invoice.findFirst({
    where: { prescriptionId, invoiceType: 'PHARMACY', paymentStatus: 'REFUNDED' },
    select: { id: true }
  });
  if (refundedInvoice) {
    return pending(
      'PHARMACY_REFUNDED_INVOICE_REVIEW_REQUIRED',
      'Refunded pharmacy billing requires administrative review.',
      prescriptionId
    );
  }

  const prescription = await tx.prescription.findUnique({
    where: { id: prescriptionId },
    include: {
      medicalRecord: { select: { appointmentId: true } },
      prescribedDrugs: { include: { drug: true } }
    }
  });

  if (!prescription) {
    return pending('PHARMACY_PRESCRIPTION_NOT_FOUND', 'Prescription was not found.', prescriptionId);
  }

  if (!['ACTIVE', 'PARTIALLY_FILLED'].includes(prescription.status)) {
    return pending(
      'PHARMACY_BILLING_INVALID_STATE',
      'This prescription is not eligible for pharmacy billing.',
      prescriptionId
    );
  }

  const unresolved = prescription.prescribedDrugs.some((item) =>
    item.pharmacyReviewStatus === 'PENDING_REVIEW'
    || (!item.drugId && item.pharmacyReviewStatus !== 'EXTERNAL')
  );
  if (unresolved) {
    return pending(
      'PHARMACY_REVIEW_PENDING',
      'One or more prescribed medications are awaiting pharmacy review.',
      prescriptionId
    );
  }

  const clinicItems = prescription.prescribedDrugs.filter((item) =>
    item.pharmacyReviewStatus !== 'EXTERNAL' && item.drugId && item.drug
  );
  if (clinicItems.length === 0) {
    return pending(
      'PHARMACY_NO_BILLABLE_ITEMS',
      'The prescription contains no clinic-billable pharmacy items.',
      prescriptionId
    );
  }

  const quantities = clinicItems.map((item) => ({
    item,
    quantity: Number(item.qtyPrescribed) - Number(item.qtyDispensed)
  }));
  const invalidQuantity = quantities.find(({ quantity }) =>
    !Number.isSafeInteger(quantity) || quantity < 0 || quantity > MAX_INVOICE_QUANTITY
  );
  if (invalidQuantity) {
    return pending(
      'PHARMACY_QUANTITY_INVALID',
      'One or more prescribed quantities are not valid for pharmacy billing.',
      prescriptionId
    );
  }

  const billableItems = quantities.filter(({ quantity }) => quantity > 0);
  if (billableItems.length === 0) {
    return pending(
      'PHARMACY_NO_BILLABLE_ITEMS',
      'The prescription contains no clinic-billable pharmacy items.',
      prescriptionId
    );
  }

  const unpricedItem = billableItems.find(({ item }) =>
    item.drug.status !== 'ACTIVE' || !isConfiguredPrice(item.drug.unitPriceSdg)
  );
  if (unpricedItem) {
    return pending(
      'PHARMACY_PRICE_NOT_CONFIGURED',
      'One or more prescribed medications require authoritative pricing or activation.',
      prescriptionId
    );
  }

  const actor = await tx.user.findUnique({
    where: { id: actorUserId },
    select: { id: true, status: true }
  });
  if (!actor || actor.status !== 'ACTIVE') {
    throw Object.assign(new Error('A valid initiating actor is required.'), {
      status: 403,
      code: 'PHARMACY_INVOICE_ACTOR_INVALID'
    });
  }

  let totalAmountSdg = 0;
  const invoiceItems = billableItems.map(({ item, quantity }) => {
    const unitPriceSdg = Number(item.drug.unitPriceSdg);
    const lineTotal = quantity * unitPriceSdg;
    if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(totalAmountSdg + lineTotal)) {
      throw Object.assign(new Error('Pharmacy invoice total exceeds the supported range.'), {
        status: 422,
        code: 'PHARMACY_INVOICE_TOTAL_INVALID'
      });
    }
    totalAmountSdg += lineTotal;
    return {
      descriptionAr: item.drug.labelAr,
      descriptionEn: item.drug.labelEn,
      qty: quantity,
      unitPriceSdg,
      unitPriceUsd: unitPriceSdg / LOCKED_EXCHANGE_RATE
    };
  });

  const invoice = await tx.invoice.create({
    data: {
      patientId: prescription.patientId,
      appointmentId: prescription.medicalRecord?.appointmentId || null,
      prescriptionId: prescription.id,
      invoiceType: 'PHARMACY',
      totalAmountSdg,
      totalAmountUsd: totalAmountSdg / LOCKED_EXCHANGE_RATE,
      invoiceExchangeRate: LOCKED_EXCHANGE_RATE,
      paymentStatus: 'UNPAID',
      createdBy: actorUserId,
      items: { create: invoiceItems }
    },
    include: { items: true }
  });

  await tx.tenantAuditLog.create({
    data: {
      userId: actorUserId,
      action: 'PHARMACY_INVOICE_AUTOMATICALLY_CREATED',
      details: JSON.stringify({
        prescriptionId: prescription.id,
        invoiceId: invoice.id,
        totalAmountSdg,
        trigger
      }),
      ipAddress
    }
  });

  return { invoice, existing: false, pending: false, prescriptionId };
}

export async function ensurePharmacyInvoiceForPrescription(options) {
  const run = () => prisma.$transaction(
    (tx) => ensurePharmacyInvoiceInTransaction(tx, options),
    { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 }
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const contention = ['P2028', 'P2034'].includes(error?.code)
        || /serialization|write conflict|deadlock/i.test(error?.message || '');
      if (!contention || attempt === 2) throw error;
    }
  }
  throw new Error('Unable to ensure pharmacy invoice.');
}
