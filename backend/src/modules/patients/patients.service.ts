import {
  Injectable,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { createRequire } from 'node:module';
import { PrismaService } from '../../database/prisma.service.js';

const require = createRequire(import.meta.url);
const {
  findPossiblePatientDuplicates,
  normalizeFileNumber,
  normalizeNationalId,
  normalizePatientPhone,
  safeDuplicateCandidates,
} = require('../../utils/patientIdentity.js');
const { structuredPatientName } = require('../../utils/patientName.js');
const { lockPatientIdentity, patientIdentitySummary } = require('../../utils/patientOnboarding.js');
const { getClinicDateString } = require('../../utils/clinicTime.js');
const { doctorHasPatientAccess, getDoctorMedicalRecordAccess } = require('../../middleware/policies.js');
import { CryptoService } from '../crypto/crypto.service.js';

@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService?: CryptoService,
  ) {}

  async search(q: string, limit = 20) {
    const exactNationalId = normalizeNationalId(q);
    const exactFileNumber = normalizeFileNumber(q);
    if (/^shf-/i.test(q) && !exactFileNumber) {
      throw new HttpException(
        { code: 'PATIENT_SEARCH_INVALID', message: 'Patient search parameters are invalid.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const select = {
      id: true,
      fileNumber: true,
      fullNameAr: true,
      fullNameEn: true,
      phone: true,
      dateOfBirth: true,
      gender: true,
      status: true,
    };

    const exact = exactFileNumber
      ? await this.prisma.patient.findFirst({
          where: { fileNumber: exactFileNumber, status: 'ACTIVE' },
          select,
        })
      : null;

    const patients = await this.prisma.patient.findMany({
      where: {
        status: 'ACTIVE',
        ...(exact?.id ? { id: { not: exact.id } } : {}),
        OR: [
          { fullNameAr: { contains: q, mode: 'insensitive' } },
          { fullNameEn: { contains: q, mode: 'insensitive' } },
          { firstNameAr: { contains: q, mode: 'insensitive' } },
          { fatherNameAr: { contains: q, mode: 'insensitive' } },
          { grandfatherNameAr: { contains: q, mode: 'insensitive' } },
          { familyNameAr: { contains: q, mode: 'insensitive' } },
          { firstNameEn: { contains: q, mode: 'insensitive' } },
          { fatherNameEn: { contains: q, mode: 'insensitive' } },
          { grandfatherNameEn: { contains: q, mode: 'insensitive' } },
          { familyNameEn: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
          ...(exactNationalId ? [{ nationalId: exactNationalId }] : []),
        ],
      },
      select,
      orderBy: [{ fullNameEn: 'asc' }, { fullNameAr: 'asc' }, { id: 'asc' }],
      take: Math.max(limit - (exact ? 1 : 0), 0),
    });

    return exact ? [exact, ...patients] : patients;
  }

  async findAll(limit = 50) {
    const patients = await this.prisma.patient.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        fileNumber: true,
        fullNameAr: true,
        fullNameEn: true,
        phone: true,
        dateOfBirth: true,
        gender: true,
        userId: true,
        createdAt: true,
      },
      orderBy: [{ fullNameEn: 'asc' }, { fullNameAr: 'asc' }],
      take: limit,
    });

    return patients.map((patient: any) => ({
      id: patient.id,
      fileNumber: patient.fileNumber,
      fullNameAr: patient.fullNameAr,
      fullNameEn: patient.fullNameEn,
      phone: patient.phone,
      dateOfBirth: patient.dateOfBirth,
      gender: patient.gender,
      portalLinked: Boolean(patient.userId),
      createdAt: patient.createdAt,
    }));
  }

  async create(body: any, actorUserId: string, ip?: string) {
    const {
      gender,
      dateOfBirth,
      nationalId,
      phone,
      addressStateId,
      addressDetails,
      emergencyContact,
      nationalIdAttachmentPath,
      insuranceAttachmentPath,
    } = body;

    const finalEmergencyContact = emergencyContact || 'Self';
    if (dateOfBirth >= getClinicDateString()) {
      throw new HttpException(
        { code: 'INVALID_DATE_OF_BIRTH', message: 'Date of birth must be in the past.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const normalizedPhone = normalizePatientPhone(phone);
    const normalizedNationalId = normalizeNationalId(nationalId);
    if (!normalizedPhone) {
      throw new HttpException(
        { code: 'PHONE_INVALID', message: 'Phone number is invalid.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (nationalId && !normalizedNationalId) {
      throw new HttpException(
        { code: 'NATIONAL_ID_INVALID', message: 'National ID is invalid.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    try {
      const patient = await this.prisma.$transaction(async (tx: any) => {
        await lockPatientIdentity(tx, { phone: normalizedPhone, dateOfBirth, nationalId: normalizedNationalId });
        const candidates = await findPossiblePatientDuplicates(tx, {
          phone: normalizedPhone,
          dateOfBirth,
          nationalId: normalizedNationalId,
        });

        if (candidates.length) {
          throw new HttpException(
            {
              code: 'POSSIBLE_PATIENT_DUPLICATE',
              message:
                'A possible existing patient was found. Search and select the existing patient or review the identity before creating a new record.',
              details: safeDuplicateCandidates(candidates),
            },
            HttpStatus.CONFLICT,
          );
        }

        const created = await tx.patient.create({
          data: {
            ...structuredPatientName(body),
            gender,
            dateOfBirth,
            nationalId: normalizedNationalId,
            phone: normalizedPhone,
            addressStateId: parseInt(addressStateId, 10),
            addressDetails,
            emergencyContact: finalEmergencyContact,
            status: 'ACTIVE',
            nationalIdAttachmentPath: nationalIdAttachmentPath || null,
            insuranceAttachmentPath: insuranceAttachmentPath || null,
          },
          include: { addressState: true },
        });

        await tx.tenantAuditLog.create({
          data: {
            userId: actorUserId,
            action: 'PATIENT_FILE_CREATED',
            details: JSON.stringify({
              patientId: created.id,
              fileNumber: created.fileNumber,
              context: 'RECEPTION_REGISTRATION',
            }),
            ipAddress: ip || 'unknown',
          },
        });

        return created;
      });

      return patientIdentitySummary(patient);
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      if (error.code === 'P2002') {
        throw new HttpException(
          {
            code: 'POSSIBLE_PATIENT_DUPLICATE',
            message: 'A possible existing patient was found. Search and review the identity before creating a new record.',
          },
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async update(id: string, body: any, actorUserId: string, ip?: string) {
    try {
      const patient = await this.prisma.$transaction(async (tx: any) => {
        await tx.$queryRaw`SELECT "id" FROM "Patient" WHERE "id" = ${id} FOR UPDATE`;
        const existing = await tx.patient.findUnique({ where: { id } });
        if (!existing) {
          throw new HttpException(
            { code: 'PATIENT_NOT_FOUND', message: 'Patient not found.' },
            HttpStatus.NOT_FOUND,
          );
        }

        const name = structuredPatientName(body);
        const updated = await tx.patient.update({
          where: { id: existing.id },
          data: {
            ...(name || {}),
            addressStateId: body.addressStateId,
            addressDetails: body.addressDetails,
            emergencyContact: body.emergencyContact,
          },
        });

        await tx.tenantAuditLog.create({
          data: {
            userId: actorUserId,
            action: 'PATIENT_IDENTITY_UPDATED',
            details: JSON.stringify({
              patientId: updated.id,
              changedFields: Object.keys(body),
            }),
            ipAddress: ip || 'unknown',
          },
        });

        return updated;
      });

      return patientIdentitySummary(patient);
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      if (error.status && error.code) {
        throw new HttpException({ code: error.code, message: error.message }, error.status);
      }
      throw error;
    }
  }

  async findOne(id: string, user: any) {
    if (user.role === 'DOCTOR' && !(await doctorHasPatientAccess(user, id))) {
      throw new HttpException(
        {
          code: 'PATIENT_ACCESS_FORBIDDEN',
          message: 'This patient is not assigned to the authenticated doctor.',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    const patient = await this.prisma.patient.findUnique({
      where: { id },
      include: { addressState: true },
    });

    if (!patient) {
      throw new HttpException(
        { code: 'PATIENT_NOT_FOUND', message: 'Patient not found.' },
        HttpStatus.NOT_FOUND,
      );
    }

    return patient;
  }

  async getHistory(patientId: string, user: any) {
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

    const parsedHistory = records.map((rec: any) => ({
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
      symptoms: this.cryptoService ? this.cryptoService.decryptMedical(rec.symptomsEncrypted) : '',
      diagnosis: this.cryptoService ? this.cryptoService.decryptMedical(rec.diagnosisEncrypted) : '',
      treatment: this.cryptoService ? this.cryptoService.decryptMedical(rec.treatmentEncrypted) : '',
      clinicalNotes: this.cryptoService ? this.cryptoService.decryptMedical(rec.clinicalNotesEncrypted) : '',
      attachmentPath: rec.attachmentPath,
    }));

    return {
      patientId: patient.id,
      fileNumber: patient.fileNumber,
      fullNameAr: patient.fullNameAr,
      fullNameEn: patient.fullNameEn,
      hasFullAccess: recordAccess.hasCrossDoctorAccess,
      history: parsedHistory,
    };
  }

  /**
   * Express parity for GET /patients/:id/profile. Resolves to null when the
   * patient does not exist; the controller owns the legacy 404/500 bodies.
   */
  async getProfile(patientId: string, user: any) {
    const isDoctor = user.role === 'DOCTOR';
    const canViewBilling = user.role === 'ADMIN' || user.role === 'RECEPTIONIST';
    const canViewPatientProfile =
      isDoctor && (await doctorHasPatientAccess(user, patientId, this.prisma));
    if (isDoctor && !canViewPatientProfile) {
      throw new HttpException(
        {
          code: 'PATIENT_ACCESS_FORBIDDEN',
          message: 'This patient is not assigned to the authenticated doctor.',
        },
        HttpStatus.FORBIDDEN,
      );
    }
    const recordAccess = isDoctor
      ? await getDoctorMedicalRecordAccess(user, patientId, undefined, this.prisma)
      : null;

    const select: any = {
      id: true,
      fileNumber: true,
      fullNameAr: true,
      fullNameEn: true,
      gender: true,
      ...(isDoctor ? { bloodType: true } : {}),
      dateOfBirth: true,
      phone: true,
      emergencyContact: true,
      status: true,
      userId: true,
      addressState: { select: { labelAr: true, labelEn: true } },
      appointments: {
        where: isDoctor ? { doctorId: user.doctorId } : undefined,
        orderBy: [{ appointmentDate: 'desc' }, { appointmentTime: 'desc' }],
        take: 50,
        select: {
          id: true,
          appointmentDate: true,
          appointmentTime: true,
          status: true,
          doctor: {
            select: { fullNameAr: true, fullNameEn: true, specialtyAr: true, specialtyEn: true },
          },
        },
      },
      ...(canViewBilling
        ? {
            invoices: {
              orderBy: { invoiceDate: 'desc' },
              take: 50,
              select: {
                id: true,
                invoiceDate: true,
                totalAmountSdg: true,
                totalAmountUsd: true,
                paymentStatus: true,
                invoiceType: true,
              },
            },
            insuranceClaims: {
              take: 1,
              orderBy: [{ submissionDate: 'desc' }, { paymentDate: 'desc' }],
              select: {
                claimStatus: true,
                insuranceCompany: {
                  select: { labelAr: true, labelEn: true, copayPercentage: true },
                },
              },
            },
          }
        : {}),
      ...(isDoctor
        ? {
            medicalRecords: {
              where: recordAccess?.where,
              orderBy: { visitDate: 'desc' },
              take: 50,
              include: {
                doctor: {
                  select: { fullNameAr: true, fullNameEn: true, specialtyAr: true, specialtyEn: true },
                },
                prescriptions: {
                  orderBy: { prescriptionDate: 'desc' },
                  include: {
                    prescribedDrugs: {
                      select: {
                        customDrugName: true,
                        dosage: true,
                        duration: true,
                        instructionsAr: true,
                        instructionsEn: true,
                        qtyPrescribed: true,
                        qtyDispensed: true,
                        drug: {
                          select: {
                            labelAr: true,
                            labelEn: true,
                            genericName: true,
                            strength: true,
                            dosageForm: true,
                          },
                        },
                      },
                    },
                  },
                },
                labOrders: {
                  orderBy: { orderDate: 'desc' },
                  include: {
                    items: {
                      select: {
                        customTestName: true,
                        resultValue: true,
                        referenceRangeMin: true,
                        referenceRangeMax: true,
                        isOutOfRange: true,
                        service: { select: { labelAr: true, labelEn: true } },
                      },
                    },
                  },
                },
              },
            },
          }
        : {}),
    };

    const patient: any = await this.prisma.patient.findUnique({ where: { id: patientId }, select });
    if (!patient) return null;

    // Format past visits chronologically (newest first)
    const permittedRecords: any[] = patient.medicalRecords || [];
    const visits = permittedRecords.map((rec: any) => {
      let vitals: any = {};
      if (rec.vitalSignsJson) {
        try {
          vitals =
            typeof rec.vitalSignsJson === 'string' ? JSON.parse(rec.vitalSignsJson) : rec.vitalSignsJson;
        } catch {
          vitals = {};
        }
      }

      return {
        id: rec.id,
        recordId: rec.id,
        appointmentId: rec.appointmentId,
        visitDate: rec.visitDate,
        doctor: {
          fullNameAr: rec.doctor?.fullNameAr || '',
          fullNameEn: rec.doctor?.fullNameEn || '',
          specialtyAr: rec.doctor?.specialtyAr || '',
          specialtyEn: rec.doctor?.specialtyEn || '',
        },
        vitals,
        symptoms: isDoctor ? this.decryptClinical(rec.symptomsEncrypted) : undefined,
        diagnosis: isDoctor ? this.decryptClinical(rec.diagnosisEncrypted) : undefined,
        treatment: isDoctor ? this.decryptClinical(rec.treatmentEncrypted) : undefined,
        clinicalNotes: isDoctor ? this.decryptClinical(rec.clinicalNotesEncrypted) : undefined,
        prescriptionsCount: (rec.prescriptions || []).reduce(
          (acc: number, p: any) => acc + (p.prescribedDrugs?.length || 0),
          0,
        ),
        labOrdersCount: (rec.labOrders || []).reduce(
          (acc: number, lo: any) => acc + (lo.items?.length || 0),
          0,
        ),
      };
    });

    const prescriptions = permittedRecords
      .flatMap((record: any) =>
        (record.prescriptions || []).map((prescription: any) => ({
          id: prescription.id,
          prescriptionDate: prescription.prescriptionDate,
          status: prescription.status,
          doctor: record.doctor,
          medicines: prescription.prescribedDrugs.map((item: any) => ({
            nameAr: item.drug?.labelAr || item.customDrugName || '',
            nameEn: item.drug?.labelEn || item.customDrugName || '',
            genericName: item.drug?.genericName || item.customDrugName || '',
            strength: item.drug?.strength || '',
            dosageForm: item.drug?.dosageForm || '',
            dosage: item.dosage,
            duration: item.duration,
            instructionsAr: item.instructionsAr,
            instructionsEn: item.instructionsEn,
            qtyPrescribed: item.qtyPrescribed,
            qtyDispensed: item.qtyDispensed,
          })),
        })),
      )
      .sort((a: any, b: any) => new Date(b.prescriptionDate).getTime() - new Date(a.prescriptionDate).getTime())
      .slice(0, 50);

    const laboratory = permittedRecords
      .flatMap((record: any) =>
        (record.labOrders || []).map((order: any) => ({
          id: order.id,
          orderDate: order.orderDate,
          status: order.status,
          doctor: record.doctor,
          tests: order.items.map((item: any) => ({
            nameAr: item.service?.labelAr || item.customTestName || '',
            nameEn: item.service?.labelEn || item.customTestName || '',
            resultValue: item.resultValue,
            referenceRangeMin: item.referenceRangeMin == null ? null : Number(item.referenceRangeMin),
            referenceRangeMax: item.referenceRangeMax == null ? null : Number(item.referenceRangeMax),
            isOutOfRange: item.isOutOfRange,
          })),
        })),
      )
      .sort((a: any, b: any) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime())
      .slice(0, 50);

    const activeClaim = patient.insuranceClaims?.[0];

    return {
      id: patient.id,
      fileNumber: patient.fileNumber,
      portalLinked: Boolean(patient.userId),
      fullNameAr: patient.fullNameAr,
      fullNameEn: patient.fullNameEn,
      gender: patient.gender,
      ...(isDoctor ? { bloodType: patient.bloodType || null } : {}),
      dateOfBirth: patient.dateOfBirth,
      phone: patient.phone,
      status: patient.status,
      emergencyContact: patient.emergencyContact || '',
      addressState: patient.addressState
        ? {
            id: patient.addressState.id,
            labelAr: patient.addressState.labelAr,
            labelEn: patient.addressState.labelEn,
          }
        : null,
      insurance: activeClaim
        ? {
            providerName:
              activeClaim.insuranceCompany?.labelAr ||
              activeClaim.insuranceCompany?.labelEn ||
              'Insurance',
            claimStatus: activeClaim.claimStatus,
            coverageRate: activeClaim.insuranceCompany?.copayPercentage
              ? Number(activeClaim.insuranceCompany.copayPercentage)
              : 0,
          }
        : null,
      visitsCount: visits.length,
      visits,
      prescriptions,
      laboratory,
      summaryCounts: {
        appointments: patient.appointments.length,
        visits: visits.length,
        prescriptions: prescriptions.length,
        labOrders: laboratory.length,
        invoices: canViewBilling ? (patient.invoices || []).length : undefined,
      },
      availableSections: isDoctor
        ? ['overview', 'appointments', 'visits', 'prescriptions', 'laboratory']
        : ['overview', 'appointments', 'billing'],
      appointments: (patient.appointments || []).map((appointment: any) => ({
        id: appointment.id,
        appointmentDate: appointment.appointmentDate,
        appointmentTime: appointment.appointmentTime,
        status: appointment.status,
        doctor: appointment.doctor
          ? {
              fullNameAr: appointment.doctor.fullNameAr,
              fullNameEn: appointment.doctor.fullNameEn,
              specialtyAr: appointment.doctor.specialtyAr,
              specialtyEn: appointment.doctor.specialtyEn,
            }
          : null,
      })),
      invoices: canViewBilling
        ? (patient.invoices || []).map((invoice: any) => ({
            id: invoice.id,
            invoiceDate: invoice.invoiceDate,
            totalAmountSdg: Number(invoice.totalAmountSdg),
            totalAmountUsd: Number(invoice.totalAmountUsd),
            paymentStatus: invoice.paymentStatus,
            invoiceType: invoice.invoiceType,
          }))
        : [],
    };
  }

  private decryptClinical(cipherText: string | null): string {
    if (!this.cryptoService) {
      throw new Error('Clinical decryption service is not configured.');
    }
    return this.cryptoService.decryptMedical(cipherText as string);
  }
}
