import { BILLABLE_NON_LAB_CATEGORIES, createDomainError } from '../utils/clinicalOrdering.js';
import { addMoney, multiplyMoney, subtractMoney } from '../utils/money.js';

const openInvoices = {
  invoiceType: 'GENERAL',
  paymentStatus: { notIn: ['REFUNDED', 'VOIDED'] }
};

const invoiceInclude = { items: true, insuranceClaim: true, payments: true, refunds: true };
const orderInclude = {
  items: { include: { service: true }, orderBy: { id: 'asc' } },
  medicalRecord: { select: { appointmentId: true } },
  invoices: {
    where: openInvoices,
    orderBy: { invoiceDate: 'desc' },
    take: 1,
    include: invoiceInclude
  }
};

export function summarizeOrderInvoice(invoice) {
  if (!invoice) return null;
  const { payments, refunds, insuranceClaim, ...invoiceSnapshot } = invoice;
  const grossTotalSdg = Number(invoiceSnapshot.totalAmountSdg);
  const insuranceCoverageSdg = Number(insuranceClaim?.claimAmountSdg || 0);
  const patientShareSdg = Math.max(0, subtractMoney(grossTotalSdg, insuranceCoverageSdg));
  const paidSdg = payments.reduce((total, payment) => addMoney(total, payment.amountSdg), 0);
  const refundedSdg = refunds.reduce((total, refund) => addMoney(total, refund.amountSdg), 0);
  const refundableSdg = Math.max(0, subtractMoney(paidSdg, refundedSdg));
  const remainingBalanceSdg = Math.max(0, subtractMoney(patientShareSdg, refundableSdg));
  return {
    invoice: { ...invoiceSnapshot, insuranceClaim },
    insuranceClaim,
    grossTotalSdg,
    insuranceCoverageSdg,
    patientShareSdg,
    refundableSdg,
    remainingBalanceSdg,
    existing: true
  };
}

export async function enforceRefundAppointmentCutoff(tx, appointmentId) {
  const [appointment] = await tx.$queryRaw`SELECT "status" FROM "Appointment" WHERE "id" = ${appointmentId} FOR UPDATE`;
  if (['IN_CONSULTATION', 'COMPLETED'].includes(appointment?.status)) {
    throw createDomainError(403, 'CONSULTATION_REFUND_LOCKED', 'Refund locked. The patient has already entered consultation or finished their visit.');
  }
}

export async function findConsultationInvoice(db, appointmentId) {
  return summarizeOrderInvoice(await db.invoice.findFirst({
    where: {
      appointmentId,
      invoiceType: 'CONSULTATION',
      paymentStatus: { notIn: ['REFUNDED', 'VOIDED'] }
    },
    orderBy: { invoiceDate: 'desc' },
    include: invoiceInclude
  }));
}

export async function resolveServiceOrderBilling(db, serviceOrderId, patientId, isConfiguredPrice) {
  const order = await db.serviceOrder.findUnique({ where: { id: serviceOrderId }, include: orderInclude });
  if (!order) throw createDomainError(404, 'SERVICE_ORDER_NOT_FOUND', 'Clinical service order not found.');
  if (order.patientId !== patientId) {
    throw createDomainError(409, 'SERVICE_ORDER_PATIENT_MISMATCH', 'The invoice patient does not match the clinical service order.');
  }

  const existingInvoice = summarizeOrderInvoice(order.invoices[0]);
  if (existingInvoice) return { existingInvoice };
  if (order.status !== 'PENDING_BILLING') {
    throw createDomainError(409, 'SERVICE_ORDER_NOT_BILLABLE', 'This clinical service order cannot be billed.');
  }

  const chargeableItems = order.items.filter((item) => !item.billingExcludedAt);
  if (!chargeableItems.length) {
    throw createDomainError(409, 'SERVICE_ORDER_NO_CHARGES', 'All charges have been removed from this clinical service order.');
  }
  const items = chargeableItems.map(({ service, quantity }) => {
    if (service.status !== 'ACTIVE' || !BILLABLE_NON_LAB_CATEGORIES.includes(service.category) || !isConfiguredPrice(service.baseFeeSdg)) {
      throw createDomainError(409, 'SERVICE_ORDER_PRICE_INVALID', 'An ordered service is inactive or does not have a valid configured price.');
    }
    return {
      sourceServiceId: service.id,
      descriptionAr: service.labelAr,
      descriptionEn: service.labelEn,
      qty: quantity,
      unitPriceSdg: Number(service.baseFeeSdg)
    };
  });
  const totalSdg = items.reduce((sum, item) => addMoney(sum, multiplyMoney(item.unitPriceSdg, item.qty)), 0);
  if (!Number.isSafeInteger(totalSdg) || totalSdg <= 0) {
    throw createDomainError(422, 'INVOICE_TOTAL_INVALID', 'Invoice total exceeds the supported financial range.');
  }
  return { items, totalSdg, appointmentId: order.medicalRecord.appointmentId, billingVersion: order.billingVersion };
}

