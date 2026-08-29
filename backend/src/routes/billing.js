import express from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import prisma from '../db.js';
import { authenticate, checkRoles } from '../middleware/auth.js';
import { allowRoles, ROLES } from '../middleware/policies.js';
import { validate } from '../middleware/validate.js';
import { sendError } from '../utils/apiError.js';
import { clinicDateSequence, clinicMonthBounds, getClinicDateString, instantToClinicDateString } from '../utils/clinicTime.js';
import { emitQueueUpdate } from '../utils/socketEvents.js';

const router = express.Router();
const MAX_MONEY_SDG = 1_000_000_000;
const MAX_GENERAL_QUANTITY = 100;
const MAX_GENERAL_INVOICE_ITEMS = 100;
const MAX_INVOICE_QUANTITY = 10_000;
const PAYMENT_METHODS = ['CASH', 'CARD', 'BANKAK', 'FAWRY'];
const paymentRequestSchema = z.object({
  payments: z.array(z.object({
    amountSdg: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    paymentMethod: z.enum(PAYMENT_METHODS),
    transactionReference: z.string().trim().min(1).max(200)
      .regex(/^[^\u0000-\u001F\u007F]+$/).nullable().optional()
  }).strict()).min(1).max(100)
}).strict();
const paymentInvoiceParamsSchema = z.object({ id: z.string().uuid() }).strict();
const insurancePreviewSchema = z.object({
  patientId: z.string().uuid(),
  insuranceCompanyId: z.string().uuid().nullable().optional(),
  invoiceType: z.enum(['GENERAL', 'CONSULTATION']),
  appointmentId: z.string().uuid().nullable().optional(),
  items: z.array(z.object({
    serviceId: z.string().uuid(),
    quantity: z.number().int().positive().max(MAX_GENERAL_QUANTITY)
  }).strict()).max(MAX_GENERAL_INVOICE_ITEMS).optional()
}).strict();
const INVOICE_REQUEST_FIELDS = new Set([
  'patientId', 'appointmentId', 'labOrderId', 'prescriptionId',
  'insuranceCompanyId', 'items', 'invoiceType'
]);

function isConfiguredPrice(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 && amount <= MAX_MONEY_SDG;
}

function configuredPriceOrNull(value) {
  if (value == null) return null;
  const amount = Number(value);
  return isConfiguredPrice(amount) ? amount : null;
}

function percentageBasisPoints(value) {
  const normalized = String(value).trim();
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(basisPoints) && basisPoints >= 0 && basisPoints <= 10_000
    ? basisPoints
    : null;
}

function calculateInsuranceAmounts(totalSdg, company) {
  if (!company) {
    return {
      grossTotalSdg: totalSdg,
      insuranceCoverageSdg: 0,
      patientShareSdg: totalSdg,
      copayPercentage: null
    };
  }
  const basisPoints = percentageBasisPoints(company.copayPercentage);
  if (basisPoints == null) {
    throw Object.assign(new Error('The selected insurance company has an invalid patient contribution configuration.'), {
      status: 409,
      code: 'INSURANCE_CONFIGURATION_INVALID'
    });
  }
  const patientShareSdg = Number(
    (BigInt(totalSdg) * BigInt(basisPoints) + 5_000n) / 10_000n
  );
  return {
    grossTotalSdg: totalSdg,
    insuranceCoverageSdg: totalSdg - patientShareSdg,
    patientShareSdg,
    copayPercentage: Number(company.copayPercentage)
  };
}

function invoicePatientLiability(invoice) {
  const grossTotalSdg = Number(invoice.totalAmountSdg);
  const insuranceCoverageSdg = invoice.insuranceClaim
    ? Number(invoice.insuranceClaim.claimAmountSdg)
    : 0;
  return {
    grossTotalSdg,
    insuranceCoverageSdg,
    patientShareSdg: Math.max(0, grossTotalSdg - insuranceCoverageSdg)
  };
}

