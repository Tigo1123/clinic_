import express from 'express';
import { createHash } from 'node:crypto';
import prisma from '../db.js';
import { authenticate, checkRoles } from '../middleware/auth.js';
import { allowRoles, ROLES } from '../middleware/policies.js';
import { sendError } from '../utils/apiError.js';
import { clinicDateSequence, clinicMonthBounds, getClinicDateString, instantToClinicDateString } from '../utils/clinicTime.js';

const router = express.Router();

/**
 * POST /api/billing/invoice
 * Generates an itemized invoice. Locked exchange rate is pinned at creation time.
 */
router.post('/invoice', authenticate, allowRoles(ROLES.ADMIN, ROLES.RECEPTIONIST), async (req, res) => {
  const {
    patientId,
    appointmentId,
    insuranceCompanyId, // Optional insurance link
    items // Array of { descriptionAr, descriptionEn, qty, unitPriceSdg }
  } = req.body;

  if (!patientId || !items || items.length === 0) {
    return res.status(400).json({ error: 'Patient ID and invoice items are required.' });
  }

  try {
    // 1. Fetch current exchange rate from some global setting (we can fetch doctor fee or static value)
    // For simplicity, let's set a default rate of 1500.00 SDG/USD
    const lockedExchangeRate = 1500.00;

    // Calculate totals
    let totalSdg = 0;
    const invoiceItemsData = items.map((item) => {
      const priceSdg = parseFloat(item.unitPriceSdg);
      const qty = Number(item.qty);
      if (!Number.isFinite(priceSdg) || priceSdg <= 0 || !Number.isInteger(qty) || qty <= 0) {
        throw new Error('Invoice quantities and prices must be positive values.');
      }
      const priceUsd = priceSdg / lockedExchangeRate;
      totalSdg += priceSdg * qty;

      return {
        descriptionAr: item.descriptionAr,
        descriptionEn: item.descriptionEn,
        qty,
        unitPriceSdg: priceSdg,
        unitPriceUsd: priceUsd
      };
    });

    const totalUsd = totalSdg / lockedExchangeRate;

    // 2. Resolve Insurance share if linked
    let insuranceClaim = null;
    let patientShareSdg = totalSdg;

    const result = await prisma.$transaction(async (tx) => {
      // Create Invoice
      const invoice = await tx.invoice.create({
        data: {
          patientId,
          appointmentId: appointmentId || null,
          totalAmountSdg: totalSdg,
          totalAmountUsd: totalUsd,
          invoiceExchangeRate: lockedExchangeRate,
          paymentStatus: 'UNPAID',
          createdBy: req.user.id,
          items: {
            create: invoiceItemsData
          }
        },
        include: {
          items: true
        }
      });

      if (insuranceCompanyId) {
        const company = await tx.insuranceCompany.findUnique({
          where: { id: insuranceCompanyId }
        });

        if (company) {
          const copayFactor = parseFloat(company.copayPercentage) / 100.0;
          patientShareSdg = totalSdg * copayFactor;
          const claimAmountSdg = totalSdg - patientShareSdg;

          // Create Insurance Claim
          insuranceClaim = await tx.insuranceClaim.create({
            data: {
              insuranceCompanyId,
              patientId,
              invoiceId: invoice.id,
              claimAmountSdg,
              claimStatus: 'DRAFT'
            }
          });

          // Link Claim back to Invoice
          await tx.invoice.update({
            where: { id: invoice.id },
            data: { insuranceClaimId: insuranceClaim.id }
          });
        }
      }

      return { invoice, insuranceClaim, patientShareSdg };
    });

    return res.status(201).json(result);

  } catch (error) {
    console.error('Create invoice error:', error);
    return res.status(500).json({ error: 'Failed to generate invoice.' });
  }
});

/**
 * POST /api/billing/invoice/:id/payments
 * Records split payment methods. Validates transaction reference uniqueness.
 */