async function lockServiceOrder(tx, serviceOrderId) {
  const [order] = await tx.$queryRaw`SELECT "id", "status", "billingVersion" FROM "ServiceOrder" WHERE "id" = ${serviceOrderId} FOR UPDATE`;
  if (!order) throw createDomainError(404, 'SERVICE_ORDER_NOT_FOUND', 'Clinical service order not found.');
  const existingInvoice = await tx.invoice.findFirst({
    where: { serviceOrderId, ...openInvoices },
    orderBy: { invoiceDate: 'desc' },
    include: invoiceInclude
  });
  return { order, existingInvoice: summarizeOrderInvoice(existingInvoice) };
}

export async function confirmServiceOrderBilling(tx, serviceOrderId, billingVersion) {
  const { order, existingInvoice } = await lockServiceOrder(tx, serviceOrderId);
  if (existingInvoice) return existingInvoice;
  if (order.status !== 'PENDING_BILLING' || order.billingVersion !== billingVersion) {
    throw createDomainError(409, 'SERVICE_ORDER_BILLING_CHANGED', 'The clinical service charges changed. Reopen the order to review the current amount.');
  }
  return null;
}

export async function excludeServiceOrderCharge(db, { serviceOrderId, itemId, reason, userId, ipAddress }) {
  return db.$transaction(async (tx) => {
    const { order, existingInvoice } = await lockServiceOrder(tx, serviceOrderId);
    if (existingInvoice || order.status !== 'PENDING_BILLING') {
      throw createDomainError(409, 'SERVICE_ORDER_INVOICE_LOCKED', 'An issued invoice or closed order locks these clinical service charges.');
    }

    const item = await tx.serviceOrderItem.findFirst({ where: { id: itemId, serviceOrderId } });
    if (!item) throw createDomainError(404, 'SERVICE_ORDER_ITEM_NOT_FOUND', 'Clinical service order item not found.');
    if (item.billingExcludedAt) return { id: item.id, excluded: true };

    await tx.serviceOrderItem.update({
      where: { id: item.id },
      data: { billingExcludedAt: new Date(), billingExcludedBy: userId, billingExclusionReason: reason }
    });
    await tx.serviceOrder.update({
      where: { id: order.id },
      data: { billingVersion: { increment: 1 } }
    });
    await tx.tenantAuditLog.create({
      data: {
        userId,
        action: 'SERVICE_ORDER_CHARGE_EXCLUDED',
        details: JSON.stringify({ serviceOrderId, itemId, serviceId: item.serviceId, reason }),
        ipAddress
      }
    });
    return { id: item.id, excluded: true };
  });
}

export async function settleServiceOrder(tx, serviceOrderId) {
  const updated = await tx.serviceOrder.updateMany({
    where: { id: serviceOrderId, status: 'PENDING_BILLING' },
    data: { status: 'PAID', paidAt: new Date() }
  });
  if (updated.count !== 1) {
    throw createDomainError(409, 'SERVICE_ORDER_PAYMENT_STATE_CONFLICT', 'The clinical service order is no longer awaiting payment.');
  }
}

export async function pendingServiceOrderBilling(db, patientId, isConfiguredPrice) {
  const orders = await db.serviceOrder.findMany({
    where: { status: 'PENDING_BILLING', patientId, patient: { status: 'ACTIVE' } },
    orderBy: { orderDate: 'asc' },
    select: {
      id: true,
      orderDate: true,
      items: orderInclude.items,
      invoices: orderInclude.invoices,
      doctor: { select: { fullNameAr: true, fullNameEn: true } }
    }
  });
  return orders.map((order) => {
    const issuedInvoice = summarizeOrderInvoice(order.invoices[0]);
    const orderedItems = order.items.map(({ id, service, quantity, billingExcludedAt, billingExclusionReason }) => ({
      id,
      labelAr: service.labelAr,
      labelEn: service.labelEn,
      quantity,
      billingExcludedAt,
      billingExclusionReason,
      baseFeeSdg: service.status === 'ACTIVE' && isConfiguredPrice(service.baseFeeSdg)
        ? Number(service.baseFeeSdg)
        : null
    }));
    const invoiceItems = issuedInvoice?.invoice.items.map((item) => ({
      id: item.id,
      labelAr: item.descriptionAr,
      labelEn: item.descriptionEn,
      quantity: item.qty,
      baseFeeSdg: Number(item.unitPriceSdg)
    }));

    return {
      id: order.id,
      orderDate: order.orderDate,
      doctor: order.doctor,
      issuedInvoice,
      items: invoiceItems ? [...invoiceItems, ...orderedItems.filter((item) => item.billingExcludedAt)] : orderedItems
    };
  });
}
