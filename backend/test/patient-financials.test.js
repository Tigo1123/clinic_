import test from 'node:test';
import assert from 'node:assert/strict';
import { financialInvoiceDto } from '../src/services/patientFinancials.js';

const invoice = {
 id: 'invoice', invoiceType: 'GENERAL', paymentStatus: 'PARTIALLY_PAID', totalAmountSdg: '1000', totalAmountUsd: '0.666',
 items: [], payments: [{ id: 'p', amountSdg: '200', receivedBy: 'secret', paymentMethod: 'CASH' }], refunds: [],
 insuranceClaim: { id: 'claim', claimStatus: 'DRAFT', claimAmountSdg: '500', insuranceCompany: { labelEn: 'Insurer' } }
};
test('financial projection separates patient liability, payments and refunds without internal fields', () => {
 const row = financialInvoiceDto(invoice);
 assert.equal(row.patientShareSdg, 500); assert.equal(row.remainingBalanceSdg, 300);
 assert.equal(row.totalPaidSdg, 200); assert.equal(row.insuranceCoverageSdg, 500);
 assert.equal('receivedBy' in row.payments[0], false);
 const refunded = financialInvoiceDto({ ...invoice, refunds: [{ id: 'r', amountSdg: '50', processedBy: 'secret' }] });
 assert.equal(refunded.remainingBalanceSdg, 350); assert.equal(refunded.refundedSdg, 50);
 assert.equal('processedBy' in refunded.refunds[0], false);
});
test('self-pay and full payment use the same authoritative ledger arithmetic', () => {
 const row = financialInvoiceDto({ ...invoice, insuranceClaim: null, payments: [{ amountSdg: '1000' }] });
 assert.equal(row.patientShareSdg, 1000); assert.equal(row.insuranceCoverageSdg, 0); assert.equal(row.remainingBalanceSdg, 0);
});
