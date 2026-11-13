import {
  Injectable,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { Prisma } from '../../generated/prisma/index.js';
import { PrismaService } from '../../database/prisma.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';

const require = createRequire(import.meta.url);
const { usdFromSdg, money, addMoney, subtractMoney, multiplyMoney } = require('../../utils/money.js');
const { activePaymentMethods, requireActivePaymentMethods, PAYMENT_METHOD_CODES } = require('../../services/paymentMethods.js');
const {
  publicClinicalServiceSelect,
  staffInsuranceCompanySelect,
  toPublicClinicalService,
} = require('../../utils/publicDto.js');
const {
  clinicDateSequence,
  clinicMonthBounds,
  getClinicDateString,
  instantToClinicDateString,
} = require('../../utils/clinicTime.js');

const MAX_MONEY_SDG = 1_000_000_000;
const MAX_GENERAL_QUANTITY = 100;
const MAX_GENERAL_INVOICE_ITEMS = 100;
const MAX_INVOICE_QUANTITY = 10_000;
const LOCKED_EXCHANGE_RATE = 1500.00;

const INVOICE_REQUEST_FIELDS = new Set([
  'patientId',
  'appointmentId',
  'labOrderId',
  'prescriptionId',
  'insuranceCompanyId',
  'items',
  'invoiceType',
]);

function isConfiguredPrice(value: any): boolean {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 && amount <= MAX_MONEY_SDG;
}

function configuredPriceOrNull(value: any): number | null {
  if (value == null) return null;
  const amount = Number(value);
  return isConfiguredPrice(amount) ? amount : null;
}

function percentageBasisPoints(value: any): number | null {
  const normalized = String(value).trim();
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(basisPoints) && basisPoints >= 0 && basisPoints <= 10_000
    ? basisPoints
    : null;
}

function calculateInsuranceAmounts(totalSdg: number, company: any) {
  if (!company) {
    return {
      grossTotalSdg: totalSdg,
      insuranceCoverageSdg: 0,
      patientShareSdg: totalSdg,
      copayPercentage: null,
    };
  }
  const basisPoints = percentageBasisPoints(company.copayPercentage);
  if (basisPoints == null) {
    throw Object.assign(
      new Error('The selected insurance company has an invalid patient contribution configuration.'),
      { status: 409, code: 'INSURANCE_CONFIGURATION_INVALID' },
    );
  }
  const patientShareSdg = Number(
    (BigInt(totalSdg) * BigInt(basisPoints) + 5_000n) / 10_000n,
  );
  return {
    grossTotalSdg: totalSdg,
    insuranceCoverageSdg: subtractMoney(totalSdg, patientShareSdg),
    patientShareSdg,
    copayPercentage: Number(company.copayPercentage),
  };
}

function invoicePatientLiability(invoice: any) {
  const grossTotalSdg = Number(invoice.totalAmountSdg);
  const insuranceCoverageSdg = invoice.insuranceClaim
    ? Number(invoice.insuranceClaim.claimAmountSdg)
    : 0;
  return {
    grossTotalSdg,
    insuranceCoverageSdg,
    patientShareSdg: Math.max(0, subtractMoney(grossTotalSdg, insuranceCoverageSdg)),
  };
}

function paymentRoleAllowed(role: string, invoiceType: string): boolean {
  if (invoiceType === 'PHARMACY') return role === 'PHARMACIST';
  return role === 'ADMIN' || role === 'RECEPTIONIST';
}

function isUniqueViolationFor(error: any, fieldName: string, constraintName: string): boolean {
  if (error?.code !== 'P2002') return false;
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.length === 1 && String(target[0]).toLowerCase() === fieldName.toLowerCase();
  }
  if (typeof target !== 'string') return false;
  const normalized = target.replace(/["'`\s]/g, '').toLowerCase();
  const normalizedConstraint = constraintName.toLowerCase();
  return (
    normalized === fieldName.toLowerCase() ||
    normalized === normalizedConstraint ||
    normalized.endsWith(`.${normalizedConstraint}`)
  );
}

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  /**
   * Pre-issuance preview of patient vs. insurance responsibility.
   */
  async getInsurancePreview(body: any) {
    const { patientId, insuranceCompanyId, invoiceType, appointmentId, items = [] } = body;

    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true, status: true },
    });
    if (!patient) {
      throw new HttpException({ code: 'PATIENT_NOT_FOUND', message: 'Patient was not found.' }, HttpStatus.NOT_FOUND);
    }
    if (patient.status !== 'ACTIVE') {
      throw new HttpException(
        { code: 'PATIENT_NOT_ACTIVE', message: 'Billing requires an active patient record.' },
        HttpStatus.CONFLICT,
      );
    }

    let grossTotalSdg = 0;
    if (invoiceType === 'CONSULTATION') {
      if (!appointmentId) {
        throw new HttpException(
          { code: 'CONSULTATION_APPOINTMENT_REQUIRED', message: 'Consultation billing requires an appointment.' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: { doctor: { select: { consultationFee: true, status: true } } },
      });
      if (!appointment) {
        throw new HttpException({ code: 'APPOINTMENT_NOT_FOUND', message: 'Appointment not found.' }, HttpStatus.NOT_FOUND);
      }
      if (appointment.patientId !== patientId) {
        throw new HttpException(
          { code: 'CONSULTATION_PATIENT_MISMATCH', message: 'The invoice patient does not match the appointment patient.' },
          HttpStatus.CONFLICT,
        );
      }
      const fee = Number(appointment.doctor?.consultationFee);
      if (appointment.doctor?.status !== 'ACTIVE' || !isConfiguredPrice(fee)) {
        throw new HttpException(
          { code: 'CONSULTATION_FEE_NOT_CONFIGURED', message: 'The doctor consultation fee is not configured correctly.' },
          HttpStatus.CONFLICT,
        );
      }
      grossTotalSdg = fee;
    } else {
      if (!items.length) {
        throw new HttpException(
          { code: 'INVOICE_ITEMS_REQUIRED', message: 'At least one invoice item is required.' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      const serviceIds: string[] = Array.from(new Set(items.map((item: any) => String(item.serviceId))));
      const services = await this.prisma.clinicalService.findMany({
        where: { id: { in: serviceIds } },
        select: { id: true, baseFeeSdg: true, status: true },
      });
      const byId = new Map(services.map((service: any) => [service.id, service]));
      for (const item of items) {
        const service: any = byId.get(item.serviceId);
        if (!service || service.status !== 'ACTIVE') {
          throw new HttpException(
            { code: 'SERVICE_NOT_AVAILABLE', message: 'The selected active clinical service was not found.' },
            HttpStatus.NOT_FOUND,
          );
        }
        const price = Number(service.baseFeeSdg);
        if (!isConfiguredPrice(price)) {
          throw new HttpException(
            { code: 'SERVICE_PRICE_NOT_CONFIGURED', message: 'The selected service does not have a valid configured price.' },
            HttpStatus.CONFLICT,
          );
        }
        const lineTotal = multiplyMoney(price, item.quantity);
        if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(addMoney(grossTotalSdg, lineTotal))) {
          throw new HttpException(
            { code: 'INVOICE_TOTAL_INVALID', message: 'Invoice total exceeds the supported financial range.' },
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        grossTotalSdg = addMoney(grossTotalSdg, lineTotal);
      }
    }

    let company: any = null;
    if (insuranceCompanyId) {
      company = await this.prisma.insuranceCompany.findUnique({ where: { id: insuranceCompanyId } });
      if (!company) {
        throw new HttpException(
          { code: 'INSURANCE_COMPANY_INVALID', message: 'The selected insurance company is not available.' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    }

    return {
      ...calculateInsuranceAmounts(grossTotalSdg, company),
      insuranceCompany: company ? { id: company.id, labelAr: company.labelAr, labelEn: company.labelEn } : null,
      eligibilityModel: 'COMPANY_LEVEL_ONLY',
    };
  }

  /**
   * Generates an itemized invoice.
   */
  async createInvoice(body: any, actorUser: any, ipAddress: string) {
    const unexpectedFields = Object.keys(body || {}).filter((key) => !INVOICE_REQUEST_FIELDS.has(key));
    if (unexpectedFields.length) {
      throw new HttpException(
        { code: 'INVOICE_FIELDS_INVALID', message: 'The invoice request contains unsupported fields.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const {
      patientId,
      appointmentId,
      labOrderId,
      prescriptionId,
      insuranceCompanyId,
      items,
      invoiceType = 'GENERAL',
    } = body;

    const normalizedInvoiceType =
      typeof invoiceType === 'string' ? invoiceType.trim().toUpperCase() : 'GENERAL';

    if (normalizedInvoiceType === 'PHARMACY') {
      throw new HttpException(
        { code: 'PHARMACY_INVOICE_SYSTEM_OWNED', message: 'Pharmacy invoices are created automatically by the system.' },
        HttpStatus.FORBIDDEN,
      );
    }

    const allowedInvoiceTypes = ['GENERAL', 'CONSULTATION', 'LABORATORY', 'PHARMACY'];
    if (!allowedInvoiceTypes.includes(normalizedInvoiceType)) {
      throw new HttpException(
        { code: 'INVALID_INVOICE_TYPE', message: 'Unsupported invoice type.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    if (!patientId) {
      throw new HttpException(
        { code: 'PATIENT_ID_REQUIRED', message: 'Patient ID is required.' },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (
      !['CONSULTATION', 'LABORATORY', 'PHARMACY'].includes(normalizedInvoiceType) &&
      (!Array.isArray(items) || items.length === 0)
    ) {
      throw new HttpException(
        { code: 'INVOICE_ITEMS_REQUIRED', message: 'At least one invoice item is required.' },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (normalizedInvoiceType === 'GENERAL' && items.length > MAX_GENERAL_INVOICE_ITEMS) {
      throw new HttpException(
        {
          code: 'GENERAL_INVOICE_ITEM_LIMIT_EXCEEDED',
          message: `General invoices may contain at most ${MAX_GENERAL_INVOICE_ITEMS} items.`,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    let resolvedItems: any[];
    let resolvedAppointmentId = appointmentId || null;
    let resolvedLabOrderId: string | null = null;
    let resolvedPrescriptionId: string | null = null;

    if (normalizedInvoiceType === 'CONSULTATION') {
      if (!appointmentId) {
        throw new HttpException(
          { code: 'CONSULTATION_APPOINTMENT_REQUIRED', message: 'Consultation billing requires an appointment.' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      const appointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: { doctor: true },
      });

      if (!appointment) {
        throw new HttpException({ code: 'APPOINTMENT_NOT_FOUND', message: 'Appointment not found.' }, HttpStatus.NOT_FOUND);
      }

      if (appointment.patientId !== patientId) {
        throw new HttpException(
          { code: 'CONSULTATION_PATIENT_MISMATCH', message: 'The invoice patient does not match the appointment patient.' },
          HttpStatus.CONFLICT,
        );
      }

      if (appointment.status !== 'CHECKED_IN') {
        throw new HttpException(
          { code: 'CONSULTATION_BILLING_INVALID_STATE', message: 'Consultation billing is available after patient check-in.' },
          HttpStatus.CONFLICT,
        );
      }

      const consultationFee = Number(appointment.doctor?.consultationFee);
      if (appointment.doctor?.status !== 'ACTIVE' || !isConfiguredPrice(consultationFee)) {
        throw new HttpException(
          { code: 'CONSULTATION_FEE_NOT_CONFIGURED', message: 'The doctor consultation fee is not configured correctly.' },
          HttpStatus.CONFLICT,
        );
      }

      // Security: never trust a consultation price supplied by the browser.
      resolvedItems = [
        {
          descriptionAr: `كشف طبي - د. ${appointment.doctor.fullNameAr}`,
          descriptionEn: `Consultation - Dr. ${appointment.doctor.fullNameEn}`,
          qty: 1,
          unitPriceSdg: consultationFee,
        },
      ];
    } else if (normalizedInvoiceType === 'LABORATORY') {
      if (typeof labOrderId !== 'string' || !labOrderId.trim()) {
        throw new HttpException(
          { code: 'LAB_ORDER_REQUIRED', message: 'Laboratory billing requires a lab order.' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      const requestedLabOrderId = labOrderId.trim();
      const labOrder = await this.prisma.labOrder.findUnique({
        where: { id: requestedLabOrderId },
        include: {
          medicalRecord: { select: { appointmentId: true } },
          items: { include: { service: true } },
        },
      });

      if (!labOrder) {
        throw new HttpException({ code: 'LAB_ORDER_NOT_FOUND', message: 'Laboratory order not found.' }, HttpStatus.NOT_FOUND);
      }

      if (labOrder.patientId !== patientId) {
        throw new HttpException(
          { code: 'LAB_ORDER_PATIENT_MISMATCH', message: 'The invoice patient does not match the laboratory order patient.' },
          HttpStatus.CONFLICT,
        );
      }

      if (!['PENDING_BILLING', 'PAID'].includes(labOrder.status)) {
        throw new HttpException(
          { code: 'LAB_BILLING_INVALID_STATE', message: 'This laboratory order can no longer be billed.' },
          HttpStatus.CONFLICT,
        );
      }

      if (!labOrder.items.length) {
        throw new HttpException(
          { code: 'LAB_ORDER_EMPTY', message: 'The laboratory order does not contain billable tests.' },
          HttpStatus.CONFLICT,
        );
      }

      const pendingReviewItem = labOrder.items.find((item: any) => item.labReviewStatus === 'PENDING_REVIEW');
      if (pendingReviewItem) {
        throw new HttpException(
          { code: 'LAB_REVIEW_PENDING', message: 'A laboratory test requires review and pricing before the invoice can be issued.' },
          HttpStatus.CONFLICT,
        );
      }

      const billableLabItems = labOrder.items.filter((item: any) => item.labReviewStatus !== 'EXTERNAL');
      if (!billableLabItems.length) {
        throw new HttpException(
          { code: 'LAB_NO_BILLABLE_TESTS', message: 'This laboratory order contains only external tests and has no clinic charge.' },
          HttpStatus.CONFLICT,
        );
      }

      const unpricedCustomItem = billableLabItems.find((item: any) => !item.serviceId || !item.service);
      if (unpricedCustomItem) {
        throw new HttpException(
          { code: 'LAB_REVIEW_STATE_INVALID', message: 'A clinic-provided laboratory test is not linked to a catalogue service.' },
          HttpStatus.CONFLICT,
        );
      }

      const invalidService = billableLabItems.find(
        (item: any) => !['LABORATORY', 'RADIOLOGY'].includes(item.service.category),
      );
      if (invalidService) {
        throw new HttpException(
          { code: 'LAB_ORDER_SERVICE_INVALID', message: 'The laboratory order contains a service that cannot be billed as a diagnostic test.' },
          HttpStatus.CONFLICT,
        );
      }

      const invalidPrice = billableLabItems.find((item: any) => {
        const price = Number(item.service.baseFeeSdg);
        return item.service.status !== 'ACTIVE' || !isConfiguredPrice(price);
      });
      if (invalidPrice) {
        throw new HttpException(
          { code: 'LAB_SERVICE_PRICE_NOT_CONFIGURED', message: 'One or more ordered tests do not have a valid configured price.' },
          HttpStatus.CONFLICT,
        );
      }

      resolvedLabOrderId = labOrder.id;
      resolvedAppointmentId = labOrder.medicalRecord?.appointmentId || null;

      // Security: diagnostic prices always come from ClinicalService, never browser
      resolvedItems = billableLabItems.map((item: any) => ({
        sourceServiceId: item.service.id,
        descriptionAr: item.service.labelAr,
        descriptionEn: item.service.labelEn,
        qty: 1,
        unitPriceSdg: Number(item.service.baseFeeSdg),
      }));
    } else {
      const invalidGeneralItem = items.find((item: any) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return true;
        if (Object.keys(item).sort().join(',') !== 'quantity,serviceId') return true;
        return (
          typeof item.serviceId !== 'string' ||
          !Number.isSafeInteger(item.quantity) ||
          item.quantity <= 0 ||
          item.quantity > MAX_GENERAL_QUANTITY
        );
      });

      if (invalidGeneralItem) {
        throw new HttpException(
          { code: 'GENERAL_INVOICE_ITEM_INVALID', message: 'General invoice items require only a serviceId and a valid quantity.' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      const serviceIds: string[] = Array.from(new Set(items.map((item: any) => String(item.serviceId))));
      const services = await this.prisma.clinicalService.findMany({
        where: { id: { in: serviceIds } },
        select: {
          id: true,
          labelAr: true,
          labelEn: true,
          baseFeeSdg: true,
          status: true,
        },
      });
      const servicesById = new Map(services.map((catalogService: any) => [catalogService.id, catalogService]));

      const unavailableService = items.find((item: any) => {
        const catalogService: any = servicesById.get(item.serviceId);
        return !catalogService || catalogService.status !== 'ACTIVE';
      });
      if (unavailableService) {
        throw new HttpException(
          { code: 'SERVICE_NOT_AVAILABLE', message: 'The selected active clinical service was not found.' },
          HttpStatus.NOT_FOUND,
        );
      }

      const unpricedService = items.find(
        (item: any) => !isConfiguredPrice(servicesById.get(item.serviceId).baseFeeSdg),
      );
      if (unpricedService) {
        throw new HttpException(
          { code: 'SERVICE_PRICE_NOT_CONFIGURED', message: 'The selected service does not have a valid configured price.' },
          HttpStatus.CONFLICT,
        );
      }

      resolvedItems = items.map((item: any) => {
        const catalogService: any = servicesById.get(item.serviceId);
        return {
          sourceServiceId: catalogService.id,
          descriptionAr: catalogService.labelAr,
          descriptionEn: catalogService.labelEn,
          qty: item.quantity,
          unitPriceSdg: Number(catalogService.baseFeeSdg),
        };
      });
    }

    let totalSdg = 0;
    const invoiceItemsData = resolvedItems.map((item: any) => {
      const priceSdg = Number(item.unitPriceSdg);
      const qty = Number(item.qty);

      if (
        !isConfiguredPrice(priceSdg) ||
        !Number.isInteger(qty) ||
        qty <= 0 ||
        qty > MAX_INVOICE_QUANTITY
      ) {
        throw Object.assign(new Error('Invoice quantities and prices must be positive values.'), {
          status: 422,
          code: 'INVALID_INVOICE_ITEM',
        });
      }

      const lineTotalSdg = multiplyMoney(priceSdg, qty);
      if (!Number.isSafeInteger(lineTotalSdg) || lineTotalSdg < 0) {
        throw Object.assign(new Error('Invoice line total exceeds the supported financial range.'), {
          status: 422,
          code: 'INVOICE_LINE_TOTAL_INVALID',
        });
      }

      const nextTotalSdg = addMoney(totalSdg, lineTotalSdg);
      if (!Number.isSafeInteger(nextTotalSdg) || nextTotalSdg < 0) {
        throw Object.assign(new Error('Invoice total exceeds the supported financial range.'), {
          status: 422,
          code: 'INVOICE_TOTAL_INVALID',
        });
      }
      totalSdg = nextTotalSdg;

      return {
        descriptionAr: item.descriptionAr,
        descriptionEn: item.descriptionEn,
        qty,
        unitPriceSdg: priceSdg,
        unitPriceUsd: usdFromSdg(priceSdg, LOCKED_EXCHANGE_RATE),
      };
    });

    const totalUsd = usdFromSdg(totalSdg, LOCKED_EXCHANGE_RATE);

    const runCreateTransaction = () =>
      this.prisma.$transaction(
        async (tx: any) => {
          // Repeated consultation checkout must not create another invoice.
          if (normalizedInvoiceType === 'CONSULTATION') {
            const existingInvoice = await tx.invoice.findFirst({
              where: {
                appointmentId: resolvedAppointmentId,
                invoiceType: 'CONSULTATION',
              },
              include: {
                items: true,
                insuranceClaim: true,
              },
            });

            if (existingInvoice) {
              const claimAmount = existingInvoice.insuranceClaim
                ? Number(existingInvoice.insuranceClaim.claimAmountSdg)
                : 0;
              const grossTotal = Number(existingInvoice.totalAmountSdg);

              return {
                invoice: existingInvoice,
                insuranceClaim: existingInvoice.insuranceClaim || null,
                grossTotalSdg: grossTotal,
                insuranceCoverageSdg: claimAmount,
                patientShareSdg: Math.max(0, subtractMoney(grossTotal, claimAmount)),
                existing: true,
              };
            }
          }

          // Repeated laboratory checkout must not create another invoice for the same LabOrder.
          if (normalizedInvoiceType === 'LABORATORY') {
            const existingInvoice = await tx.invoice.findFirst({
              where: {
                labOrderId: resolvedLabOrderId,
                invoiceType: 'LABORATORY',
                paymentStatus: { not: 'REFUNDED' },
              },
              include: {
                items: true,
                insuranceClaim: true,
              },
              orderBy: { invoiceDate: 'desc' },
            });

            if (existingInvoice) {
              const claimAmount = existingInvoice.insuranceClaim
                ? Number(existingInvoice.insuranceClaim.claimAmountSdg)
                : 0;
              const grossTotal = Number(existingInvoice.totalAmountSdg);

              return {
                invoice: existingInvoice,
                insuranceClaim: existingInvoice.insuranceClaim || null,
                grossTotalSdg: grossTotal,
                insuranceCoverageSdg: claimAmount,
                patientShareSdg: Math.max(0, subtractMoney(grossTotal, claimAmount)),
                existing: true,
              };
            }
          }

          const catalogIds = [
            ...new Set(resolvedItems.map((item: any) => item.sourceServiceId).filter(Boolean)),
          ].sort();
          if (catalogIds.length) {
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "ClinicalService" WHERE "id" IN (${Prisma.join(catalogIds)}) ORDER BY "id" FOR SHARE`,
            );
            const currentServices = await tx.clinicalService.findMany({ where: { id: { in: catalogIds } } });
            const byId = new Map<string, any>(currentServices.map((service: any) => [service.id, service]));
            if (
              resolvedItems.some((item: any) => {
                if (!item.sourceServiceId) return false;
                const svc = byId.get(item.sourceServiceId);
                return !svc || svc.status !== 'ACTIVE' || !svc.baseFeeSdg?.equals(String(item.unitPriceSdg));
              })
            ) {
              throw Object.assign(new Error('The catalog changed. Refresh before creating this invoice.'), {
                status: 409,
                code: 'CATALOG_CHANGED',
              });
            }
          }

          const patient = await tx.patient.findUnique({
            where: { id: patientId },
            select: { id: true, status: true },
          });
          if (!patient) {
            throw Object.assign(new Error('Patient was not found.'), { status: 404, code: 'PATIENT_NOT_FOUND' });
          }
          if (patient.status !== 'ACTIVE') {
            throw Object.assign(new Error('Billing requires an active patient record.'), {
              status: 409,
              code: 'PATIENT_NOT_ACTIVE',
            });
          }

          let company: any = null;
          if (insuranceCompanyId) {
            company = await tx.insuranceCompany.findUnique({ where: { id: insuranceCompanyId } });
            if (!company) {
              throw Object.assign(new Error('The selected insurance company is not available.'), {
                status: 422,
                code: 'INSURANCE_COMPANY_INVALID',
              });
            }
          }
          const insuranceAmounts = calculateInsuranceAmounts(totalSdg, company);
          let insuranceClaim: any = null;
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
              invoiceExchangeRate: LOCKED_EXCHANGE_RATE,
              paymentStatus: 'UNPAID',
              createdBy: actorUser.id,
              items: { create: invoiceItemsData },
            },
            include: { items: true },
          });

          if (company) {
            insuranceClaim = await tx.insuranceClaim.create({
              data: {
                insuranceCompanyId: company.id,
                patientId,
                invoiceId: invoice.id,
                claimAmountSdg: insuranceAmounts.insuranceCoverageSdg,
                claimStatus: 'DRAFT',
              },
            });

            await tx.invoice.update({
              where: { id: invoice.id },
              data: { insuranceClaimId: insuranceClaim.id },
            });
          }

          return {
            invoice,
            insuranceClaim,
            patientShareSdg,
            grossTotalSdg: insuranceAmounts.grossTotalSdg,
            insuranceCoverageSdg: insuranceAmounts.insuranceCoverageSdg,
            copayPercentage: insuranceAmounts.copayPercentage,
            existing: false,
          };
        },
        { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 },
      );

    let result: any;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        result = await runCreateTransaction();
        break;
      } catch (error: any) {
        const contention =
          ['P2028', 'P2034'].includes(error.code) ||
          /serialization|write conflict|deadlock/i.test(error.message || '');
        if (!contention || attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
      }
    }

    return result;
  }

  /**
   * Records split payments against an invoice.
   */
  async recordPayment(
    invoiceId: string,
    body: any,
    actorUser: any,
    ipAddress: string,
    idempotencyKey: string,
  ) {
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      throw new HttpException(
        { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'A valid Idempotency-Key header is required for payments.' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const { payments } = body;
    const normalizedPayments = payments.map((pay: any) => {
      const amount = Number(pay.amountSdg);
      return {
        amountSdg: amount,
        paymentMethod: pay.paymentMethod,
        transactionReference: pay.transactionReference?.trim() || null,
      };
    });

    const requestHash = createHash('sha256')
      .update(JSON.stringify({ invoiceId, payments: normalizedPayments }))
      .digest('hex');

    const runPaymentTransaction = () =>
      this.prisma.$transaction(
        async (tx: any) => {
          const lockedActors = await tx.$queryRaw`
            SELECT "id" FROM "User" WHERE "id" = ${actorUser.id} FOR SHARE
          `;
          if (lockedActors.length !== 1) {
            throw Object.assign(new Error('This session is no longer active.'), {
              status: 401,
              code: 'SESSION_REVOKED',
            });
          }
          const actor = await tx.user.findUnique({
            where: { id: actorUser.id },
            select: { id: true, role: true, status: true, authVersion: true },
          });
          if (
            !actor ||
            actor.status !== 'ACTIVE' ||
            actor.role !== actorUser.role ||
            actor.authVersion !== actorUser.av
          ) {
            throw Object.assign(new Error('This session is no longer active.'), {
              status: 401,
              code: 'SESSION_REVOKED',
            });
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
              prescription: { select: { id: true, patientId: true, status: true } },
            },
          });
          if (!invoice) {
            throw Object.assign(new Error('Invoice not found.'), { status: 404, code: 'INVOICE_NOT_FOUND' });
          }
          if (invoice.paymentStatus === 'VOIDED') {
            throw Object.assign(new Error('Payments cannot be added to a voided invoice.'), {
              status: 409,
              code: 'VOIDED_INVOICE_LOCKED',
            });
          }
          if (!paymentRoleAllowed(actor.role, invoice.invoiceType)) {
            throw Object.assign(
              new Error(
                invoice.invoiceType === 'PHARMACY'
                  ? 'Pharmacy invoice payments must be recorded by a pharmacist.'
                  : 'Pharmacists may record payments only for pharmacy invoices.',
              ),
              { status: 403, code: 'INVOICE_PAYMENT_ROLE_FORBIDDEN' },
            );
          }
          if (
            invoice.invoiceType === 'PHARMACY' &&
            (!invoice.prescriptionId ||
              !invoice.prescription ||
              invoice.prescription.patientId !== invoice.patientId ||
              invoice.prescription.status === 'CANCELLED')
          ) {
            throw Object.assign(new Error('The pharmacy invoice is not linked to a valid prescription.'), {
              status: 409,
              code: 'PHARMACY_INVOICE_CONTEXT_INVALID',
            });
          }

          const priorOperation = await tx.paymentOperation.findUnique({ where: { idempotencyKey } });
          if (priorOperation) {
            if (priorOperation.invoiceId !== invoiceId || priorOperation.requestHash !== requestHash) {
              throw Object.assign(
                new Error('Idempotency key was already used for a different payment request.'),
                { status: 409, code: 'IDEMPOTENCY_KEY_REUSED' },
              );
            }
            const replayInvoice = await tx.invoice.findUnique({
              where: { id: invoiceId },
              include: { payments: true, insuranceClaim: true },
            });
            const replayPaid = replayInvoice.payments.reduce(
              (sum: number, payment: any) => addMoney(sum, payment.amountSdg),
              0,
            );
            const replayLiability = invoicePatientLiability(replayInvoice);
            return {
              ...replayInvoice,
              ...replayLiability,
              totalPaidSdg: replayPaid,
              remainingBalanceSdg: Math.max(0, subtractMoney(replayLiability.patientShareSdg, replayPaid)),
              idempotentReplay: true,
            };
          }

          if (invoice.refunds.length) {
            throw Object.assign(new Error('Payments cannot be added after a refund has been recorded.'), {
              status: 409,
              code: 'REFUNDED_INVOICE_LOCKED',
            });
          }

          for (const pay of normalizedPayments) {
            if (pay.transactionReference) {
              const existingPay = await tx.payment.findUnique({
                where: { transactionReference: pay.transactionReference },
                select: { id: true },
              });
              if (existingPay) {
                throw Object.assign(new Error('Payment reference has already been used.'), {
                  status: 409,
                  code: 'DUPLICATE_PAYMENT_REFERENCE',
                });
              }
            }
          }

          await requireActivePaymentMethods(
            tx,
            normalizedPayments.map((payment: any) => payment.paymentMethod),
          );

          const priorPaidSdg = invoice.payments.reduce(
            (sum: number, payment: any) => addMoney(sum, payment.amountSdg),
            0,
          );
          const newPaidSdg = normalizedPayments.reduce(
            (sum: number, payment: any) => addMoney(sum, payment.amountSdg),
            0,
          );
          const resultingPaidSdg = addMoney(priorPaidSdg, newPaidSdg);
          const liability = invoicePatientLiability(invoice);
          const patientShareSdg = liability.patientShareSdg;

          if (![priorPaidSdg, newPaidSdg, resultingPaidSdg, patientShareSdg].every(Number.isSafeInteger)) {
            throw Object.assign(new Error('Invoice payment values exceed the supported financial range.'), {
              status: 422,
              code: 'PAYMENT_AMOUNT_INVALID',
            });
          }
          if (priorPaidSdg >= patientShareSdg) {
            throw Object.assign(new Error('The invoice is already fully paid.'), {
              status: 409,
              code: 'INVOICE_ALREADY_PAID',
            });
          }
          if (resultingPaidSdg > patientShareSdg) {
            throw Object.assign(new Error('Payment exceeds the remaining invoice balance.'), {
              status: 409,
              code: 'PAYMENT_EXCEEDS_BALANCE',
            });
          }

          const claimed = await tx.invoice.updateMany({
            where: { id: invoiceId, ledgerVersion: invoice.ledgerVersion },
            data: { ledgerVersion: { increment: 1 } },
          });
          if (claimed.count !== 1) {
            throw Object.assign(new Error('Invoice ledger changed; retry the payment.'), {
              status: 409,
              code: 'PAYMENT_LEDGER_CONFLICT',
              retryable: true,
            });
          }

          const operation = await tx.paymentOperation.create({
            data: { invoiceId, idempotencyKey, requestHash, receivedBy: actor.id },
          });
          const createdPayments = [];
          for (const pay of normalizedPayments) {
            createdPayments.push(
              await tx.payment.create({
                data: {
                  invoiceId,
                  amountSdg: pay.amountSdg,
                  amountUsd: usdFromSdg(pay.amountSdg, invoice.invoiceExchangeRate),
                  paymentMethod: pay.paymentMethod,
                  transactionReference: pay.transactionReference,
                  verificationStatus: 'VERIFIED',
                  receivedBy: actor.id,
                  paymentOperationId: operation.id,
                },
              }),
            );
          }

          const invoiceStatus = resultingPaidSdg >= patientShareSdg ? 'PAID' : 'PARTIALLY_PAID';
          const updatedInvoice = await tx.invoice.update({
            where: { id: invoiceId },
            data: { paymentStatus: invoiceStatus },
            include: { payments: true },
          });

          await tx.tenantAuditLog.create({
            data: {
              userId: actor.id,
              action:
                invoice.invoiceType === 'PHARMACY'
                  ? 'PHARMACY_INVOICE_PAYMENT_RECORDED'
                  : 'INVOICE_PAYMENT_RECORDED',
              details: JSON.stringify({
                invoiceId: invoice.id,
                invoiceType: invoice.invoiceType,
                paymentOperationId: operation.id,
                paymentIds: createdPayments.map((payment: any) => payment.id),
                amountSdg: newPaidSdg,
                paymentMethods: [...new Set(normalizedPayments.map((payment: any) => payment.paymentMethod))],
                resultingPaymentStatus: invoiceStatus,
                totalPaidSdg: resultingPaidSdg,
                patientShareSdg,
                insuranceCoverageSdg: liability.insuranceCoverageSdg,
                grossTotalSdg: liability.grossTotalSdg,
                remainingBalanceSdg: Math.max(0, subtractMoney(patientShareSdg, resultingPaidSdg)),
              }),
              ipAddress,
            },
          });

          if (
            invoice.invoiceType === 'LABORATORY' &&
            invoice.labOrderId &&
            invoiceStatus === 'PAID'
          ) {
            const unlocked = await tx.labOrder.updateMany({
              where: {
                id: invoice.labOrderId,
                status: 'PENDING_BILLING',
              },
              data: {
                status: 'PAID',
              },
            });

            if (unlocked.count === 0) {
              const currentLabOrder = await tx.labOrder.findUnique({
                where: { id: invoice.labOrderId },
                select: { status: true },
              });

              if (!currentLabOrder) {
                throw Object.assign(
                  new Error('Laboratory order linked to this invoice no longer exists.'),
                  { status: 409, code: 'LAB_ORDER_NOT_FOUND' },
                );
              }

              if (!['PAID', 'SAMPLE_COLLECTED', 'COMPLETED'].includes(currentLabOrder.status)) {
                throw Object.assign(
                  new Error('Laboratory order could not be unlocked after payment.'),
                  { status: 409, code: 'LAB_PAYMENT_STATE_CONFLICT' },
                );
              }
            }
          }

          return {
            ...updatedInvoice,
            ...liability,
            totalPaidSdg: resultingPaidSdg,
            remainingBalanceSdg: Math.max(0, subtractMoney(patientShareSdg, resultingPaidSdg)),
          };
        },
        { maxWait: 5000, timeout: 10000 },
      );

    let result: any;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        result = await runPaymentTransaction();
        break;
      } catch (error: any) {
        const transactionContention =
          ['P2028', 'P2034'].includes(error.code) ||
          /database is locked|write conflict|deadlock|serialization/i.test(error.message || '');
        if (!transactionContention || attempt === 2) {
          // Check for unique violations before rethrowing
          if (isUniqueViolationFor(error, 'idempotencyKey', 'PaymentOperation_idempotencyKey_key')) {
            const priorOperation = await this.prisma.paymentOperation.findUnique({ where: { idempotencyKey } });
            if (priorOperation?.invoiceId === invoiceId && priorOperation.requestHash === requestHash) {
              const [replayInvoice, replayActor] = await Promise.all([
                this.prisma.invoice.findUnique({
                  where: { id: invoiceId },
                  include: { payments: true, insuranceClaim: true },
                }),
                this.prisma.user.findUnique({
                  where: { id: actorUser.id },
                  select: { role: true, status: true, authVersion: true },
                }),
              ]);
              if (
                !replayInvoice ||
                !replayActor ||
                replayActor.status !== 'ACTIVE' ||
                replayActor.role !== actorUser.role ||
                replayActor.authVersion !== actorUser.av ||
                !paymentRoleAllowed(replayActor.role, replayInvoice.invoiceType)
              ) {
                throw new HttpException(
                  { code: 'INVOICE_PAYMENT_ROLE_FORBIDDEN', message: 'You do not have permission to record this invoice payment.' },
                  HttpStatus.FORBIDDEN,
                );
              }
              const replayPaid = replayInvoice.payments.reduce(
                (sum: number, payment: any) => addMoney(sum, payment.amountSdg),
                0,
              );
              const replayLiability = invoicePatientLiability(replayInvoice);
              return {
                ...replayInvoice,
                ...replayLiability,
                totalPaidSdg: replayPaid,
                remainingBalanceSdg: Math.max(0, subtractMoney(replayLiability.patientShareSdg, replayPaid)),
                idempotentReplay: true,
              };
            }
            throw new HttpException(
              { code: 'IDEMPOTENCY_KEY_REUSED', message: 'Idempotency key was already used for a different payment request.' },
              HttpStatus.CONFLICT,
            );
          }
          if (isUniqueViolationFor(error, 'transactionReference', 'Payment_transactionReference_key')) {
            throw new HttpException(
              { code: 'DUPLICATE_PAYMENT_REFERENCE', message: 'Payment reference has already been used.' },
              HttpStatus.CONFLICT,
            );
          }
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
      }
    }

    if (result.invoiceType === 'CONSULTATION' && result.appointmentId) {
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: result.appointmentId },
        select: { doctorId: true },
      });

      if (appointment) {
        this.realtimeGateway.emitQueueUpdate(
          {
            type: 'CONSULTATION_PAYMENT_UPDATE',
            appointmentId: result.appointmentId,
            paymentStatus: result.paymentStatus,
            doctorId: appointment.doctorId,
          },
          [appointment.doctorId],
        );
      }
    }

    return result;
  }

  /**
   * Records an append-only refund.
   */
  async processRefund(invoiceId: string, body: any, actorUser: any, ipAddress: string) {
    const amountSdg = Number(body.amountSdg);
    const { refundMethod, transactionReference, reason } = body;

    if (!Number.isFinite(amountSdg) || amountSdg <= 0) {
      throw new HttpException(
        { code: 'INVALID_REFUND_AMOUNT', message: 'Refund amount must be greater than zero.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (!['CASH', 'CARD', 'BANKAK', 'FAWRY'].includes(refundMethod)) {
      throw new HttpException(
        { code: 'INVALID_REFUND_METHOD', message: 'Unsupported refund method.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (transactionReference !== undefined && (typeof transactionReference !== 'string' || !transactionReference.trim())) {
      throw new HttpException(
        { code: 'INVALID_REFUND_REFERENCE', message: 'Refund reference must be a non-empty string.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (reason !== undefined && (typeof reason !== 'string' || reason.trim().length > 500)) {
      throw new HttpException(
        { code: 'INVALID_REFUND_REASON', message: 'Refund reason must be at most 500 characters.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { appointment: true },
    });

    if (!invoice) {
      throw new HttpException({ error: 'Invoice not found.' }, HttpStatus.NOT_FOUND);
    }

    if (transactionReference) {
      const normalizedReference = transactionReference.trim();
      const [paymentReference, refundReference] = await Promise.all([
        this.prisma.payment.findUnique({ where: { transactionReference: normalizedReference }, select: { id: true } }),
        this.prisma.refund.findUnique({ where: { transactionReference: normalizedReference }, select: { id: true } }),
      ]);
      if (paymentReference || refundReference) {
        throw new HttpException(
          { code: 'DUPLICATE_REFUND_REFERENCE', message: 'Transaction reference has already been used.' },
          HttpStatus.CONFLICT,
        );
      }
    }

    // Refund Locker Check: If appointment is in consultation or completed, block it
    if (invoice.appointment && invoice.invoiceType !== 'LABORATORY') {
      const activeStatus = invoice.appointment.status;
      if (['IN_CONSULTATION', 'COMPLETED'].includes(activeStatus)) {
        throw new HttpException(
          { error: 'Refund locked. The patient has already entered consultation or finished their visit.' },
          HttpStatus.FORBIDDEN,
        );
      }
    }

    const result = await this.prisma.$transaction(async (tx: any) => {
      const financial = await tx.invoice.findUnique({
        where: { id: invoice.id },
        include: {
          payments: true,
          refunds: true,
          labOrder: true,
          insuranceClaim: true,
        },
      });

      const paidSdg = financial.payments.reduce(
        (sum: number, payment: any) => addMoney(sum, payment.amountSdg),
        0,
      );
      const previouslyRefundedSdg = financial.refunds.reduce(
        (sum: number, refund: any) => addMoney(sum, refund.amountSdg),
        0,
      );
      const refundableSdg = subtractMoney(paidSdg, previouslyRefundedSdg);

      if (paidSdg <= 0) {
        throw Object.assign(new Error('No paid funds are available to refund.'), {
          status: 409,
          code: 'NO_PAID_FUNDS',
        });
      }

      if (amountSdg > addMoney(refundableSdg, '0.001')) {
        throw Object.assign(new Error('Refund exceeds the paid amount still available.'), {
          status: 409,
          code: 'REFUND_EXCEEDS_PAID_AMOUNT',
        });
      }

      if (financial.invoiceType === 'LABORATORY') {
        if (!financial.labOrderId || !financial.labOrder) {
          throw Object.assign(new Error('Laboratory invoice is not linked to a laboratory order.'), {
            status: 409,
            code: 'LAB_ORDER_NOT_FOUND',
          });
        }

        if (financial.labOrder.status === 'SAMPLE_COLLECTED') {
          throw Object.assign(
            new Error('Laboratory payment cannot be refunded after sample collection has started.'),
            { status: 409, code: 'LAB_SERVICE_ALREADY_STARTED' },
          );
        }

        if (financial.labOrder.status === 'COMPLETED') {
          throw Object.assign(
            new Error('Laboratory payment cannot be refunded after laboratory work has been completed.'),
            { status: 409, code: 'LAB_SERVICE_ALREADY_COMPLETED' },
          );
        }

        if (money(amountSdg).minus(refundableSdg).abs().toNumber() > 0.001) {
          throw Object.assign(
            new Error('Laboratory refunds must reverse the full refundable amount before sample collection.'),
            { status: 409, code: 'LAB_PARTIAL_REFUND_NOT_SUPPORTED' },
          );
        }

        const relocked = await tx.labOrder.updateMany({
          where: {
            id: financial.labOrderId,
            status: { in: ['PENDING_BILLING', 'PAID'] },
          },
          data: { status: 'PENDING_BILLING' },
        });

        if (relocked.count !== 1) {
          const currentLabOrder = await tx.labOrder.findUnique({
            where: { id: financial.labOrderId },
            select: { status: true },
          });

          if (currentLabOrder?.status === 'SAMPLE_COLLECTED') {
            throw Object.assign(
              new Error('Laboratory payment cannot be refunded after sample collection has started.'),
              { status: 409, code: 'LAB_SERVICE_ALREADY_STARTED' },
            );
          }

          if (currentLabOrder?.status === 'COMPLETED') {
            throw Object.assign(
              new Error('Laboratory payment cannot be refunded after laboratory work has been completed.'),
              { status: 409, code: 'LAB_SERVICE_ALREADY_COMPLETED' },
            );
          }

          throw Object.assign(new Error('Laboratory order is not in a refundable state.'), {
            status: 409,
            code: 'LAB_REFUND_INVALID_STATE',
          });
        }
      }

      const claimed = await tx.invoice.updateMany({
        where: { id: invoice.id, ledgerVersion: financial.ledgerVersion },
        data: { ledgerVersion: { increment: 1 } },
      });
      if (claimed.count !== 1) {
        throw Object.assign(new Error('Invoice ledger changed; retry the refund.'), {
          status: 409,
          code: 'REFUND_LEDGER_CONFLICT',
        });
      }

      const refund = await tx.refund.create({
        data: {
          invoiceId: invoice.id,
          amountSdg,
          amountUsd: usdFromSdg(amountSdg, financial.invoiceExchangeRate),
          refundMethod,
          transactionReference: transactionReference?.trim() || null,
          reason: reason?.trim() || null,
          processedBy: actorUser.id,
        },
      });

      const totalRefundedSdg = addMoney(previouslyRefundedSdg, amountSdg);
      const paymentStatus =
        totalRefundedSdg >= subtractMoney(paidSdg, '0.001') ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
      const updatedInvoice = await tx.invoice.update({
        where: { id: invoice.id },
        data: { paymentStatus },
      });

      await tx.tenantAuditLog.create({
        data: {
          userId: actorUser.id,
          action: 'INVOICE_REFUND',
          details: `Refund ${refund.id} recorded for invoice ${invoice.id}; amount ${amountSdg} SDG; method ${refundMethod}.`,
          ipAddress,
        },
      });

      return {
        invoice: updatedInvoice,
        refund,
        paidSdg,
        refundedSdg: totalRefundedSdg,
        netCollectedSdg: subtractMoney(paidSdg, totalRefundedSdg),
        refundableSdg: Math.max(0, subtractMoney(paidSdg, totalRefundedSdg)),
        remainingBalanceSdg: Math.max(
          0,
          subtractMoney(
            invoicePatientLiability(financial).patientShareSdg,
            subtractMoney(paidSdg, totalRefundedSdg),
          ),
        ),
      };
    });

    return result;
  }

  /**
   * Reception/admin billing queue for laboratory orders.
   */
  async getPendingLabOrdersQueue() {
    const orders = await this.prisma.labOrder.findMany({
      where: {
        status: {
          in: ['PENDING_BILLING', 'PAID'],
        },
      },
      include: {
        patient: {
          select: {
            id: true,
            fullNameAr: true,
            fullNameEn: true,
            phone: true,
          },
        },
        doctor: {
          select: {
            id: true,
            fullNameAr: true,
            fullNameEn: true,
          },
        },
        medicalRecord: {
          select: {
            appointmentId: true,
          },
        },
        items: {
          include: {
            service: true,
          },
        },
        invoices: {
          where: {
            invoiceType: 'LABORATORY',
            paymentStatus: {
              not: 'REFUNDED',
            },
          },
          include: {
            payments: true,
            refunds: true,
          },
          orderBy: {
            invoiceDate: 'desc',
          },
          take: 1,
        },
      },
      orderBy: {
        orderDate: 'desc',
      },
    });

    return orders.map((order: any) => {
      const invoice = order.invoices[0] || null;

      const billableItems = order.items.filter((item: any) => item.labReviewStatus !== 'EXTERNAL');
      const estimatedTotalSdg = billableItems.reduce((sum: number, item: any) => {
        const price = configuredPriceOrNull(item.service?.baseFeeSdg);
        return item.service?.status === 'ACTIVE' && price != null ? addMoney(sum, price) : sum;
      }, 0);

      const reviewPending = order.items.some((item: any) => item.labReviewStatus === 'PENDING_REVIEW');
      const pricingRequired =
        reviewPending ||
        billableItems.some(
          (item: any) =>
            !item.service ||
            item.service.status !== 'ACTIVE' ||
            configuredPriceOrNull(item.service.baseFeeSdg) == null,
        );

      let totalPaidSdg = 0;
      let refundedSdg = 0;
      let remainingBalanceSdg = estimatedTotalSdg;

      if (invoice) {
        totalPaidSdg = invoice.payments.reduce(
          (sum: number, payment: any) => addMoney(sum, payment.amountSdg),
          0,
        );
        refundedSdg = invoice.refunds.reduce(
          (sum: number, refund: any) => addMoney(sum, refund.amountSdg),
          0,
        );
        const netCollectedSdg = Math.max(0, subtractMoney(totalPaidSdg, refundedSdg));
        remainingBalanceSdg = Math.max(0, subtractMoney(Number(invoice.totalAmountSdg), netCollectedSdg));
      }

      return {
        id: order.id,
        orderDate: order.orderDate,
        status: order.status,
        appointmentId: order.medicalRecord?.appointmentId || null,
        patient: order.patient,
        doctor: order.doctor,
        items: order.items.map((item: any) => ({
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
                baseFeeSdg: configuredPriceOrNull(item.service.baseFeeSdg),
              }
            : null,
        })),
        pricingRequired,
        reviewPending,
        estimatedTotalSdg,
        billingStatus: invoice ? invoice.paymentStatus : 'UNBILLED',
        invoice: invoice
          ? {
              id: invoice.id,
              paymentStatus: invoice.paymentStatus,
              totalAmountSdg: Number(invoice.totalAmountSdg),
              totalPaidSdg,
              refundedSdg,
              remainingBalanceSdg,
            }
          : null,
      };
    });
  }

  /**
   * Reception/admin financial queue for active clinic pharmacy prescriptions.
   */
  async getPendingPrescriptionsQueue() {
    const prescriptions = await this.prisma.prescription.findMany({
      where: {
        status: {
          in: ['ACTIVE', 'PARTIALLY_FILLED'],
        },
      },
      include: {
        patient: {
          select: {
            id: true,
            fullNameAr: true,
            fullNameEn: true,
            phone: true,
          },
        },
        doctor: {
          select: {
            id: true,
            fullNameAr: true,
            fullNameEn: true,
          },
        },
        medicalRecord: {
          select: {
            appointmentId: true,
          },
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
                unitPriceSdg: true,
              },
            },
          },
        },
        invoices: {
          where: {
            invoiceType: 'PHARMACY',
            paymentStatus: {
              notIn: ['REFUNDED', 'VOIDED'],
            },
          },
          include: {
            payments: true,
            refunds: true,
          },
          orderBy: {
            invoiceDate: 'desc',
          },
          take: 1,
        },
      },
      orderBy: {
        prescriptionDate: 'desc',
      },
    });

    return prescriptions.map((prescription: any) => {
      const invoice = prescription.invoices[0] || null;

      const mappedItems = prescription.prescribedDrugs.map((item: any) => {
        const remainingQty = Math.max(0, Number(item.qtyPrescribed) - Number(item.qtyDispensed));
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
                unitPriceSdg: item.drug.unitPriceSdg == null ? null : Number(item.drug.unitPriceSdg),
              }
            : null,
        };
      });

      const billableItems = mappedItems.filter((item: any) => item.drugId && item.drug && item.remainingQty > 0);
      const pricingRequired = billableItems.some((item: any) => {
        const price = Number(item.drug.unitPriceSdg);
        return !Number.isFinite(price) || price <= 0;
      });

      const estimatedTotalSdg = billableItems.reduce((sum: number, item: any) => {
        const price = Number(item.drug.unitPriceSdg);
        if (!Number.isFinite(price) || price <= 0) return sum;
        return addMoney(sum, multiplyMoney(price, item.remainingQty));
      }, 0);

      let totalPaidSdg = 0;
      let refundedSdg = 0;
      let remainingBalanceSdg = estimatedTotalSdg;

      if (invoice) {
        totalPaidSdg = invoice.payments.reduce(
          (sum: number, payment: any) => addMoney(sum, payment.amountSdg),
          0,
        );
        refundedSdg = invoice.refunds.reduce(
          (sum: number, refund: any) => addMoney(sum, refund.amountSdg),
          0,
        );
        const netCollectedSdg = Math.max(0, subtractMoney(totalPaidSdg, refundedSdg));
        remainingBalanceSdg = Math.max(0, subtractMoney(Number(invoice.totalAmountSdg), netCollectedSdg));
      }

      return {
        id: prescription.id,
        prescriptionDate: prescription.prescriptionDate,
        status: prescription.status,
        appointmentId: prescription.medicalRecord?.appointmentId || null,
        patient: prescription.patient,
        doctor: prescription.doctor,
        items: mappedItems,
        customMedicationCount: mappedItems.filter((item: any) => !item.drugId).length,
        automaticBillingAvailable: billableItems.length > 0,
        pricingRequired,
        estimatedTotalSdg,
        billingStatus: invoice ? invoice.paymentStatus : 'UNBILLED',
        invoice: invoice
          ? {
              id: invoice.id,
              paymentStatus: invoice.paymentStatus,
              totalAmountSdg: Number(invoice.totalAmountSdg),
              totalPaidSdg,
              refundedSdg,
              remainingBalanceSdg,
            }
          : null,
      };
    });
  }

  /**
   * Cashier shift balance reconciliation.
   */
  async reconcileShift(body: any, actorUser: any, ipAddress: string) {
    const { expectedAmountSdg, actualAmountSdg, note } = body;
    if (expectedAmountSdg === undefined || actualAmountSdg === undefined) {
      throw new HttpException(
        { error: 'Expected and actual cash amounts are required.' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const diff = subtractMoney(actualAmountSdg, expectedAmountSdg);

    await this.prisma.tenantAuditLog.create({
      data: {
        userId: actorUser.id,
        action: 'SHIFT_RECONCILIATION',
        details: `Shift reconciled. Expected: ${expectedAmountSdg} SDG. Actual: ${actualAmountSdg} SDG. Discrepancy: ${diff} SDG. Note: ${note || 'None'}`,
        ipAddress,
      },
    });

    return {
      success: true,
      discrepancy: diff,
      message:
        diff === 0
          ? 'Shift reconciled successfully. Perfect balance.'
          : 'Shift reconciled with discrepancy logged.',
    };
  }

  /**
   * Active payment methods list.
   */
  async getPaymentMethods() {
    return activePaymentMethods(this.prisma);
  }

  /**
   * Public clinical services catalog.
   */
  async getClinicalServices() {
    const services = await this.prisma.clinicalService.findMany({
      where: {
        status: 'ACTIVE',
        baseFeeSdg: { gt: 0, lte: MAX_MONEY_SDG },
      },
      select: publicClinicalServiceSelect,
      orderBy: { labelEn: 'asc' },
    });
    return services.map(toPublicClinicalService);
  }

  /**
   * Staff insurance companies list.
   */
  async getInsuranceCompanies() {
    return this.prisma.insuranceCompany.findMany({
      select: staffInsuranceCompanySelect,
      orderBy: { labelEn: 'asc' },
    });
  }

  /**
   * Admin dashboard billing analytics.
   */
  async getAnalytics() {
    const [payments, refunds] = await Promise.all([
      this.prisma.payment.findMany(),
      this.prisma.refund.findMany(),
    ]);

    let totalSdg = 0;
    let totalUsd = 0;
    const methodBreakdown: Record<string, number> = { CASH: 0, BANKAK: 0, FAWRY: 0, INSURANCE: 0 };

    payments.forEach((p: any) => {
      totalSdg = addMoney(totalSdg, p.amountSdg || 0);
      totalUsd = addMoney(totalUsd, p.amountUsd || 0);
      const method = p.paymentMethod || 'CASH';
      if (methodBreakdown[method] !== undefined) {
        methodBreakdown[method] = addMoney(methodBreakdown[method], p.amountSdg || 0);
      }
    });

    refunds.forEach((refund: any) => {
      const amount = Number(refund.amountSdg);
      totalSdg = subtractMoney(totalSdg, amount);
      totalUsd = subtractMoney(totalUsd, refund.amountUsd);
      if (methodBreakdown[refund.refundMethod] !== undefined) {
        methodBreakdown[refund.refundMethod] = subtractMoney(methodBreakdown[refund.refundMethod], amount);
      }
    });

    const doctors = await this.prisma.doctor.findMany({
      include: {
        appointments: { select: { status: true } },
      },
    });

    const doctorMetrics = doctors.map((d: any) => {
      const total = d.appointments.length;
      const completed = d.appointments.filter((a: any) => a.status === 'COMPLETED').length;
      return {
        id: d.id,
        nameAr: d.fullNameAr,
        nameEn: d.fullNameEn,
        specialtyEn: d.specialtyEn,
        totalAppointments: total,
        completedAppointments: completed,
      };
    });

    const dispensedDrugs = await this.prisma.prescribedDrug.findMany({
      where: { qtyDispensed: { gt: 0 } },
      include: { drug: true },
    });

    const drugSales = new Map<string, { name: string; qty: number }>();
    for (const pd of dispensedDrugs) {
      const key = pd.drugId ? `drug:${pd.drugId}` : `prescribed:${pd.id}`;
      const name =
        [
          pd.drug?.brandName,
          pd.drug?.labelEn,
          pd.drug?.labelAr,
          pd.drug?.genericName,
          pd.customDrugName,
        ]
          .find((value) => typeof value === 'string' && value.trim())
          ?.trim() || 'Unknown medicine';
      const existing = drugSales.get(key);
      if (existing) existing.qty += pd.qtyDispensed;
      else drugSales.set(key, { name, qty: pd.qtyDispensed });
    }

    const topDrugs = [...drugSales.entries()]
      .sort(([keyA, a], [keyB, b]) => b.qty - a.qty || (keyA < keyB ? -1 : keyA > keyB ? 1 : 0))
      .slice(0, 5)
      .map(([, item]) => item);

    const todayStr = getClinicDateString();
    const patientsSeenToday = await this.prisma.appointment.count({
      where: {
        appointmentDate: todayStr,
        status: 'COMPLETED',
      },
    });

    const last7Days = clinicDateSequence(7);
    const dailyRevenueTrend = last7Days.map((date: string) => {
      const dayTotal = payments
        .filter((p: any) => instantToClinicDateString(p.createdAt) === date)
        .reduce((sum: number, p: any) => addMoney(sum, p.amountSdg), 0);
      const refundTotal = refunds
        .filter((refund: any) => instantToClinicDateString(refund.createdAt) === date)
        .reduce((sum: number, refund: any) => addMoney(sum, refund.amountSdg), 0);
      return {
        date,
        amount: subtractMoney(dayTotal, refundTotal),
      };
    });

    const last6Months = Array.from({ length: 6 }, (_, index) => {
      return clinicMonthBounds(new Date(), index - 5);
    });

    const monthlyRevenueTrend = last6Months.map(({ start, end, label }: any) => {
      return {
        month: label,
        amount: subtractMoney(
          payments
            .filter((payment: any) => payment.createdAt >= start && payment.createdAt < end)
            .reduce((sum: number, payment: any) => addMoney(sum, payment.amountSdg), 0),
          refunds
            .filter((refund: any) => refund.createdAt >= start && refund.createdAt < end)
            .reduce((sum: number, refund: any) => addMoney(sum, refund.amountSdg), 0),
        ),
      };
    });

    return {
      revenue: {
        totalSdg,
        totalUsd,
        methodBreakdown,
      },
      doctorWorkload: doctorMetrics,
      topDispensedDrugs: topDrugs,
      patientsSeenToday,
      averageWaitTimeMinutes: null,
      dailyRevenueTrend,
      monthlyRevenueTrend,
      waitTimeTrend: [],
    };
  }
}
