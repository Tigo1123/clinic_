import { money } from '../utils/money.js';

export const financialInvoiceSelect = {
  id: true, invoiceDate: true, invoiceType: true, paymentStatus: true,
  totalAmountSdg: true, totalAmountUsd: true,
  items: { select: { descriptionAr: true, descriptionEn: true, qty: true, unitPriceSdg: true } },
  payments: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, createdAt: true, amountSdg: true, paymentMethod: true } },
  refunds: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, createdAt: true, amountSdg: true, refundMethod: true } },
  insuranceClaim: { select: { id: true, claimStatus: true, claimAmountSdg: true, submissionDate: true, paymentDate: true, insuranceCompany: { select: { labelAr: true, labelEn: true } } } }
};

export function financialInvoiceDto(invoice) {
  const gross = money(invoice.totalAmountSdg);
  const covered = money(invoice.insuranceClaim?.claimAmountSdg ?? 0);
  const paid = invoice.payments.reduce((sum, row) => sum.plus(row.amountSdg), money(0));
  const refunded = invoice.refunds.reduce((sum, row) => sum.plus(row.amountSdg), money(0));
  const patient = gross.minus(covered);
  // Explicit fields only: no operator IDs, reference tokens, clinical notes or user relations.
  return {
    id: invoice.id, invoiceDate: invoice.invoiceDate, invoiceType: invoice.invoiceType,
    paymentStatus: invoice.paymentStatus, totalAmountSdg: gross.toNumber(), totalAmountUsd: Number(invoice.totalAmountUsd),
    insuranceCoverageSdg: covered.toNumber(), patientShareSdg: patient.toNumber(),
    totalPaidSdg: paid.toNumber(), refundedSdg: refunded.toNumber(),
    remainingBalanceSdg: Math.max(0, patient.minus(paid).plus(refunded).toNumber()),
    items: invoice.items.map(row => ({ descriptionAr: row.descriptionAr, descriptionEn: row.descriptionEn, qty: row.qty, unitPriceSdg: Number(row.unitPriceSdg) })),
    payments: invoice.payments.map(row => ({ id: row.id, createdAt: row.createdAt, amountSdg: Number(row.amountSdg), paymentMethod: row.paymentMethod })),
    refunds: invoice.refunds.map(row => ({ id: row.id, createdAt: row.createdAt, amountSdg: Number(row.amountSdg), refundMethod: row.refundMethod })),
    insuranceClaim: invoice.insuranceClaim ? { id: invoice.insuranceClaim.id, claimStatus: invoice.insuranceClaim.claimStatus, claimAmountSdg: covered.toNumber(), submissionDate: invoice.insuranceClaim.submissionDate, paymentDate: invoice.insuranceClaim.paymentDate, insuranceCompany: invoice.insuranceClaim.insuranceCompany } : null
  };
}