router.post('/invoice/:id/payments', authenticate, allowRoles(ROLES.ADMIN, ROLES.RECEPTIONIST), async (req, res) => {
  const invoiceId = req.params.id;
  const { payments } = req.body; // Array of { amountSdg, paymentMethod, transactionReference }
  const idempotencyKey = req.get('Idempotency-Key')?.trim();

  if (!payments || payments.length === 0) {
    return res.status(400).json({ error: 'Payment rows are required.' });
  }
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    return sendError(res, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required for payments.');
  }

  let requestHash;
  try {
    const normalizedPayments = payments.map((pay) => {
      const amount = Number(pay.amountSdg);
      if (!Number.isFinite(amount) || amount <= 0) throw Object.assign(new Error('Payment amounts must be greater than zero.'), { status: 422, code: 'INVALID_PAYMENT_AMOUNT' });
      if (!['CASH', 'CARD', 'BANKAK', 'FAWRY'].includes(pay.paymentMethod)) {
        throw Object.assign(new Error('Unsupported payment method.'), { status: 422, code: 'INVALID_PAYMENT_METHOD' });
      }
      return {
        amountSdg: amount,
        paymentMethod: pay.paymentMethod,
        transactionReference: pay.transactionReference?.trim() || null
      };
    });
    requestHash = createHash('sha256').update(JSON.stringify({ invoiceId, payments: normalizedPayments })).digest('hex');

    const runPaymentTransaction = () => prisma.$transaction(async (tx) => {
      const priorOperation = await tx.paymentOperation.findUnique({ where: { idempotencyKey } });
      if (priorOperation) {
        if (priorOperation.invoiceId !== invoiceId || priorOperation.requestHash !== requestHash) {
          throw Object.assign(new Error('Idempotency key was already used for a different payment request.'), { status: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
        }
        const replayInvoice = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } });
        const replayPaid = replayInvoice.payments.reduce((sum, payment) => sum + Number(payment.amountSdg), 0);
        return { ...replayInvoice, totalPaidSdg: replayPaid, remainingBalanceSdg: Math.max(0, Number(replayInvoice.totalAmountSdg) - replayPaid), idempotentReplay: true };
      }

      const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true, refunds: true } });
      if (!invoice) throw Object.assign(new Error('Invoice not found.'), { status: 404, code: 'INVOICE_NOT_FOUND' });
      if (invoice.refunds.length) throw Object.assign(new Error('Payments cannot be added after a refund has been recorded.'), { status: 409, code: 'REFUNDED_INVOICE_LOCKED' });

      for (const pay of normalizedPayments) {
        if (pay.transactionReference) {
          const existingPay = await tx.payment.findUnique({ where: { transactionReference: pay.transactionReference }, select: { id: true } });
          if (existingPay) throw Object.assign(new Error('Payment reference has already been used.'), { status: 409, code: 'DUPLICATE_PAYMENT_REFERENCE' });
        }
      }

      const priorPaidSdg = invoice.payments.reduce((sum, payment) => sum + Number(payment.amountSdg), 0);
      const newPaidSdg = normalizedPayments.reduce((sum, payment) => sum + payment.amountSdg, 0);
      const resultingPaidSdg = priorPaidSdg + newPaidSdg;
      const invoiceTotal = Number(invoice.totalAmountSdg);
      if (resultingPaidSdg > invoiceTotal + 0.001) {
        throw Object.assign(new Error('Payment exceeds the remaining invoice balance.'), { status: 409, code: 'PAYMENT_EXCEEDS_BALANCE' });
      }

      const claimed = await tx.invoice.updateMany({
        where: { id: invoiceId, ledgerVersion: invoice.ledgerVersion },
        data: { ledgerVersion: { increment: 1 } }
      });
      if (claimed.count !== 1) throw Object.assign(new Error('Invoice ledger changed; retry the payment.'), { status: 409, code: 'PAYMENT_LEDGER_CONFLICT', retryable: true });

      const operation = await tx.paymentOperation.create({ data: { invoiceId, idempotencyKey, requestHash, receivedBy: req.user.id } });
      for (const pay of normalizedPayments) {
        await tx.payment.create({ data: {
          invoiceId,
          amountSdg: pay.amountSdg,
          amountUsd: pay.amountSdg / Number(invoice.invoiceExchangeRate),
          paymentMethod: pay.paymentMethod,
          transactionReference: pay.transactionReference,
          verificationStatus: 'VERIFIED',
          receivedBy: req.user.id,
          paymentOperationId: operation.id
        } });
      }

      const invoiceStatus = resultingPaidSdg >= invoiceTotal ? 'PAID' : 'PARTIALLY_PAID';
      const updatedInvoice = await tx.invoice.update({
        where: { id: invoiceId },
        data: { paymentStatus: invoiceStatus },
        include: { payments: true }
      });

      return { ...updatedInvoice, totalPaidSdg: resultingPaidSdg, remainingBalanceSdg: Math.max(0, invoiceTotal - resultingPaidSdg) };
    }, { maxWait: 5000, timeout: 10000 });

    let result;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        result = await runPaymentTransaction();
        break;
      } catch (error) {
        const transactionContention = ['P2028', 'P2034'].includes(error.code) || /database is locked|write conflict|deadlock|serialization/i.test(error.message || '');
        if (!transactionContention || attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
      }
    }

    return res.json(result);

  } catch (error) {
    if (error.status && error.code) return sendError(res, error.status, error.code, error.message);
    if (error.code === 'P2002') {
      const priorOperation = await prisma.paymentOperation.findUnique({ where: { idempotencyKey } });
      if (priorOperation?.invoiceId === invoiceId && priorOperation.requestHash === requestHash) {
        const replayInvoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } });
        const replayPaid = replayInvoice.payments.reduce((sum, payment) => sum + Number(payment.amountSdg), 0);
        return res.json({ ...replayInvoice, totalPaidSdg: replayPaid, remainingBalanceSdg: Math.max(0, Number(replayInvoice.totalAmountSdg) - replayPaid), idempotentReplay: true });
      }
      return sendError(res, 409, 'DUPLICATE_PAYMENT_REFERENCE', 'Payment reference or idempotency key has already been used.');
    }
    console.error('Record payment error:', error);
    return res.status(500).json({ error: 'Failed to record split payment.' });
  }
});