function paymentRoleAllowed(role, invoiceType) {
  if (invoiceType === 'PHARMACY') return role === ROLES.PHARMACIST;
  return role === ROLES.ADMIN || role === ROLES.RECEPTIONIST;
}

function isUniqueViolationFor(error, fieldName, constraintName) {
  if (error?.code !== 'P2002') return false;
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.length === 1
      && String(target[0]).toLowerCase() === fieldName.toLowerCase();
  }
  if (typeof target !== 'string') return false;
  const normalized = target.replace(/["'`\s]/g, '').toLowerCase();
  const normalizedConstraint = constraintName.toLowerCase();
  return normalized === fieldName.toLowerCase()
    || normalized === normalizedConstraint
    || normalized.endsWith(`.${normalizedConstraint}`);
}

/**
 * POST /api/billing/insurance-preview
 * Server-authoritative pre-issuance preview. The persisted invoice repeats
 * the calculation inside its own transaction and never trusts these values.
 */
router.post('/insurance-preview', authenticate, allowRoles(ROLES.ADMIN, ROLES.RECEPTIONIST), validate(insurancePreviewSchema), async (req, res) => {
  try {
    const { patientId, insuranceCompanyId, invoiceType, appointmentId, items = [] } = req.body;
    const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { id: true, status: true } });
    if (!patient) return sendError(res, 404, 'PATIENT_NOT_FOUND', 'Patient was not found.');
    if (patient.status !== 'ACTIVE') return sendError(res, 409, 'PATIENT_NOT_ACTIVE', 'Billing requires an active patient record.');

    let grossTotalSdg = 0;
    if (invoiceType === 'CONSULTATION') {
      if (!appointmentId) return sendError(res, 422, 'CONSULTATION_APPOINTMENT_REQUIRED', 'Consultation billing requires an appointment.');
      const appointment = await prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: { doctor: { select: { consultationFee: true, status: true } } }
      });
      if (!appointment) return sendError(res, 404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found.');
      if (appointment.patientId !== patientId) return sendError(res, 409, 'CONSULTATION_PATIENT_MISMATCH', 'The invoice patient does not match the appointment patient.');
      const fee = Number(appointment.doctor?.consultationFee);
      if (appointment.doctor?.status !== 'ACTIVE' || !isConfiguredPrice(fee)) {
        return sendError(res, 409, 'CONSULTATION_FEE_NOT_CONFIGURED', 'The doctor consultation fee is not configured correctly.');
      }
      grossTotalSdg = fee;
    } else {
      if (!items.length) return sendError(res, 422, 'INVOICE_ITEMS_REQUIRED', 'At least one invoice item is required.');
      const serviceIds = [...new Set(items.map((item) => item.serviceId))];
      const services = await prisma.clinicalService.findMany({
        where: { id: { in: serviceIds } },
        select: { id: true, baseFeeSdg: true, status: true }
      });
      const byId = new Map(services.map((service) => [service.id, service]));
      for (const item of items) {
        const service = byId.get(item.serviceId);
        if (!service || service.status !== 'ACTIVE') return sendError(res, 404, 'SERVICE_NOT_AVAILABLE', 'The selected active clinical service was not found.');
        const price = Number(service.baseFeeSdg);
        if (!isConfiguredPrice(price)) return sendError(res, 409, 'SERVICE_PRICE_NOT_CONFIGURED', 'The selected service does not have a valid configured price.');
        const lineTotal = price * item.quantity;
        if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(grossTotalSdg + lineTotal)) {
          return sendError(res, 422, 'INVOICE_TOTAL_INVALID', 'Invoice total exceeds the supported financial range.');
        }
        grossTotalSdg += lineTotal;
      }
    }

    let company = null;
    if (insuranceCompanyId) {
      company = await prisma.insuranceCompany.findUnique({ where: { id: insuranceCompanyId } });
      if (!company) return sendError(res, 422, 'INSURANCE_COMPANY_INVALID', 'The selected insurance company is not available.');
    }
    return res.json({
      ...calculateInsuranceAmounts(grossTotalSdg, company),
      insuranceCompany: company ? { id: company.id, labelAr: company.labelAr, labelEn: company.labelEn } : null,
      eligibilityModel: 'COMPANY_LEVEL_ONLY'
    });
  } catch (error) {
    if (error.status && error.code) return sendError(res, error.status, error.code, error.message);
    console.error('Insurance preview error:', error);
    return sendError(res, 500, 'INSURANCE_PREVIEW_FAILED', 'Unable to calculate insurance responsibility.');
  }
});

