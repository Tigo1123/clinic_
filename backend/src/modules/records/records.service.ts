import { Optional } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  Injectable,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { createRequire } from 'node:module';
import { PrismaService } from '../../database/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { Prisma } from '../../generated/prisma/index.js';

const require = createRequire(import.meta.url);
const { ensurePharmacyInvoiceInTransaction } = require('../../services/pharmacyInvoice.js');
const { sendEmail } = require('../../utils/notifications.js');
const { escapeHtmlText, getFacilityBranding } = require('../../utils/facilityBranding.js');
const {
  doctorHasPatientAccess,
  getDoctorMedicalRecordAccess,
  ROLES,
} = require('../../middleware/policies.js');
const { isClinicalDataDecryptionError } = require('../../utils/encryption.js');
const {
  assertNoNewCustomTests,
  BILLABLE_NON_LAB_CATEGORIES,
  normalizeDoctorServiceOrders,
} = require('../../utils/clinicalOrdering.js');

@Injectable()
export class RecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: CryptoService,
    private readonly realtimeGateway: RealtimeGateway,
    @Optional() private readonly notificationsService?: NotificationsService,
  ) {}

  private async lockAndValidateClinicalSelections(
    tx: any,
    {
      prescribedDrugs = [],
      orderedServices = [],
      serviceOrders = [],
    }: { prescribedDrugs?: any[]; orderedServices?: string[]; serviceOrders?: any[] },
  ) {
    const drugIds = [
      ...new Set(prescribedDrugs.map((item) => item.drugId).filter(Boolean)),
    ].sort();
    const labServiceIds = [...new Set(orderedServices)].sort();
    const orderServiceIds = [...new Set(serviceOrders.map((item: any) => item.serviceId))].sort();
    const allServiceIds = [...new Set([...labServiceIds, ...orderServiceIds])].sort();

    if (drugIds.length > 0) {
      const medicines: { id: string; status: string }[] = await tx.$queryRaw`
        SELECT "id", "status"
        FROM "DrugFormulary"
        WHERE "id" IN (${Prisma.join(drugIds)})
        ORDER BY "id"
        FOR UPDATE
      `;

      const medicinesById = new Map(medicines.map((medicine) => [medicine.id, medicine]));
      const missingId = drugIds.find((id) => !medicinesById.has(id));
      if (missingId) {
        throw new HttpException(
          { code: 'FORMULARY_MEDICINE_NOT_FOUND', message: 'A selected formulary medicine was not found.' },
          HttpStatus.NOT_FOUND,
        );
      }
      if (drugIds.some((id) => medicinesById.get(id)?.status !== 'ACTIVE')) {
        throw new HttpException(
          { code: 'FORMULARY_MEDICINE_INACTIVE', message: 'A selected formulary medicine is inactive.' },
          HttpStatus.CONFLICT,
        );
      }
    }

    if (allServiceIds.length > 0) {
      let services: any[];
      try {
        services = await tx.$queryRaw`
          SELECT "id", "status", "category", "baseFeeSdg"
          FROM "ClinicalService"
          WHERE "id" IN (${Prisma.join(allServiceIds)})
          ORDER BY "id"
          FOR UPDATE
        `;
      } catch {
        services = await tx.clinicalService.findMany({
          where: { id: { in: allServiceIds } },
          select: { id: true, status: true, category: true, baseFeeSdg: true },
        });
      }

      const servicesById = new Map(services.map((s: any) => [s.id, s]));
      const missingId = allServiceIds.find((id) => !servicesById.has(id));
      if (missingId) {
        throw new HttpException(
          { code: 'CLINICAL_SERVICE_NOT_FOUND', message: 'A selected clinical service was not found.' },
          HttpStatus.NOT_FOUND,
        );
      }
      if (allServiceIds.some((id) => servicesById.get(id).status !== 'ACTIVE')) {
        throw new HttpException(
          { code: 'CLINICAL_SERVICE_INACTIVE', message: 'A selected clinical service is inactive.' },
          HttpStatus.CONFLICT,
        );
      }
      if (labServiceIds.some((id) => servicesById.get(id).category !== 'LABORATORY')) {
        throw new HttpException(
          { code: 'CLINICAL_SERVICE_NOT_LABORATORY', message: 'A selected clinical service is not eligible for a laboratory order.' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (orderServiceIds.some((id) => !BILLABLE_NON_LAB_CATEGORIES.includes(servicesById.get(id).category))) {
        throw new HttpException(
          {
            code: 'CLINICAL_SERVICE_NOT_BILLABLE_ORDER',
            message: 'A selected clinical service is not eligible for a non-laboratory service order.',
          },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (
        orderServiceIds.some((id) => {
          const fee = Number(servicesById.get(id).baseFeeSdg);
          return !Number.isSafeInteger(fee) || fee <= 0;
        })
      ) {
        throw new HttpException(
          {
            code: 'SERVICE_PRICE_NOT_CONFIGURED',
            message: 'The selected service does not have a valid configured price.',
          },
          HttpStatus.CONFLICT,
        );
      }
    }
  }

  private async resolveDoctorId(user: any): Promise<string> {
    let doctorId = user.doctorId;
    if (!doctorId && user.role === 'DOCTOR') {
      const doctor = await this.prisma.doctor.findUnique({
        where: { userId: user.id },
      });
      doctorId = doctor?.id || null;
    }
    if (!doctorId) {
      throw new HttpException(
        { error: 'Only registered doctors with assigned profiles can complete consultations.' },
        HttpStatus.FORBIDDEN,
      );
    }
    return doctorId;
  }

  async createEncounter(body: any, user: any, ip?: string) {
    const {
      patientId,
      appointmentId,
      symptoms,
      diagnosis,
      treatment,
      clinicalNotes,
      vitalSigns,
      prescribedDrugs,
      orderedServices,
      serviceOrders,
      customTests,
      attachmentPath,
    } = body;

    if (!patientId || !appointmentId) {
      throw new HttpException(
        { error: 'Patient ID and Appointment ID are required.' },
        HttpStatus.BAD_REQUEST,
      );
    }

    let normalizedServiceOrders: any[] = [];
    try {
      assertNoNewCustomTests(customTests);
      normalizedServiceOrders = normalizeDoctorServiceOrders(serviceOrders);
    } catch (domainErr: any) {
      if (domainErr?.status && domainErr?.code) {
        throw new HttpException({ code: domainErr.code, message: domainErr.message }, domainErr.status);
      }
      throw domainErr;
    }

    const hasLabOrders = Array.isArray(orderedServices) && orderedServices.length > 0;

    if (!hasLabOrders && !diagnosis?.trim()) {
      throw new HttpException(
        {
          code: 'DIAGNOSIS_REQUIRED',
          message: 'Diagnosis is required when completing a visit without laboratory orders.',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const doctorId = await this.resolveDoctorId(user);

    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
    });
    if (!appointment || appointment.doctorId !== doctorId || appointment.patientId !== patientId) {
      throw new HttpException(
        {
          code: 'CONSULTATION_RELATIONSHIP_INVALID',
          message: 'The appointment is not assigned to this doctor and patient.',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    if (appointment.status !== 'IN_CONSULTATION') {
      if (appointment.status === 'COMPLETED') {
        throw new HttpException(
          { code: 'VISIT_ALREADY_COMPLETED', message: 'This completed visit is read-only.' },
          HttpStatus.CONFLICT,
        );
      }
      throw new HttpException(
        {
          code: 'CONSULTATION_STATUS_INVALID',
          message: 'The appointment must be in consultation before clinical notes can be saved.',
        },
        HttpStatus.CONFLICT,
      );
    }

    // Check if EMR already exists for this appointment (idempotency)
    const existingRecord = await this.prisma.medicalRecord.findFirst({
      where: { appointmentId },
      include: {
        prescriptions: true,
        labOrders: true,
        serviceOrder: { include: { items: true } },
      },
    });
    if (existingRecord) {
      return {
        success: true,
        message: 'EMR consultation already saved.',
        recordId: existingRecord.id,
        record: existingRecord,
        prescriptions: existingRecord.prescriptions,
        labOrders: existingRecord.labOrders,
        data: {
          record: existingRecord,
          prescription: existingRecord.prescriptions[0] || null,
          labOrder: existingRecord.labOrders[0] || null,
          serviceOrder: existingRecord.serviceOrder || null,
        },
      };
    }

    // Encrypt clinical fields
    const encryptedSymptoms = this.cryptoService.encryptMedical(symptoms || '');
    const encryptedDiagnosis = this.cryptoService.encryptMedical(diagnosis?.trim() || '');
    const encryptedTreatment = this.cryptoService.encryptMedical(treatment || '');
    const encryptedNotes = this.cryptoService.encryptMedical(clinicalNotes || '');
    const vitalSignsStr = JSON.stringify(vitalSigns || {});

    const result = await this.prisma.$transaction(async (tx: any) => {
      await this.lockAndValidateClinicalSelections(tx, {
        prescribedDrugs,
        orderedServices,
        serviceOrders: normalizedServiceOrders,
      });

      const record = await tx.medicalRecord.create({
        data: {
          patientId,
          doctorId,
          appointmentId,
          symptomsEncrypted: encryptedSymptoms,
          diagnosisEncrypted: encryptedDiagnosis,
          treatmentEncrypted: encryptedTreatment,
          vitalSignsJson: vitalSignsStr,
          clinicalNotesEncrypted: encryptedNotes,
          attachmentPath: attachmentPath || null,
        },
      });

      let prescription: any = null;
      if (prescribedDrugs && prescribedDrugs.length > 0) {
        prescription = await tx.prescription.create({
          data: {
            medicalRecordId: record.id,
            patientId,
            doctorId,
            status: 'ACTIVE',
          },
        });

        for (const drug of prescribedDrugs) {
          await tx.prescribedDrug.create({
            data: {
              prescriptionId: prescription.id,
              drugId: drug.drugId || null,
              customDrugName: drug.customDrugName || null,
              dosage: drug.dosage,
              duration: drug.duration,
              instructionsAr: drug.instructionsAr || '',
              instructionsEn: drug.instructionsEn || '',
              qtyPrescribed: parseInt(drug.qtyPrescribed, 10),
              pharmacyReviewStatus: drug.drugId ? 'NOT_REQUIRED' : 'PENDING_REVIEW',
            },
          });
        }

        await ensurePharmacyInvoiceInTransaction(tx, {
          prescriptionId: prescription.id,
          actorUserId: user.id,
          ipAddress: ip || 'unknown',
          trigger: 'PRESCRIPTION_CREATED',
        });
      }

      let labOrder: any = null;
      if (hasLabOrders) {
        labOrder = await tx.labOrder.create({
          data: {
            medicalRecordId: record.id,
            patientId,
            doctorId,
            status: 'PENDING_BILLING',
          },
        });

        for (const serviceId of orderedServices || []) {
          await tx.labOrderItem.create({
            data: {
              labOrderId: labOrder.id,
              serviceId,
              customTestName: null,
              labReviewStatus: 'NOT_REQUIRED',
              isOutOfRange: false,
            },
          });
        }
      }

      let serviceOrder: any = null;
      if (normalizedServiceOrders.length > 0) {
        serviceOrder = await tx.serviceOrder.create({
          data: {
            medicalRecordId: record.id,
            patientId,
            doctorId,
            status: 'PENDING_BILLING',
            items: {
              create: normalizedServiceOrders.map((item: any) => ({
                serviceId: item.serviceId,
                quantity: item.quantity,
              })),
            },
          },
          include: {
            items: { include: { service: true } },
          },
        });
      }

      const nextAppointmentStatus = hasLabOrders ? 'WAITING_LAB' : 'COMPLETED';
      const transitioned = await tx.appointment.updateMany({
        where: { id: appointmentId, status: 'IN_CONSULTATION' },
        data: { status: nextAppointmentStatus },
      });
      if (transitioned.count !== 1) {
        throw new HttpException(
          {
            code: 'APPOINTMENT_STATE_CONFLICT',
            message: 'Appointment state changed before the consultation could be saved.',
          },
          HttpStatus.CONFLICT,
        );
      }

      await tx.tenantAuditLog.create({
        data: {
          userId: user.id,
          action: 'MEDICAL_RECORD_CREATED',
          details: JSON.stringify({
            medicalRecordId: record.id,
            patientId,
            appointmentId,
            doctorId,
            prescriptionId: prescription?.id || null,
            labOrderId: labOrder?.id || null,
            serviceOrderId: serviceOrder?.id || null,
          }),
          ipAddress: ip || 'unknown',
        },
      });

      return { record, prescription, labOrder, serviceOrder };
    });

    const notificationContext = { appointmentId, appointmentDate: appointment.appointmentDate };
    if (result.labOrder) {
      await this.notificationsService?.notifyLabOrdered({
        ...notificationContext,
        labOrder: result.labOrder,
        hasCustomTestsPendingReview: Boolean(customTests?.length),
      });
    } else {
      await this.notificationsService?.notifyConsultationCompleted({ ...notificationContext, doctorId, patientId });
    }
    if (result.prescription) {
      await this.notificationsService?.notifyPrescriptionReady({
        ...notificationContext,
        prescription: result.prescription,
        needsReview: prescribedDrugs?.some((drug: any) => !drug.drugId),
      });
    }

    this.realtimeGateway.emitQueueUpdate(
      { type: 'CONSULTATION_COMPLETE', appointmentId, doctorId },
      [doctorId],
    );

    return {
      success: true,
      message: 'Consultation saved and EMR record created successfully.',
      recordId: result.record.id,
      record: result.record,
      data: result,
    };
  }

  async finalizeEncounter(id: string, body: any, user: any, ip?: string) {
    const { diagnosis, treatment, clinicalNotes, vitalSigns, prescribedDrugs } = body;
    const doctorId = await this.resolveDoctorId(user);

    const record = await this.prisma.medicalRecord.findUnique({
      where: { id },
      include: { appointment: true, labOrders: true },
    });

    if (!record) {
      throw new HttpException(
        { code: 'MEDICAL_RECORD_NOT_FOUND', message: 'Medical record not found.' },
        HttpStatus.NOT_FOUND,
      );
    }

    if (record.doctorId !== doctorId) {
      throw new HttpException(
        {
          code: 'RECORD_ACCESS_FORBIDDEN',
          message: 'This medical record does not belong to the authenticated doctor.',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    if (record.appointment.status !== 'IN_CONSULTATION') {
      if (record.appointment.status === 'COMPLETED') {
        throw new HttpException(
          { code: 'VISIT_ALREADY_COMPLETED', message: 'This completed visit is read-only.' },
          HttpStatus.CONFLICT,
        );
      }
      throw new HttpException(
        {
          code: 'CONSULTATION_STATUS_INVALID',
          message: 'The appointment must be in consultation before the visit can be finalized.',
        },
        HttpStatus.CONFLICT,
      );
    }

    if (record.labOrders.length > 0) {
      const incompleteLabOrder = record.labOrders.some((order: any) => order.status !== 'COMPLETED');
      if (incompleteLabOrder) {
        throw new HttpException(
          {
            code: 'LAB_RESULTS_NOT_READY',
            message: 'All laboratory results must be completed before finalizing the visit.',
          },
          HttpStatus.CONFLICT,
        );
      }
    }

    const result = await this.prisma.$transaction(async (tx: any) => {
      await this.lockAndValidateClinicalSelections(tx, { prescribedDrugs });

      const updatedRecord = await tx.medicalRecord.update({
        where: { id: record.id },
        data: {
          diagnosisEncrypted: this.cryptoService.encryptMedical(diagnosis),
          treatmentEncrypted: this.cryptoService.encryptMedical(treatment || ''),
          clinicalNotesEncrypted: this.cryptoService.encryptMedical(clinicalNotes || ''),
          ...(vitalSigns ? { vitalSignsJson: JSON.stringify(vitalSigns) } : {}),
        },
      });

      let prescription: any = null;
      if (prescribedDrugs && prescribedDrugs.length > 0) {
        prescription = await tx.prescription.create({
          data: {
            medicalRecordId: record.id,
            patientId: record.patientId,
            doctorId,
            status: 'ACTIVE',
          },
        });

        for (const drug of prescribedDrugs) {
          await tx.prescribedDrug.create({
            data: {
              prescriptionId: prescription.id,
              drugId: drug.drugId || null,
              customDrugName: drug.customDrugName || null,
              dosage: drug.dosage,
              duration: drug.duration,
              instructionsAr: drug.instructionsAr || '',
              instructionsEn: drug.instructionsEn || '',
              qtyPrescribed: Number(drug.qtyPrescribed),
              pharmacyReviewStatus: drug.drugId ? 'NOT_REQUIRED' : 'PENDING_REVIEW',
            },
          });
        }

        await ensurePharmacyInvoiceInTransaction(tx, {
          prescriptionId: prescription.id,
          actorUserId: user.id,
          ipAddress: ip || 'unknown',
          trigger: 'PRESCRIPTION_FINALIZED',
        });
      }

      const completed = await tx.appointment.updateMany({
        where: { id: record.appointmentId, status: 'IN_CONSULTATION' },
        data: { status: 'COMPLETED' },
      });
      if (completed.count !== 1) {
        throw new HttpException(
          {
            code: 'CONSULTATION_FINALIZE_CONFLICT',
            message: 'Appointment status changed before the consultation could be finalized.',
          },
          HttpStatus.CONFLICT,
        );
      }

      await tx.tenantAuditLog.create({
        data: {
          userId: user.id,
          action: 'MEDICAL_RECORD_FINALIZED',
          details: JSON.stringify({
            medicalRecordId: record.id,
            patientId: record.patientId,
            appointmentId: record.appointmentId,
            doctorId,
            prescriptionId: prescription?.id || null,
          }),
          ipAddress: ip || 'unknown',
        },
      });

      return { record: updatedRecord, prescription };
    });

    const notificationContext = {
      appointmentId: record.appointmentId,
      appointmentDate: record.appointment.appointmentDate,
    };
    await this.notificationsService?.notifyConsultationCompleted({
      ...notificationContext, doctorId, patientId: record.patientId,
    });
    if (result.prescription) {
      await this.notificationsService?.notifyPrescriptionReady({
        ...notificationContext,
        prescription: result.prescription,
        needsReview: prescribedDrugs?.some((drug: any) => !drug.drugId),
      });
    }

    this.realtimeGateway.emitQueueUpdate(
      { type: 'CONSULTATION_FINALIZED', appointmentId: record.appointmentId, doctorId },
      [doctorId],
    );

    return {
      success: true,
      message: 'Consultation finalized successfully.',
      recordId: result.record.id,
      record: result.record,
      prescription: result.prescription,
    };
  }

  async applyBypass(patientId: string, justification: string, user: any, ip?: string) {
    if (!patientId || !justification || justification.trim().length < 20) {
      throw new HttpException(
        { error: 'Patient ID and a detailed justification (min 20 characters) are required.' },
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.prisma.tenantAuditLog.create({
      data: {
        userId: user.id,
        action: `EMR_BREAK_THE_GLASS_BYPASS:${patientId}`,
        details: `Emergency EMR access override. Justification: ${justification.trim()}`,
        ipAddress: ip || '127.0.0.1',
      },
    });

    return {
      success: true,
      message: 'Break-the-Glass authorization granted. EMR details unlocked for 2 hours.',
    };
  }

  async getDrugs() {
    return this.prisma.drugFormulary.findMany({
      where: { status: 'ACTIVE' },
      include: { inventoryBatches: true },
    });
  }

  async getSummary(targetId: string, user: any) {
    if (!targetId || targetId === 'undefined' || targetId === 'null') {
      throw new HttpException(
        { error: 'Record ID or Appointment ID is required.' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const record = await this.prisma.medicalRecord.findFirst({
      where: {
        OR: [{ id: targetId }, { appointmentId: targetId }],
      },
      include: {
        patient: true,
        doctor: true,
        prescriptions: {
          include: { prescribedDrugs: { include: { drug: true } } },
        },
        labOrders: {
          include: { items: { include: { service: true } } },
        },
        serviceOrder: {
          include: { items: { include: { service: true } } },
        },
      },
    });

    if (!record) {
      throw new HttpException(
        { error: 'Visit medical record not found.' },
        HttpStatus.NOT_FOUND,
      );
    }

    if (record.doctorId !== user.doctorId) {
      throw new HttpException(
        {
          code: 'RECORD_ACCESS_FORBIDDEN',
          message: 'This clinical record does not belong to the authenticated doctor.',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    let vitals: any = {};
    if (record.vitalSignsJson) {
      try {
        vitals = typeof record.vitalSignsJson === 'string' ? JSON.parse(record.vitalSignsJson) : record.vitalSignsJson;
      } catch {
        vitals = {};
      }
    }

    return {
      id: record.id,
      appointmentId: record.appointmentId,
      visitDate: record.visitDate,
      patient: {
        id: record.patient?.id || '',
        fullNameAr: record.patient?.fullNameAr || '',
        fullNameEn: record.patient?.fullNameEn || '',
        gender: record.patient?.gender || '',
        dateOfBirth: record.patient?.dateOfBirth || '',
        phone: record.patient?.phone || '',
      },
      doctor: {
        fullNameAr: record.doctor?.fullNameAr || '',
        fullNameEn: record.doctor?.fullNameEn || '',
        specialtyAr: record.doctor?.specialtyAr || '',
        specialtyEn: record.doctor?.specialtyEn || '',
      },
      vitals,
      symptoms: this.cryptoService.decryptMedical(record.symptomsEncrypted),
      diagnosis: this.cryptoService.decryptMedical(record.diagnosisEncrypted),
      treatment: this.cryptoService.decryptMedical(record.treatmentEncrypted),
      clinicalNotes: this.cryptoService.decryptMedical(record.clinicalNotesEncrypted),
      prescriptions: (record.prescriptions || []).flatMap((p: any) =>
        (p.prescribedDrugs || []).map((pd: any) => ({
          drugNameAr: pd.drug?.labelAr || pd.drug?.genericName || pd.customDrugName || '',
          drugNameEn: pd.drug?.labelEn || pd.drug?.genericName || pd.customDrugName || '',
          dosage: pd.dosage || '',
          duration: pd.duration || '',
          instructionsAr: pd.instructionsAr || '',
          instructionsEn: pd.instructionsEn || '',
          qtyPrescribed: pd.qtyPrescribed || 0,
        })),
      ),
      labOrders: (record.labOrders || []).flatMap((lo: any) =>
        (lo.items || []).map((i: any) => ({
          serviceNameAr: i.service?.labelAr || i.customTestName || '',
          serviceNameEn: i.service?.labelEn || i.customTestName || '',
          resultValue: i.resultValue || '',
          referenceRangeMin:
            i.referenceRangeMin !== null && i.referenceRangeMin !== undefined
              ? String(i.referenceRangeMin)
              : '',
          referenceRangeMax:
            i.referenceRangeMax !== null && i.referenceRangeMax !== undefined
              ? String(i.referenceRangeMax)
              : '',
          isOutOfRange: Boolean(i.isOutOfRange),
        })),
      ),
      serviceOrders: (record.serviceOrder?.items || []).map((i: any) => ({
        serviceId: i.serviceId,
        serviceNameAr: i.service?.labelAr || '',
        serviceNameEn: i.service?.labelEn || '',
        category: i.service?.category || '',
        quantity: i.quantity || 1,
      })),
      instructions: [],
    };
  }

  async sendSummary(targetId: string, user: any) {
    let record = await this.prisma.medicalRecord.findUnique({
      where: { id: targetId },
      include: {
        patient: true,
        doctor: true,
        prescriptions: { include: { prescribedDrugs: { include: { drug: true } } } },
      },
    });

    if (!record) {
      record = await this.prisma.medicalRecord.findFirst({
        where: { appointmentId: targetId },
        include: {
          patient: true,
          doctor: true,
          prescriptions: { include: { prescribedDrugs: { include: { drug: true } } } },
        },
      });
    }

    if (!record) {
      throw new HttpException(
        { code: 'MEDICAL_RECORD_NOT_FOUND', message: 'Visit medical record not found.' },
        HttpStatus.NOT_FOUND,
      );
    }

    if (record.doctorId !== user.doctorId) {
      throw new HttpException(
        {
          code: 'RECORD_ACCESS_FORBIDDEN',
          message: 'This clinical record does not belong to the authenticated doctor.',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    const patientUser = record.patient.userId
      ? await this.prisma.user.findUnique({
          where: { id: record.patient.userId },
          select: { email: true, emailVerifiedAt: true, role: true },
        })
      : null;

    if (
      !patientUser ||
      patientUser.role !== ROLES.PATIENT ||
      !patientUser.emailVerifiedAt ||
      !patientUser.email
    ) {
      throw new HttpException(
        {
          code: 'PATIENT_VERIFIED_EMAIL_REQUIRED',
          message: 'A verified patient email address is required to send the visit summary.',
        },
        HttpStatus.CONFLICT,
      );
    }

    const recipientEmail = patientUser.email;
    const branding = getFacilityBranding();
    const diagnosis = this.cryptoService.decryptMedical(record.diagnosisEncrypted);
    const treatment = this.cryptoService.decryptMedical(record.treatmentEncrypted);
    const vitals = JSON.parse(record.vitalSignsJson || '{}');

    const drugsListHtml = record.prescriptions
      .flatMap((p: any) => p.prescribedDrugs)
      .map((pd: any) => {
        const medicationInstructions = pd.instructionsEn || pd.instructionsAr;
        return `<li><strong>${pd.drug?.labelEn || pd.drug?.genericName || pd.customDrugName || ''}</strong>: ${pd.dosage} for ${pd.duration}${medicationInstructions ? ` (${medicationInstructions})` : ''}</li>`;
      })
      .join('');

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; color: #1f2937;">
        <h2 style="color: #0d9488; text-align: center; border-bottom: 2px solid #0d9488; padding-bottom: 10px;">${escapeHtmlText(branding.displayNameEn)} / ${escapeHtmlText(branding.displayNameAr)}<br/><span style="font-size:16px;">Visit Summary</span></h2>
        
        <p><strong>Patient Name:</strong> ${record.patient.fullNameEn} (${record.patient.fullNameAr})</p>
        <p><strong>Attending Doctor:</strong> ${record.doctor.fullNameEn} - ${record.doctor.specialtyEn}</p>
        <p><strong>Visit Date:</strong> ${new Date(record.visitDate).toLocaleDateString()}</p>
        
        <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
        
        <h4 style="color: #0369a1; margin-bottom: 8px;">Vital Signs</h4>
        <p style="background: #f0f9ff; padding: 10px; border-radius: 6px;">
          Blood Pressure: ${vitals.blood_pressure || 'N/A'} | Heart Rate: ${vitals.heart_rate || 'N/A'} bpm | Temp: ${vitals.temperature || 'N/A'} °C | Weight: ${vitals.weight || 'N/A'} kg
        </p>

        <h4 style="color: #0369a1; margin-bottom: 8px;">Diagnosis & Care Plan</h4>
        <p><strong>Diagnosis:</strong> ${diagnosis}</p>
        <p><strong>Treatment:</strong> ${treatment}</p>

        ${drugsListHtml ? `<h4 style="color: #0369a1; margin-bottom: 8px;">Prescribed Medications</h4><ul>${drugsListHtml}</ul>` : ''}

        <p style="text-align: center; font-size: 12px; color: #6b7280; margin-top: 24px;">${escapeHtmlText(branding.displayNameEn)} / ${escapeHtmlText(branding.displayNameAr)}</p>
      </div>
    `;

    const delivery = await sendEmail({
      to: recipientEmail,
      subject: `Post-Visit Summary - ${branding.displayNameEn}`,
      text: `Visit summary for ${record.patient.fullNameEn}. Diagnosis: ${diagnosis}. Treatment: ${treatment}`,
      html: htmlContent,
    });

    if (!delivery) {
      throw new HttpException(
        { code: 'EMAIL_DELIVERY_FAILED', message: 'Post-visit summary could not be delivered.' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return { success: true, message: 'Post-visit summary emailed successfully.' };
  }

  async getPatientHistory(patientId: string, user: any) {
    if (!(await doctorHasPatientAccess(user, patientId, this.prisma))) {
      throw new HttpException(
        {
          code: 'PATIENT_ACCESS_FORBIDDEN',
          message: 'This patient is not assigned to the authenticated doctor.',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
    });
    if (!patient) {
      throw new HttpException(
        { error: 'Patient not found.' },
        HttpStatus.NOT_FOUND,
      );
    }

    const recordAccess = await getDoctorMedicalRecordAccess(user, patientId, undefined, this.prisma);

    const records = await this.prisma.medicalRecord.findMany({
      where: recordAccess.where,
      include: { doctor: true, appointment: true },
      orderBy: { visitDate: 'desc' },
    });

    return records.map((rec: any) => ({
      id: rec.id,
      recordId: rec.id,
      appointmentId: rec.appointmentId,
      visitDate: rec.visitDate,
      doctorNameAr: rec.doctor.fullNameAr,
      doctorNameEn: rec.doctor.fullNameEn,
      specialtyAr: rec.doctor.specialtyAr,
      specialtyEn: rec.doctor.specialtyEn,
      vitalSigns: typeof rec.vitalSignsJson === 'string' ? JSON.parse(rec.vitalSignsJson) : rec.vitalSignsJson || {},
      isLocked: false,
      symptoms: this.cryptoService.decryptMedical(rec.symptomsEncrypted),
      diagnosis: this.cryptoService.decryptMedical(rec.diagnosisEncrypted),
      treatment: this.cryptoService.decryptMedical(rec.treatmentEncrypted),
      clinicalNotes: this.cryptoService.decryptMedical(rec.clinicalNotesEncrypted),
      attachmentPath: rec.attachmentPath,
    }));
  }
}