/**
 * POST /api/billing/invoice/:id/refund
 * Records an append-only refund and updates the invoice's derived refund status.
 * Refunds are disabled if patient has started consultation or completed visit.
 */
router.post('/invoice/:id/refund', authenticate, allowRoles(ROLES.ADMIN, ROLES.RECEPTIONIST), async (req, res) => {
  const amountSdg = Number(req.body.amountSdg);
  const { refundMethod, transactionReference, reason } = req.body;
  if (!Number.isFinite(amountSdg) || amountSdg <= 0) return sendError(res, 422, 'INVALID_REFUND_AMOUNT', 'Refund amount must be greater than zero.');
  if (!['CASH', 'CARD', 'BANKAK', 'FAWRY'].includes(refundMethod)) return sendError(res, 422, 'INVALID_REFUND_METHOD', 'Unsupported refund method.');
  if (transactionReference !== undefined && (typeof transactionReference !== 'string' || !transactionReference.trim())) return sendError(res, 422, 'INVALID_REFUND_REFERENCE', 'Refund reference must be a non-empty string.');
  if (reason !== undefined && (typeof reason !== 'string' || reason.trim().length > 500)) return sendError(res, 422, 'INVALID_REFUND_REASON', 'Refund reason must be at most 500 characters.');
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: { appointment: true }
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found.' });
    }
    if (transactionReference) {
      const normalizedReference = transactionReference.trim();
      const [paymentReference, refundReference] = await Promise.all([
        prisma.payment.findUnique({ where: { transactionReference: normalizedReference }, select: { id: true } }),
        prisma.refund.findUnique({ where: { transactionReference: normalizedReference }, select: { id: true } })
      ]);
      if (paymentReference || refundReference) return sendError(res, 409, 'DUPLICATE_REFUND_REFERENCE', 'Transaction reference has already been used.');
    }

    // Refund Locker Check: If appointment is in consultation or completed, block it
    if (invoice.appointment) {
      const activeStatus = invoice.appointment.status;
      if (['IN_CONSULTATION', 'COMPLETED'].includes(activeStatus)) {
        return res.status(403).json({
          error: 'Refund locked. The patient has already entered consultation or finished their visit.'
        });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const financial = await tx.invoice.findUnique({ where: { id: invoice.id }, include: { payments: true, refunds: true } });
      const paidSdg = financial.payments.reduce((sum, payment) => sum + Number(payment.amountSdg), 0);
      const previouslyRefundedSdg = financial.refunds.reduce((sum, refund) => sum + Number(refund.amountSdg), 0);
      const refundableSdg = paidSdg - previouslyRefundedSdg;
      if (paidSdg <= 0) throw Object.assign(new Error('No paid funds are available to refund.'), { status: 409, code: 'NO_PAID_FUNDS' });
      if (amountSdg > refundableSdg + 0.001) throw Object.assign(new Error('Refund exceeds the paid amount still available.'), { status: 409, code: 'REFUND_EXCEEDS_PAID_AMOUNT' });

      const claimed = await tx.invoice.updateMany({
        where: { id: invoice.id, ledgerVersion: financial.ledgerVersion },
        data: { ledgerVersion: { increment: 1 } }
      });
      if (claimed.count !== 1) throw Object.assign(new Error('Invoice ledger changed; retry the refund.'), { status: 409, code: 'REFUND_LEDGER_CONFLICT' });

      const refund = await tx.refund.create({ data: {
        invoiceId: invoice.id,
        amountSdg,
        amountUsd: amountSdg / Number(financial.invoiceExchangeRate),
        refundMethod,
        transactionReference: transactionReference?.trim() || null,
        reason: reason?.trim() || null,
        processedBy: req.user.id
      } });
      const totalRefundedSdg = previouslyRefundedSdg + amountSdg;
      const paymentStatus = totalRefundedSdg >= paidSdg - 0.001 ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
      const updatedInvoice = await tx.invoice.update({ where: { id: invoice.id }, data: { paymentStatus } });
      await tx.tenantAuditLog.create({ data: {
        userId: req.user.id,
        action: 'INVOICE_REFUND',
        details: `Refund ${refund.id} recorded for invoice ${invoice.id}; amount ${amountSdg} SDG; method ${refundMethod}.`,
        ipAddress: req.ip || '127.0.0.1'
      } });
      return {
        invoice: updatedInvoice,
        refund,
        paidSdg,
        refundedSdg: totalRefundedSdg,
        netCollectedSdg: paidSdg - totalRefundedSdg,
        refundableSdg: Math.max(0, paidSdg - totalRefundedSdg),
        remainingBalanceSdg: Math.max(0, Number(financial.totalAmountSdg) - (paidSdg - totalRefundedSdg))
      };
    });
    return res.status(201).json(result);

  } catch (error) {
    if (error.status && error.code) return sendError(res, error.status, error.code, error.message);
    if (error.code === 'P2002') return sendError(res, 409, 'DUPLICATE_REFUND_REFERENCE', 'Refund transaction reference has already been used.');
    console.error('Invoice refund error:', error);
    return res.status(500).json({ error: 'Failed to process invoice refund.' });
  }
});

