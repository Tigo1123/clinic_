import { createDomainError } from '../utils/clinicalOrdering.js';
import { addMoney } from '../utils/money.js';
import { summarizeOrderInvoice } from './serviceOrderBilling.js';

export async function resolveLabOrderBilling(db, labOrderId, patientId, isConfiguredPrice) {
  if (typeof labOrderId !== 'string' || !labOrderId.trim()) {
    throw createDomainError(422, 'LAB_ORDER_REQUIRED', 'Laboratory billing requires a lab order.');
  }

  const order = await db.labOrder.findUnique({
    where: { id: labOrderId.trim() },
    include: {
      medicalRecord: { select: { appointmentId: true } },
      items: { include: { service: true } },
      invoices: {
        where: { invoiceType: 'LABORATORY', paymentStatus: { notIn: ['REFUNDED', 'VOIDED'] } },
        orderBy: { invoiceDate: 'desc' },
        take: 1,
        include: { items: true, insuranceClaim: true, payments: true, refunds: true }
      }
    }
  });
  if (!order) throw createDomainError(404, 'LAB_ORDER_NOT_FOUND', 'Laboratory order not found.');
  if (order.patientId !== patientId) {
    throw createDomainError(409, 'LAB_ORDER_PATIENT_MISMATCH', 'The invoice patient does not match the laboratory order patient.');
  }
  if (!['PENDING_BILLING', 'PAID'].includes(order.status)) {
    throw createDomainError(409, 'LAB_BILLING_INVALID_STATE', 'This laboratory order can no longer be billed.');
  }

  const existingInvoice = summarizeOrderInvoice(order.invoices[0]);
  if (existingInvoice) return { existingInvoice };
  if (!order.items.length) {
    throw createDomainError(409, 'LAB_ORDER_EMPTY', 'The laboratory order does not contain billable tests.');
  }
  if (order.items.some((item) => item.labReviewStatus === 'PENDING_REVIEW')) {
    throw createDomainError(409, 'LAB_REVIEW_PENDING', 'A laboratory test requires review and pricing before the invoice can be issued.');
  }
  const billableItems = order.items.filter((item) => item.labReviewStatus !== 'EXTERNAL');
  if (!billableItems.length) {
    throw createDomainError(409, 'LAB_NO_BILLABLE_TESTS', 'This laboratory order contains only external tests and has no clinic charge.');
  }

  const items = billableItems.map(({ service }) => {
    if (!service) throw createDomainError(409, 'LAB_REVIEW_STATE_INVALID', 'A clinic-provided laboratory test is not linked to a catalogue service.');
    if (!['LABORATORY', 'RADIOLOGY'].includes(service.category)) {
      throw createDomainError(409, 'LAB_ORDER_SERVICE_INVALID', 'The laboratory order contains a service that cannot be billed as a diagnostic test.');
    }
    if (service.status !== 'ACTIVE' || !isConfiguredPrice(service.baseFeeSdg)) {
      throw createDomainError(409, 'LAB_SERVICE_PRICE_NOT_CONFIGURED', 'One or more ordered tests do not have a valid configured price.');
    }
    return {
      sourceServiceId: service.id,
      descriptionAr: service.labelAr,
      descriptionEn: service.labelEn,
      qty: 1,
      unitPriceSdg: Number(service.baseFeeSdg)
    };
  });
  const totalSdg = items.reduce((total, item) => addMoney(total, item.unitPriceSdg), 0);
  if (!Number.isSafeInteger(totalSdg)) {
    throw createDomainError(422, 'INVOICE_TOTAL_INVALID', 'Invoice total exceeds the supported financial range.');
  }
  return { id: order.id, items, totalSdg, appointmentId: order.medicalRecord?.appointmentId || null };
}