/**
 * POST /api/billing/invoice
 * Generates an itemized invoice.
 *
 * CONSULTATION invoices are derived from the appointment and the doctor's
 * configured consultation fee. Client-supplied consultation prices are ignored.
 */
router.post('/invoice', authenticate, allowRoles(ROLES.ADMIN, ROLES.RECEPTIONIST), async (req, res) => {
  const unexpectedFields = Object.keys(req.body || {}).filter((key) => !INVOICE_REQUEST_FIELDS.has(key));
  if (unexpectedFields.length) {
    return sendError(res, 422, 'INVOICE_FIELDS_INVALID', 'The invoice request contains unsupported fields.');
  }
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

  if (normalizedInvoiceType === 'PHARMACY') {
    return sendError(
      res,
      403,
      'PHARMACY_INVOICE_SYSTEM_OWNED',
      'Pharmacy invoices are created automatically by the system.'
    );
  }

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
  if (normalizedInvoiceType === 'GENERAL' && items.length > MAX_GENERAL_INVOICE_ITEMS) {
    return sendError(
      res,
      422,
      'GENERAL_INVOICE_ITEM_LIMIT_EXCEEDED',
      `General invoices may contain at most ${MAX_GENERAL_INVOICE_ITEMS} items.`
    );
  }

  try {
    const lockedExchangeRate = 1500.00;

    let resolvedItems;
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

      if (appointment.doctor?.status !== 'ACTIVE' || !isConfiguredPrice(consultationFee)) {
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

      const pendingReviewItem = labOrder.items.find(
        (item) => item.labReviewStatus === 'PENDING_REVIEW'
      );

      if (pendingReviewItem) {
        return sendError(
          res,
          409,
          'LAB_REVIEW_PENDING',
          'A laboratory test requires review and pricing before the invoice can be issued.'
        );
      }

      const billableLabItems = labOrder.items.filter(
        (item) => item.labReviewStatus !== 'EXTERNAL'
      );

      if (!billableLabItems.length) {
        return sendError(res, 409, 'LAB_NO_BILLABLE_TESTS', 'This laboratory order contains only external tests and has no clinic charge.');
      }

      const unpricedCustomItem = billableLabItems.find(
        (item) => !item.serviceId || !item.service
      );

      if (unpricedCustomItem) {
        return sendError(res, 409, 'LAB_REVIEW_STATE_INVALID', 'A clinic-provided laboratory test is not linked to a catalogue service.');
      }

      const invalidService = billableLabItems.find(
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

      const invalidPrice = billableLabItems.find((item) => {
        const price = Number(item.service.baseFeeSdg);
        return item.service.status !== 'ACTIVE' || !isConfiguredPrice(price);
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
      resolvedItems = billableLabItems.map((item) => ({
        descriptionAr: item.service.labelAr,
        descriptionEn: item.service.labelEn,
        qty: 1,
        unitPriceSdg: Number(item.service.baseFeeSdg)
      }));
    } else {
      const invalidGeneralItem = items.find((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return true;
        if (Object.keys(item).sort().join(',') !== 'quantity,serviceId') return true;
        return typeof item.serviceId !== 'string'
          || !Number.isSafeInteger(item.quantity)
          || item.quantity <= 0
          || item.quantity > MAX_GENERAL_QUANTITY;
      });

      if (invalidGeneralItem) {
        return sendError(
          res,
          422,
          'GENERAL_INVOICE_ITEM_INVALID',
          'General invoice items require only a serviceId and a valid quantity.'
        );
      }

      const serviceIds = [...new Set(items.map((item) => item.serviceId))];
      const services = await prisma.clinicalService.findMany({
        where: { id: { in: serviceIds } },
        select: {
          id: true,
          labelAr: true,
          labelEn: true,
          baseFeeSdg: true,
          status: true
        }
      });
      const servicesById = new Map(services.map((catalogService) => [catalogService.id, catalogService]));

      const unavailableService = items.find((item) => {
        const catalogService = servicesById.get(item.serviceId);
        return !catalogService || catalogService.status !== 'ACTIVE';
      });
      if (unavailableService) {
        return sendError(res, 404, 'SERVICE_NOT_AVAILABLE', 'The selected active clinical service was not found.');
      }

      const unpricedService = items.find(
        (item) => !isConfiguredPrice(servicesById.get(item.serviceId).baseFeeSdg)
      );
      if (unpricedService) {
        return sendError(res, 409, 'SERVICE_PRICE_NOT_CONFIGURED', 'The selected service does not have a valid configured price.');
      }

      resolvedItems = items.map((item) => {
        const catalogService = servicesById.get(item.serviceId);
        return {
          descriptionAr: catalogService.labelAr,
          descriptionEn: catalogService.labelEn,
          qty: item.quantity,
          unitPriceSdg: Number(catalogService.baseFeeSdg)
        };
      });
    }

    let totalSdg = 0;

    const invoiceItemsData = resolvedItems.map((item) => {
      const priceSdg = Number(item.unitPriceSdg);
      const qty = Number(item.qty);

      if (
        !isConfiguredPrice(priceSdg) ||
        !Number.isInteger(qty) ||
        qty <= 0 ||
        qty > MAX_INVOICE_QUANTITY
      ) {
        throw Object.assign(
          new Error('Invoice quantities and prices must be positive values.'),
          { status: 422, code: 'INVALID_INVOICE_ITEM' }
        );
      }

      const lineTotalSdg = priceSdg * qty;
      if (!Number.isSafeInteger(lineTotalSdg) || lineTotalSdg < 0) {
        throw Object.assign(new Error('Invoice line total exceeds the supported financial range.'), {
          status: 422,
          code: 'INVOICE_LINE_TOTAL_INVALID'
        });
      }

      const nextTotalSdg = totalSdg + lineTotalSdg;
      if (!Number.isSafeInteger(nextTotalSdg) || nextTotalSdg < 0) {
        throw Object.assign(new Error('Invoice total exceeds the supported financial range.'), {
          status: 422,
          code: 'INVOICE_TOTAL_INVALID'
        });
      }
      totalSdg = nextTotalSdg;

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
            const grossTotalSdg = Number(existingInvoice.totalAmountSdg);

            return {
              invoice: existingInvoice,
              insuranceClaim: existingInvoice.insuranceClaim || null,
              grossTotalSdg,
              insuranceCoverageSdg: claimAmount,
              patientShareSdg: Math.max(0, grossTotalSdg - claimAmount),
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
            const grossTotalSdg = Number(existingInvoice.totalAmountSdg);

            return {
              invoice: existingInvoice,
              insuranceClaim: existingInvoice.insuranceClaim || null,
              grossTotalSdg,
              insuranceCoverageSdg: claimAmount,
              patientShareSdg: Math.max(0, grossTotalSdg - claimAmount),
              existing: true
            };
          }
        }

        const patient = await tx.patient.findUnique({ where: { id: patientId }, select: { id: true, status: true } });
        if (!patient) throw Object.assign(new Error('Patient was not found.'), { status: 404, code: 'PATIENT_NOT_FOUND' });
        if (patient.status !== 'ACTIVE') throw Object.assign(new Error('Billing requires an active patient record.'), { status: 409, code: 'PATIENT_NOT_ACTIVE' });

        let company = null;
        if (insuranceCompanyId) {
          company = await tx.insuranceCompany.findUnique({ where: { id: insuranceCompanyId } });
          if (!company) throw Object.assign(new Error('The selected insurance company is not available.'), { status: 422, code: 'INSURANCE_COMPANY_INVALID' });
        }
        const insuranceAmounts = calculateInsuranceAmounts(totalSdg, company);
        let insuranceClaim = null;
        const patientShareSdg = insuranceAmounts.patientShareSdg;

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

        if (company) {
          insuranceClaim = await tx.insuranceClaim.create({
            data: {
              insuranceCompanyId: company.id,
              patientId,
              invoiceId: invoice.id,
              claimAmountSdg: insuranceAmounts.insuranceCoverageSdg,
              claimStatus: 'DRAFT'
            }
          });

          await tx.invoice.update({
            where: { id: invoice.id },
            data: { insuranceClaimId: insuranceClaim.id }
          });
        }

        return {
          invoice,
          insuranceClaim,
          patientShareSdg,
          grossTotalSdg: insuranceAmounts.grossTotalSdg,
          insuranceCoverageSdg: insuranceAmounts.insuranceCoverageSdg,
          copayPercentage: insuranceAmounts.copayPercentage,
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
router.post('/invoice/:id/payments', authenticate,
  allowRoles(ROLES.ADMIN, ROLES.RECEPTIONIST, ROLES.PHARMACIST),
  validate(paymentInvoiceParamsSchema, 'params'), validate(paymentRequestSchema), async (req, res) => {
  const invoiceId = req.params.id;
  const { payments } = req.body; // Array of { amountSdg, paymentMethod, transactionReference }
  const idempotencyKey = req.get('Idempotency-Key')?.trim();

  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    return sendError(res, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required for payments.');
  }

  let requestHash;
  try {
    const normalizedPayments = payments.map((pay) => {
      const amount = Number(pay.amountSdg);
      return {
        amountSdg: amount,
        paymentMethod: pay.paymentMethod,
        transactionReference: pay.transactionReference?.trim() || null
      };
    });
    requestHash = createHash('sha256').update(JSON.stringify({ invoiceId, payments: normalizedPayments })).digest('hex');

    const runPaymentTransaction = () => prisma.$transaction(async (tx) => {
      const lockedActors = await tx.$queryRaw`
        SELECT "id" FROM "User" WHERE "id" = ${req.user.id} FOR SHARE
      `;
      if (lockedActors.length !== 1) {
        throw Object.assign(new Error('This session is no longer active.'), { status: 401, code: 'SESSION_REVOKED' });
      }
      const actor = await tx.user.findUnique({
        where: { id: req.user.id },
        select: { id: true, role: true, status: true, authVersion: true }
      });
      if (
        !actor
        || actor.status !== 'ACTIVE'
        || actor.role !== req.user.role
        || actor.authVersion !== req.user.av
      ) {
        throw Object.assign(new Error('This session is no longer active.'), { status: 401, code: 'SESSION_REVOKED' });
      }

      const lockedInvoices = await tx.$queryRaw`
        SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE
      `;
      if (lockedInvoices.length !== 1) {
        throw Object.assign(new Error('Invoice not found.'), { status: 404, code: 'INVOICE_NOT_FOUND' });
      }

      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          payments: true,
          refunds: true,
          insuranceClaim: true,
          prescription: { select: { id: true, patientId: true, status: true } }
        }
      });
      if (!invoice) throw Object.assign(new Error('Invoice not found.'), { status: 404, code: 'INVOICE_NOT_FOUND' });
      if (invoice.paymentStatus === 'VOIDED') {
        throw Object.assign(new Error('Payments cannot be added to a voided invoice.'), { status: 409, code: 'VOIDED_INVOICE_LOCKED' });
      }
      if (!paymentRoleAllowed(actor.role, invoice.invoiceType)) {
        throw Object.assign(
          new Error(invoice.invoiceType === 'PHARMACY'
            ? 'Pharmacy invoice payments must be recorded by a pharmacist.'
            : 'Pharmacists may record payments only for pharmacy invoices.'),
          { status: 403, code: 'INVOICE_PAYMENT_ROLE_FORBIDDEN' }
        );
      }
      if (invoice.invoiceType === 'PHARMACY' && (
        !invoice.prescriptionId
        || !invoice.prescription
        || invoice.prescription.patientId !== invoice.patientId
        || invoice.prescription.status === 'CANCELLED'
      )) {
        throw Object.assign(new Error('The pharmacy invoice is not linked to a valid prescription.'), {
          status: 409,
          code: 'PHARMACY_INVOICE_CONTEXT_INVALID'
        });
      }

      const priorOperation = await tx.paymentOperation.findUnique({ where: { idempotencyKey } });
      if (priorOperation) {
        if (priorOperation.invoiceId !== invoiceId || priorOperation.requestHash !== requestHash) {
          throw Object.assign(new Error('Idempotency key was already used for a different payment request.'), { status: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
        }
        const replayInvoice = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true, insuranceClaim: true } });
        const replayPaid = replayInvoice.payments.reduce((sum, payment) => sum + Number(payment.amountSdg), 0);
        const replayLiability = invoicePatientLiability(replayInvoice);
        return { ...replayInvoice, ...replayLiability, totalPaidSdg: replayPaid, remainingBalanceSdg: Math.max(0, replayLiability.patientShareSdg - replayPaid), idempotentReplay: true };
      }

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
      const liability = invoicePatientLiability(invoice);
      const patientShareSdg = liability.patientShareSdg;
      if (![priorPaidSdg, newPaidSdg, resultingPaidSdg, patientShareSdg].every(Number.isSafeInteger)) {
        throw Object.assign(new Error('Invoice payment values exceed the supported financial range.'), {
          status: 422,
          code: 'PAYMENT_AMOUNT_INVALID'
        });
      }
      if (priorPaidSdg >= patientShareSdg) {
        throw Object.assign(new Error('The invoice is already fully paid.'), { status: 409, code: 'INVOICE_ALREADY_PAID' });
      }
      if (resultingPaidSdg > patientShareSdg) {
        throw Object.assign(new Error('Payment exceeds the remaining invoice balance.'), { status: 409, code: 'PAYMENT_EXCEEDS_BALANCE' });
      }

      const claimed = await tx.invoice.updateMany({
        where: { id: invoiceId, ledgerVersion: invoice.ledgerVersion },
        data: { ledgerVersion: { increment: 1 } }
      });
      if (claimed.count !== 1) throw Object.assign(new Error('Invoice ledger changed; retry the payment.'), { status: 409, code: 'PAYMENT_LEDGER_CONFLICT', retryable: true });

      const operation = await tx.paymentOperation.create({ data: { invoiceId, idempotencyKey, requestHash, receivedBy: actor.id } });
      const createdPayments = [];
      for (const pay of normalizedPayments) {
        createdPayments.push(await tx.payment.create({ data: {
          invoiceId,
          amountSdg: pay.amountSdg,
          amountUsd: pay.amountSdg / Number(invoice.invoiceExchangeRate),
          paymentMethod: pay.paymentMethod,
          transactionReference: pay.transactionReference,
          verificationStatus: 'VERIFIED',
          receivedBy: actor.id,
          paymentOperationId: operation.id
        } }));
      }

      const invoiceStatus = resultingPaidSdg >= patientShareSdg ? 'PAID' : 'PARTIALLY_PAID';
      const updatedInvoice = await tx.invoice.update({
        where: { id: invoiceId },
        data: { paymentStatus: invoiceStatus },
        include: { payments: true }
      });

      await tx.tenantAuditLog.create({ data: {
        userId: actor.id,
        action: invoice.invoiceType === 'PHARMACY'
          ? 'PHARMACY_INVOICE_PAYMENT_RECORDED'
          : 'INVOICE_PAYMENT_RECORDED',
        details: JSON.stringify({
          invoiceId: invoice.id,
          invoiceType: invoice.invoiceType,
          paymentOperationId: operation.id,
          paymentIds: createdPayments.map((payment) => payment.id),
          amountSdg: newPaidSdg,
          paymentMethods: [...new Set(normalizedPayments.map((payment) => payment.paymentMethod))],
          resultingPaymentStatus: invoiceStatus,
          totalPaidSdg: resultingPaidSdg,
          patientShareSdg,
          insuranceCoverageSdg: liability.insuranceCoverageSdg,
          grossTotalSdg: liability.grossTotalSdg,
          remainingBalanceSdg: Math.max(0, patientShareSdg - resultingPaidSdg)
        }),
        ipAddress: req.ip || 'unknown'
      } });

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
        ...liability,
        totalPaidSdg: resultingPaidSdg,
        remainingBalanceSdg: Math.max(
          0,
          patientShareSdg - resultingPaidSdg
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
    if (isUniqueViolationFor(error, 'idempotencyKey', 'PaymentOperation_idempotencyKey_key')) {
      const priorOperation = await prisma.paymentOperation.findUnique({ where: { idempotencyKey } });
      if (priorOperation?.invoiceId === invoiceId && priorOperation.requestHash === requestHash) {
        const [replayInvoice, replayActor] = await Promise.all([
          prisma.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true, insuranceClaim: true } }),
          prisma.user.findUnique({ where: { id: req.user.id }, select: { role: true, status: true, authVersion: true } })
        ]);
        if (
          !replayInvoice
          || !replayActor
          || replayActor.status !== 'ACTIVE'
          || replayActor.role !== req.user.role
          || replayActor.authVersion !== req.user.av
          || !paymentRoleAllowed(replayActor.role, replayInvoice.invoiceType)
        ) {
          return sendError(res, 403, 'INVOICE_PAYMENT_ROLE_FORBIDDEN', 'You do not have permission to record this invoice payment.');
        }
        const replayPaid = replayInvoice.payments.reduce((sum, payment) => sum + Number(payment.amountSdg), 0);
        const replayLiability = invoicePatientLiability(replayInvoice);
        return res.json({ ...replayInvoice, ...replayLiability, totalPaidSdg: replayPaid, remainingBalanceSdg: Math.max(0, replayLiability.patientShareSdg - replayPaid), idempotentReplay: true });
      }
      return sendError(res, 409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key was already used for a different payment request.');
    }
    if (isUniqueViolationFor(error, 'transactionReference', 'Payment_transactionReference_key')) {
      return sendError(res, 409, 'DUPLICATE_PAYMENT_REFERENCE', 'Payment reference has already been used.');
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
          labOrder: true,
          insuranceClaim: true
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
        remainingBalanceSdg: Math.max(0, invoicePatientLiability(financial).patientShareSdg - (paidSdg - totalRefundedSdg))
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

        const billableItems = order.items.filter((item) => item.labReviewStatus !== 'EXTERNAL');
        const estimatedTotalSdg = billableItems.reduce((sum, item) => {
          const price = configuredPriceOrNull(item.service?.baseFeeSdg);
          return item.service?.status === 'ACTIVE' && price != null ? sum + price : sum;
        }, 0);

        const reviewPending = order.items.some((item) => item.labReviewStatus === 'PENDING_REVIEW');
        const pricingRequired = reviewPending || billableItems.some((item) => (
          !item.service
          || item.service.status !== 'ACTIVE'
          || configuredPriceOrNull(item.service.baseFeeSdg) == null
        ));

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
            labReviewStatus: item.labReviewStatus,
            labReviewNote: item.labReviewNote,
            service: item.service
              ? {
                  id: item.service.id,
                  labelAr: item.service.labelAr,
                  labelEn: item.service.labelEn,
                  category: item.service.category,
                  baseFeeSdg: configuredPriceOrNull(item.service.baseFeeSdg)
                }
              : null
          })),

          pricingRequired,
          reviewPending,
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
                notIn: ['REFUNDED', 'VOIDED']
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
    const services = await prisma.clinicalService.findMany({
      where: {
        status: 'ACTIVE',
        baseFeeSdg: { gt: 0, lte: MAX_MONEY_SDG }
      }
    });
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