/**
 * POST /api/billing/shift/reconcile
 * Logs shift balance reconciliation.
 */
router.post('/shift/reconcile', authenticate, allowRoles(ROLES.ADMIN, ROLES.RECEPTIONIST), async (req, res) => {
  const { expectedAmountSdg, actualAmountSdg, note } = req.body;

  if (expectedAmountSdg === undefined || actualAmountSdg === undefined) {
    return res.status(400).json({ error: 'Expected and actual cash amounts are required.' });
  }

  try {
    const diff = parseFloat(actualAmountSdg) - parseFloat(expectedAmountSdg);

    await prisma.tenantAuditLog.create({
      data: {
        userId: req.user.id,
        action: 'SHIFT_RECONCILIATION',
        details: `Shift reconciled. Expected: ${expectedAmountSdg} SDG. Actual: ${actualAmountSdg} SDG. Discrepancy: ${diff} SDG. Note: ${note || 'None'}`,
        ipAddress: req.ip || '127.0.0.1'
      }
    });

    return res.json({
      success: true,
      discrepancy: diff,
      message: diff === 0 ? 'Shift reconciled successfully. Perfect balance.' : 'Shift reconciled with discrepancy logged.'
    });
  } catch (error) {
    console.error('Shift reconciliation error:', error);
    return res.status(500).json({ error: 'Failed to submit shift reconciliation.' });
  }
});

/**
 * GET /api/billing/services
 * Returns list of clinical services.
 */
router.get('/services', async (req, res) => {
  try {
    const services = await prisma.clinicalService.findMany();
    return res.json(services);
  } catch (error) {
    console.error('Fetch services error:', error);
    return res.status(500).json({ error: 'Failed to retrieve clinical services.' });
  }
});

/**
 * GET /api/billing/insurance-companies
 * Returns list of insurance companies.
 */
router.get('/insurance-companies', async (req, res) => {
  try {
    const companies = await prisma.insuranceCompany.findMany();
    return res.json(companies);
  } catch (error) {
    console.error('Fetch insurance companies error:', error);
    return res.status(500).json({ error: 'Failed to retrieve insurance companies.' });
  }
});

