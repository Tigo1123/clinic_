import express from 'express';
import { createHash } from 'node:crypto';
import prisma from '../db.js';
import { authenticate, checkRoles } from '../middleware/auth.js';
import { allowRoles, ROLES } from '../middleware/policies.js';
import { sendError } from '../utils/apiError.js';
import { clinicDateSequence, clinicMonthBounds, getClinicDateString, instantToClinicDateString } from '../utils/clinicTime.js';
import { emitQueueUpdate } from '../utils/socketEvents.js';

const router = express.Router();

/**
 * POST /api/billing/invoice
 * Generates an itemized invoice.
 *
 * CONSULTATION invoices are derived from the appointment and the doctor's
 * configured consultation fee. Client-supplied consultation prices are ignored.
 */
router.post('/invoice', authenticate, allowRoles(ROLES.ADMIN, ROLES.RECEPTIONIST), async (req, res) => {
  const {
    patientId,
    appointmentId,
    labOrderId,
    prescriptionId,
    insuranceCompanyId,
    items,
    invoiceType = 'GENERAL'
  } = req.body;

  const normalizedInvoiceType =
    typeof invoiceType === 'string'
      ? invoiceType.trim().toUpperCase()
      : 'GENERAL';

  const allowedInvoiceTypes = [
    'GENERAL',
    'CONSULTATION',
    'LABORATORY',
    'PHARMACY'
  ];

  if (!allowedInvoiceTypes.includes(normalizedInvoiceType)) {
    return sendError(res, 422, 'INVALID_INVOICE_TYPE', 'Unsupported invoice type.');
  }

  if (!patientId) {
    return sendError(res, 400, 'PATIENT_ID_REQUIRED', 'Patient ID is required.');
  }

  if (
    !['CONSULTATION', 'LABORATORY', 'PHARMACY'].includes(normalizedInvoiceType) &&
    (!Array.isArray(items) || items.length === 0)
  ) {
    return sendError(
      res,
      400,
      'INVOICE_ITEMS_REQUIRED',
      'At least one invoice item is required.'
    );
  }

  try {
    const lockedExchangeRate = 1500.00;

    let resolvedItems = items;
    let resolvedAppointmentId = appointmentId || null;
    let resolvedLabOrderId = null;
    let resolvedPrescriptionId = null;

    if (normalizedInvoiceType === 'CONSULTATION') {
      if (!appointmentId) {
        return sendError(
          res,
          422,
          'CONSULTATION_APPOINTMENT_REQUIRED',
          'Consultation billing requires an appointment.'
        );
      }

      const appointment = await prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: { doctor: true }
      });

      if (!appointment) {
        return sendError(
          res,
          404,
          'APPOINTMENT_NOT_FOUND',
          'Appointment not found.'
        );
      }

      if (appointment.patientId !== patientId) {
        return sendError(
          res,
          409,
          'CONSULTATION_PATIENT_MISMATCH',
          'The invoice patient does not match the appointment patient.'
        );
      }

      if (appointment.status !== 'CHECKED_IN') {
        return sendError(
          res,
          409,
          'CONSULTATION_BILLING_INVALID_STATE',
          'Consultation billing is available after patient check-in.'
        );
      }

      const consultationFee = Number(appointment.doctor?.consultationFee);

      if (!Number.isFinite(consultationFee) || consultationFee <= 0) {
        return sendError(
          res,
          409,
          'CONSULTATION_FEE_NOT_CONFIGURED',
          'The doctor consultation fee is not configured correctly.'
        );
      }

      // Security: never trust a consultation price supplied by the browser.
      resolvedItems = [{
        descriptionAr: `كشف طبي - د. ${appointment.doctor.fullNameAr}`,
        descriptionEn: `Consultation - Dr. ${appointment.doctor.fullNameEn}`,
        qty: 1,
        unitPriceSdg: consultationFee
      }];
    } else if (normalizedInvoiceType === 'LABORATORY') {
      if (typeof labOrderId !== 'string' || !labOrderId.trim()) {
        return sendError(
          res,
          422,
          'LAB_ORDER_REQUIRED',
          'Laboratory billing requires a lab order.'
        );
      }

      const requestedLabOrderId = labOrderId.trim();

      const labOrder = await prisma.labOrder.findUnique({
        where: { id: requestedLabOrderId },
        include: {
          medicalRecord: {
            select: {
              appointmentId: true
            }
          },
          items: {
            include: {
              service: true
            }
          }
        }
      });

      if (!labOrder) {
        return sendError(
          res,
          404,
          'LAB_ORDER_NOT_FOUND',
          'Laboratory order not found.'
        );
      }

      if (labOrder.patientId !== patientId) {
        return sendError(
          res,
          409,
          'LAB_ORDER_PATIENT_MISMATCH',
          'The invoice patient does not match the laboratory order patient.'
        );
      }

      if (!['PENDING_BILLING', 'PAID'].includes(labOrder.status)) {
        return sendError(
          res,
          409,
          'LAB_BILLING_INVALID_STATE',
          'This laboratory order can no longer be billed.'
        );
      }

      if (!labOrder.items.length) {
        return sendError(
          res,
          409,
          'LAB_ORDER_EMPTY',
          'The laboratory order does not contain billable tests.'
        );
      }

      const unpricedCustomItem = labOrder.items.find(
        (item) => !item.serviceId || !item.service
      );

      if (unpricedCustomItem) {
        return sendError(
          res,
          409,
          'LAB_CUSTOM_TEST_PRICING_REQUIRED',
          'Custom laboratory tests require an approved catalogue price before billing.'
        );
      }

      const invalidService = labOrder.items.find(
        (item) =>
          !['LABORATORY', 'RADIOLOGY'].includes(item.service.category)
      );

      if (invalidService) {
        return sendError(
          res,
          409,
          'LAB_ORDER_SERVICE_INVALID',
          'The laboratory order contains a service that cannot be billed as a diagnostic test.'
        );
      }

      const invalidPrice = labOrder.items.find((item) => {
        const price = Number(item.service.baseFeeSdg);
        return !Number.isFinite(price) || price <= 0;
      });

      if (invalidPrice) {
        return sendError(
          res,
          409,
          'LAB_SERVICE_PRICE_NOT_CONFIGURED',
          'One or more ordered tests do not have a valid configured price.'
        );
      }

      resolvedLabOrderId = labOrder.id;
      resolvedAppointmentId =
        labOrder.medicalRecord?.appointmentId || null;

      // Security: diagnostic prices always come from ClinicalService,
      // never from browser-supplied invoice items.
      resolvedItems = labOrder.items.map((item) => ({
        descriptionAr: item.service.labelAr,
        descriptionEn: item.service.labelEn,
        qty: 1,
        unitPriceSdg: Number(item.service.baseFeeSdg)
      }));
    } else if (normalizedInvoiceType === 'PHARMACY') {
      if (typeof prescriptionId !== 'string' || !prescriptionId.trim()) {
        return sendError(
          res,
          422,
          'PHARMACY_PRESCRIPTION_REQUIRED',
          'Pharmacy billing requires a prescription.'
        );
      }

      const requestedPrescriptionId = prescriptionId.trim();

      const prescription = await prisma.prescription.findUnique({
        where: { id: requestedPrescriptionId },
        include: {
          medicalRecord: {
            select: {
              appointmentId: true
            }
          },
          prescribedDrugs: {
            include: {
              drug: true
            }
          }
        }
      });

      if (!prescription) {
        return sendError(
          res,
          404,
          'PHARMACY_PRESCRIPTION_NOT_FOUND',
          'Prescription not found.'
        );
      }

      if (prescription.patientId !== patientId) {
        return sendError(
          res,
          409,
          'PHARMACY_PRESCRIPTION_PATIENT_MISMATCH',
          'The invoice patient does not match the prescription patient.'
        );
      }

      if (!['ACTIVE', 'PARTIALLY_FILLED'].includes(prescription.status)) {
        return sendError(
          res,
          409,
          'PHARMACY_BILLING_INVALID_STATE',
          'This prescription can no longer be billed.'
        );
      }

      const billableDrugs = prescription.prescribedDrugs
        .filter((item) => item.drugId && item.drug)
        .map((item) => ({
          item,
          remainingQty:
            Number(item.qtyPrescribed) - Number(item.qtyDispensed)
        }))
        .filter(({ remainingQty }) => remainingQty > 0);

      if (!billableDrugs.length) {
        return sendError(
          res,
          409,
          'PHARMACY_NO_BILLABLE_ITEMS',
          'The prescription does not contain remaining formulary medications that can be billed.'
        );
      }

      const unpricedDrug = billableDrugs.find(({ item }) => {
        const price = Number(item.drug.unitPriceSdg);
        return !Number.isFinite(price) || price <= 0;
      });

      if (unpricedDrug) {
        return sendError(
          res,
          409,
          'PHARMACY_PRICE_NOT_CONFIGURED',
          'One or more prescribed medications do not have a valid configured pharmacy price.'
        );
      }

      resolvedPrescriptionId = prescription.id;
      resolvedAppointmentId =
        prescription.medicalRecord?.appointmentId || null;

      // Security: pharmacy prices and quantities are derived from the
      // prescription and DrugFormulary, never browser-supplied invoice items.
      resolvedItems = billableDrugs.map(({ item, remainingQty }) => ({
        descriptionAr: item.drug.labelAr,
        descriptionEn: item.drug.labelEn,
        qty: remainingQty,
        unitPriceSdg: Number(item.drug.unitPriceSdg)
      }));
    }

    let totalSdg = 0;

    const invoiceItemsData = resolvedItems.map((item) => {
      const priceSdg = Number(item.unitPriceSdg);
      const qty = Number(item.qty);

      if (
        !Number.isFinite(priceSdg) ||
        priceSdg <= 0 ||
        !Number.isInteger(qty) ||
        qty <= 0
      ) {
        throw Object.assign(
          new Error('Invoice quantities and prices must be positive values.'),
          { status: 422, code: 'INVALID_INVOICE_ITEM' }
        );
      }

      totalSdg += priceSdg * qty;

      return {
        descriptionAr: item.descriptionAr,
        descriptionEn: item.descriptionEn,
        qty,
        unitPriceSdg: priceSdg,
        unitPriceUsd: priceSdg / lockedExchangeRate
      };
    });

    const totalUsd = totalSdg / lockedExchangeRate;

    const runCreateTransaction = () =>
      prisma.$transaction(async (tx) => {
        // Repeated consultation checkout must not create another invoice.
        if (normalizedInvoiceType === 'CONSULTATION') {
          const existingInvoice = await tx.invoice.findFirst({
            where: {
              appointmentId: resolvedAppointmentId,
              invoiceType: 'CONSULTATION'
            },
            include: {
              items: true,
              insuranceClaim: true
            }
          });

          if (existingInvoice) {
            const claimAmount = existingInvoice.insuranceClaim
              ? Number(existingInvoice.insuranceClaim.claimAmountSdg)
              : 0;

            return {
              invoice: existingInvoice,
              insuranceClaim: existingInvoice.insuranceClaim || null,
              patientShareSdg: Math.max(
                0,
                Number(existingInvoice.totalAmountSdg) - claimAmount
              ),
              existing: true
            };
          }
        }

        // Repeated laboratory checkout must not create another invoice
        // for the same LabOrder.
        if (normalizedInvoiceType === 'LABORATORY') {
          const existingInvoice = await tx.invoice.findFirst({
            where: {
              labOrderId: resolvedLabOrderId,
              invoiceType: 'LABORATORY',
              paymentStatus: {
                not: 'REFUNDED'
              }
            },
            include: {
              items: true,
              insuranceClaim: true
            },
            orderBy: {
              invoiceDate: 'desc'
            }
          });

          if (existingInvoice) {
            const claimAmount = existingInvoice.insuranceClaim
              ? Number(existingInvoice.insuranceClaim.claimAmountSdg)
              : 0;

            return {
              invoice: existingInvoice,
              insuranceClaim: existingInvoice.insuranceClaim || null,
              patientShareSdg: Math.max(
                0,
                Number(existingInvoice.totalAmountSdg) - claimAmount
              ),
              existing: true
            };
          }
        }

        // Repeated pharmacy checkout must reuse the newest active invoice
        // linked to the same prescription.
        if (normalizedInvoiceType === 'PHARMACY') {
          const existingInvoice = await tx.invoice.findFirst({
            where: {
              prescriptionId: resolvedPrescriptionId,
              invoiceType: 'PHARMACY',
              paymentStatus: {
                not: 'REFUNDED'
              }
            },
            include: {
              items: true,
              insuranceClaim: true
            },
            orderBy: {
              invoiceDate: 'desc'
            }
          });

          if (existingInvoice) {
            const claimAmount = existingInvoice.insuranceClaim
              ? Number(existingInvoice.insuranceClaim.claimAmountSdg)
              : 0;

            return {
              invoice: existingInvoice,
              insuranceClaim: existingInvoice.insuranceClaim || null,
              patientShareSdg: Math.max(
                0,
                Number(existingInvoice.totalAmountSdg) - claimAmount
              ),
              existing: true
            };
          }
        }

        let insuranceClaim = null;
        let patientShareSdg = totalSdg;

        const invoice = await tx.invoice.create({
          data: {
            patientId,
            appointmentId: resolvedAppointmentId,
            labOrderId: resolvedLabOrderId,
            prescriptionId: resolvedPrescriptionId,
            invoiceType: normalizedInvoiceType,
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
            const copayFactor = Number(company.copayPercentage) / 100;
            patientShareSdg = totalSdg * copayFactor;
            const claimAmountSdg = totalSdg - patientShareSdg;

            insuranceClaim = await tx.insuranceClaim.create({
              data: {
                insuranceCompanyId,
                patientId,
                invoiceId: invoice.id,
                claimAmountSdg,
                claimStatus: 'DRAFT'
              }
            });

            await tx.invoice.update({
              where: { id: invoice.id },
              data: { insuranceClaimId: insuranceClaim.id }
            });
          }
        }

        return {
          invoice,
          insuranceClaim,
          patientShareSdg,
          existing: false
        };
      }, {
        isolationLevel: 'Serializable',
        maxWait: 5000,
        timeout: 10000
      });

    let result;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        result = await runCreateTransaction();
        break;
      } catch (error) {
        const contention =
          ['P2028', 'P2034'].includes(error.code) ||
          /serialization|write conflict|deadlock/i.test(error.message || '');

        if (!contention || attempt === 2) throw error;

        await new Promise((resolve) =>
          setTimeout(resolve, 20 * (attempt + 1))
        );
      }
    }

    return res.status(result.existing ? 200 : 201).json(result);

  } catch (error) {
    if (error.status && error.code) {
      return sendError(res, error.status, error.code, error.message);
    }

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

      if (
        invoice.invoiceType === 'LABORATORY' &&
        invoice.labOrderId &&
        invoiceStatus === 'PAID'
      ) {
        const unlocked = await tx.labOrder.updateMany({
          where: {
            id: invoice.labOrderId,
            status: 'PENDING_BILLING'
          },
          data: {
            status: 'PAID'
          }
        });

        if (unlocked.count === 0) {
          const currentLabOrder = await tx.labOrder.findUnique({
            where: { id: invoice.labOrderId },
            select: { status: true }
          });

          if (!currentLabOrder) {
            throw Object.assign(
              new Error('Laboratory order linked to this invoice no longer exists.'),
              { status: 409, code: 'LAB_ORDER_NOT_FOUND' }
            );
          }

          if (
            !['PAID', 'SAMPLE_COLLECTED', 'COMPLETED'].includes(
              currentLabOrder.status
            )
          ) {
            throw Object.assign(
              new Error('Laboratory order could not be unlocked after payment.'),
              { status: 409, code: 'LAB_PAYMENT_STATE_CONFLICT' }
            );
          }
        }
      }

      return {
        ...updatedInvoice,
        totalPaidSdg: resultingPaidSdg,
        remainingBalanceSdg: Math.max(
          0,
          invoiceTotal - resultingPaidSdg
        )
      };
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

    if (result.invoiceType === 'CONSULTATION' && result.appointmentId) {
      const appointment = await prisma.appointment.findUnique({
        where: { id: result.appointmentId },
        select: { doctorId: true }
      });

      if (appointment) {
        const io = req.app.get('io');

        emitQueueUpdate(
          io,
          {
            type: 'CONSULTATION_PAYMENT_UPDATE',
            appointmentId: result.appointmentId,
            paymentStatus: result.paymentStatus,
            doctorId: appointment.doctorId
          },
          [appointment.doctorId]
        );
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
    if (invoice.appointment && invoice.invoiceType !== 'LABORATORY') {
      const activeStatus = invoice.appointment.status;
      if (['IN_CONSULTATION', 'COMPLETED'].includes(activeStatus)) {
        return res.status(403).json({
          error: 'Refund locked. The patient has already entered consultation or finished their visit.'
        });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const financial = await tx.invoice.findUnique({
        where: { id: invoice.id },
        include: {
          payments: true,
          refunds: true,
          labOrder: true
        }
      });

      const paidSdg = financial.payments.reduce(
        (sum, payment) => sum + Number(payment.amountSdg),
        0
      );
      const previouslyRefundedSdg = financial.refunds.reduce((sum, refund) => sum + Number(refund.amountSdg), 0);
      const refundableSdg = paidSdg - previouslyRefundedSdg;
      if (paidSdg <= 0) {
        throw Object.assign(
          new Error('No paid funds are available to refund.'),
          { status: 409, code: 'NO_PAID_FUNDS' }
        );
      }

      if (amountSdg > refundableSdg + 0.001) {
        throw Object.assign(
          new Error('Refund exceeds the paid amount still available.'),
          { status: 409, code: 'REFUND_EXCEEDS_PAID_AMOUNT' }
        );
      }

      if (financial.invoiceType === 'LABORATORY') {
        if (!financial.labOrderId || !financial.labOrder) {
          throw Object.assign(
            new Error('Laboratory invoice is not linked to a laboratory order.'),
            { status: 409, code: 'LAB_ORDER_NOT_FOUND' }
          );
        }

        if (financial.labOrder.status === 'SAMPLE_COLLECTED') {
          throw Object.assign(
            new Error(
              'Laboratory payment cannot be refunded after sample collection has started.'
            ),
            { status: 409, code: 'LAB_SERVICE_ALREADY_STARTED' }
          );
        }

        if (financial.labOrder.status === 'COMPLETED') {
          throw Object.assign(
            new Error(
              'Laboratory payment cannot be refunded after laboratory work has been completed.'
            ),
            { status: 409, code: 'LAB_SERVICE_ALREADY_COMPLETED' }
          );
        }

        // The current ledger intentionally prevents additional payments after
        // any refund. A partial laboratory refund would therefore strand the
        // order in an unpayable state. Require reversal of all currently
        // collected funds instead.
        if (Math.abs(amountSdg - refundableSdg) > 0.001) {
          throw Object.assign(
            new Error(
              'Laboratory refunds must reverse the full refundable amount before sample collection.'
            ),
            { status: 409, code: 'LAB_PARTIAL_REFUND_NOT_SUPPORTED' }
          );
        }

        // Atomically relock laboratory work. This also races safely against
        // sample collection: whichever transition wins prevents the other.
        const relocked = await tx.labOrder.updateMany({
          where: {
            id: financial.labOrderId,
            status: {
              in: ['PENDING_BILLING', 'PAID']
            }
          },
          data: {
            status: 'PENDING_BILLING'
          }
        });

        if (relocked.count !== 1) {
          const currentLabOrder = await tx.labOrder.findUnique({
            where: { id: financial.labOrderId },
            select: { status: true }
          });

          if (currentLabOrder?.status === 'SAMPLE_COLLECTED') {
            throw Object.assign(
              new Error(
                'Laboratory payment cannot be refunded after sample collection has started.'
              ),
              { status: 409, code: 'LAB_SERVICE_ALREADY_STARTED' }
            );
          }

          if (currentLabOrder?.status === 'COMPLETED') {
            throw Object.assign(
              new Error(
                'Laboratory payment cannot be refunded after laboratory work has been completed.'
              ),
              { status: 409, code: 'LAB_SERVICE_ALREADY_COMPLETED' }
            );
          }

          throw Object.assign(
            new Error('Laboratory order is not in a refundable state.'),
            { status: 409, code: 'LAB_REFUND_INVALID_STATE' }
          );
        }
      }

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
 * GET /api/billing/lab-orders/pending
 * Reception/admin billing queue for laboratory orders.
 *
 * Financial totals are derived on the server. Fully refunded invoices are
 * historical and do not block a new laboratory invoice.
 */
router.get(
  '/lab-orders/pending',
  authenticate,
  allowRoles(ROLES.ADMIN, ROLES.RECEPTIONIST),
  async (req, res) => {
    try {
      const orders = await prisma.labOrder.findMany({
        where: {
          status: {
            in: ['PENDING_BILLING', 'PAID']
          }
        },
        include: {
          patient: {
            select: {
              id: true,
              fullNameAr: true,
              fullNameEn: true,
              phone: true
            }
          },
          doctor: {
            select: {
              id: true,
              fullNameAr: true,
              fullNameEn: true
            }
          },
          medicalRecord: {
            select: {
              appointmentId: true
            }
          },
          items: {
            include: {
              service: true
            }
          },
          invoices: {
            where: {
              invoiceType: 'LABORATORY',
              paymentStatus: {
                not: 'REFUNDED'
              }
            },
            include: {
              payments: true,
              refunds: true
            },
            orderBy: {
              invoiceDate: 'desc'
            },
            take: 1
          }
        },
        orderBy: {
          orderDate: 'desc'
        }
      });

      const queue = orders.map((order) => {
        const invoice = order.invoices[0] || null;

        const estimatedTotalSdg = order.items.reduce((sum, item) => {
          const price = Number(item.service?.baseFeeSdg);
          return Number.isFinite(price) ? sum + price : sum;
        }, 0);

        const pricingRequired = order.items.some(
          (item) => !item.service
        );

        let totalPaidSdg = 0;
        let refundedSdg = 0;
        let remainingBalanceSdg = estimatedTotalSdg;

        if (invoice) {
          totalPaidSdg = invoice.payments.reduce(
            (sum, payment) => sum + Number(payment.amountSdg),
            0
          );

          refundedSdg = invoice.refunds.reduce(
            (sum, refund) => sum + Number(refund.amountSdg),
            0
          );

          const netCollectedSdg = Math.max(
            0,
            totalPaidSdg - refundedSdg
          );

          remainingBalanceSdg = Math.max(
            0,
            Number(invoice.totalAmountSdg) - netCollectedSdg
          );
        }

        return {
          id: order.id,
          orderDate: order.orderDate,
          status: order.status,
          appointmentId: order.medicalRecord?.appointmentId || null,
          patient: order.patient,
          doctor: order.doctor,

          items: order.items.map((item) => ({
            id: item.id,
            customTestName: item.customTestName,
            service: item.service
              ? {
                  id: item.service.id,
                  labelAr: item.service.labelAr,
                  labelEn: item.service.labelEn,
                  category: item.service.category,
                  baseFeeSdg: Number(item.service.baseFeeSdg)
                }
              : null
          })),

          pricingRequired,
          estimatedTotalSdg,

          billingStatus: invoice
            ? invoice.paymentStatus
            : 'UNBILLED',

          invoice: invoice
            ? {
                id: invoice.id,
                paymentStatus: invoice.paymentStatus,
                totalAmountSdg: Number(invoice.totalAmountSdg),
                totalPaidSdg,
                refundedSdg,
                remainingBalanceSdg
              }
            : null
        };
      });

      return res.json(queue);
    } catch (error) {
      console.error(
        'Fetch laboratory billing queue error:',
        error
      );

      return sendError(
        res,
        500,
        'LAB_BILLING_QUEUE_FAILED',
        'Failed to retrieve laboratory billing queue.'
      );
    }
  }
);

/**
 * GET /api/billing/prescriptions/pending
 * Reception/admin financial queue for active clinic pharmacy prescriptions.
 *
 * Prices are derived from DrugFormulary. Custom/free-text medications are
 * reported for visibility but are never automatically priced.
 */
router.get(
  '/prescriptions/pending',
  authenticate,
  allowRoles(ROLES.ADMIN, ROLES.RECEPTIONIST),
  async (req, res) => {
    try {
      const prescriptions = await prisma.prescription.findMany({
        where: {
          status: {
            in: ['ACTIVE', 'PARTIALLY_FILLED']
          }
        },
        include: {
          patient: {
            select: {
              id: true,
              fullNameAr: true,
              fullNameEn: true,
              phone: true
            }
          },
          doctor: {
            select: {
              id: true,
              fullNameAr: true,
              fullNameEn: true
            }
          },
          medicalRecord: {
            select: {
              appointmentId: true
            }
          },
          prescribedDrugs: {
            include: {
              drug: {
                select: {
                  id: true,
                  labelAr: true,
                  labelEn: true,
                  genericName: true,
                  strength: true,
                  dosageForm: true,
                  unitPriceSdg: true
                }
              }
            }
          },
          invoices: {
            where: {
              invoiceType: 'PHARMACY',
              paymentStatus: {
                not: 'REFUNDED'
              }
            },
            include: {
              payments: true,
              refunds: true
            },
            orderBy: {
              invoiceDate: 'desc'
            },
            take: 1
          }
        },
        orderBy: {
          prescriptionDate: 'desc'
        }
      });

      const queue = prescriptions.map((prescription) => {
        const invoice = prescription.invoices[0] || null;

        const mappedItems = prescription.prescribedDrugs.map((item) => {
          const remainingQty = Math.max(
            0,
            Number(item.qtyPrescribed) - Number(item.qtyDispensed)
          );

          return {
            id: item.id,
            drugId: item.drugId,
            customDrugName: item.customDrugName,
            qtyPrescribed: item.qtyPrescribed,
            qtyDispensed: item.qtyDispensed,
            remainingQty,
            drug: item.drug
              ? {
                  id: item.drug.id,
                  labelAr: item.drug.labelAr,
                  labelEn: item.drug.labelEn,
                  genericName: item.drug.genericName,
                  strength: item.drug.strength,
                  dosageForm: item.drug.dosageForm,
                  unitPriceSdg:
                    item.drug.unitPriceSdg == null
                      ? null
                      : Number(item.drug.unitPriceSdg)
                }
              : null
          };
        });

        const billableItems = mappedItems.filter(
          (item) =>
            item.drugId &&
            item.drug &&
            item.remainingQty > 0
        );

        const pricingRequired = billableItems.some((item) => {
          const price = Number(item.drug.unitPriceSdg);
          return !Number.isFinite(price) || price <= 0;
        });

        const estimatedTotalSdg = billableItems.reduce(
          (sum, item) => {
            const price = Number(item.drug.unitPriceSdg);

            if (!Number.isFinite(price) || price <= 0) {
              return sum;
            }

            return sum + (price * item.remainingQty);
          },
          0
        );

        let totalPaidSdg = 0;
        let refundedSdg = 0;
        let remainingBalanceSdg = estimatedTotalSdg;

        if (invoice) {
          totalPaidSdg = invoice.payments.reduce(
            (sum, payment) => sum + Number(payment.amountSdg),
            0
          );

          refundedSdg = invoice.refunds.reduce(
            (sum, refund) => sum + Number(refund.amountSdg),
            0
          );

          const netCollectedSdg = Math.max(
            0,
            totalPaidSdg - refundedSdg
          );

          remainingBalanceSdg = Math.max(
            0,
            Number(invoice.totalAmountSdg) - netCollectedSdg
          );
        }

        return {
          id: prescription.id,
          prescriptionDate: prescription.prescriptionDate,
          status: prescription.status,
          appointmentId:
            prescription.medicalRecord?.appointmentId || null,

          patient: prescription.patient,
          doctor: prescription.doctor,
          items: mappedItems,

          customMedicationCount: mappedItems.filter(
            (item) => !item.drugId
          ).length,

          automaticBillingAvailable: billableItems.length > 0,
          pricingRequired,
          estimatedTotalSdg,

          billingStatus: invoice
            ? invoice.paymentStatus
            : 'UNBILLED',

          invoice: invoice
            ? {
                id: invoice.id,
                paymentStatus: invoice.paymentStatus,
                totalAmountSdg: Number(invoice.totalAmountSdg),
                totalPaidSdg,
                refundedSdg,
                remainingBalanceSdg
              }
            : null
        };
      });

      return res.json(queue);
    } catch (error) {
      console.error(
        'Fetch pharmacy billing queue error:',
        error
      );

      return sendError(
        res,
        500,
        'PHARMACY_BILLING_QUEUE_FAILED',
        'Failed to retrieve pharmacy billing queue.'
      );
    }
  }
);

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