/**
 * GET /api/billing/analytics
 * Returns summary performance metrics for the Admin Dashboard.
 */
router.get('/analytics', authenticate, checkRoles('ADMIN'), async (req, res) => {
  try {
    // 1. Revenue calculations
    const [payments, refunds] = await Promise.all([prisma.payment.findMany(), prisma.refund.findMany()]);
    let totalSdg = 0;
    let totalUsd = 0;
    const methodBreakdown = { CASH: 0, BANKAK: 0, FAWRY: 0, INSURANCE: 0 };

    payments.forEach(p => {
      totalSdg += Number(p.amountSdg || 0);
      totalUsd += Number(p.amountUsd || 0);
      const method = p.paymentMethod || 'CASH';
      if (methodBreakdown[method] !== undefined) {
        methodBreakdown[method] += Number(p.amountSdg || 0);
      }
    });
    refunds.forEach((refund) => {
      const amount = Number(refund.amountSdg);
      totalSdg -= amount;
      totalUsd -= Number(refund.amountUsd);
      if (methodBreakdown[refund.refundMethod] !== undefined) methodBreakdown[refund.refundMethod] -= amount;
    });

    // 2. Doctor workload
    const doctors = await prisma.doctor.findMany({
      include: {
        appointments: {
          select: { status: true }
        }
      }
    });

    const doctorMetrics = doctors.map(d => {
      const total = d.appointments.length;
      const completed = d.appointments.filter(a => a.status === 'COMPLETED').length;
      return {
        id: d.id,
        nameAr: d.fullNameAr,
        nameEn: d.fullNameEn,
        specialtyEn: d.specialtyEn,
        totalAppointments: total,
        completedAppointments: completed
      };
    });

    // 3. Top dispensed drugs
    const dispensedDrugs = await prisma.prescribedDrug.findMany({
      where: {
        qtyDispensed: { gt: 0 }
      },
      include: {
        drug: true
      }
    });

    const drugSales = {};
    dispensedDrugs.forEach(pd => {
      const name = pd.drug.tradeNameEn;
      drugSales[name] = (drugSales[name] || 0) + pd.qtyDispensed;
    });

    const topDrugs = Object.entries(drugSales)
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);

    // 4. Patients Seen Today
    const todayStr = getClinicDateString();
    const patientsSeenToday = await prisma.appointment.count({
      where: {
        appointmentDate: todayStr,
        status: 'COMPLETED'
      }
    });

    // 5. Daily and Monthly Revenue Trends from recorded payments only.
    const last7Days = clinicDateSequence(7);

    const dailyRevenueTrend = last7Days.map(date => {
      const dayTotal = payments
        .filter(p => instantToClinicDateString(p.createdAt) === date)
        .reduce((sum, p) => sum + parseFloat(p.amountSdg), 0);
      const refundTotal = refunds.filter((refund) => instantToClinicDateString(refund.createdAt) === date).reduce((sum, refund) => sum + Number(refund.amountSdg), 0);
      return {
        date,
        amount: dayTotal - refundTotal
      };
    });

    const last6Months = Array.from({ length: 6 }, (_, index) => {
      return clinicMonthBounds(new Date(), index - 5);
    });

    const monthlyRevenueTrend = last6Months.map(({ start, end, label }) => {
      return {
        month: label,
        amount: payments.filter((payment) => payment.createdAt >= start && payment.createdAt < end).reduce((sum, payment) => sum + Number(payment.amountSdg), 0)
          - refunds.filter((refund) => refund.createdAt >= start && refund.createdAt < end).reduce((sum, refund) => sum + Number(refund.amountSdg), 0)
      };
    });

    // Wait-time history is not recorded by the current schema; never fabricate it.
    const averageWaitTimeMinutes = null;
    const waitTimeTrend = [];

    return res.json({
      revenue: {
        totalSdg,
        totalUsd,
        methodBreakdown
      },
      doctorWorkload: doctorMetrics,
      topDispensedDrugs: topDrugs,
      patientsSeenToday,
      averageWaitTimeMinutes,
      dailyRevenueTrend,
      monthlyRevenueTrend,
      waitTimeTrend
    });

  } catch (error) {
    console.error('Analytics fetch error:', error);
    return res.status(500).json({ error: 'Failed to fetch dashboard metrics.' });
  }
});

export default router;
