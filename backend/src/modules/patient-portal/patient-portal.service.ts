import {
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { createRequire } from 'node:module';
import { PrismaService } from '../../database/prisma.service.js';

const require = createRequire(import.meta.url);
const { patientIdentitySummary } = require('../../utils/patientOnboarding.js');
const { normalizeEmail, normalizePhone } = require('../../utils/identity.js');
const { createVerificationChallenge, consumeVerificationChallenge, invalidateChallenges } = require('../../services/verification.js');
const { linkGooglePatientIdentity, unlinkGooglePatientIdentity } = require('../../services/googlePatientIdentity.js');
const { getConfiguredSlots, lockDoctorScheduleRows, todayString } = require('../../utils/scheduling.js');
const { decrypt, isClinicalDataDecryptionError } = require('../../utils/encryption.js');
const { cancellationCutoffReached } = require('../../utils/clinicTime.js');

const logger = new Logger('PatientPortalService');

const doctorSelect = {
  id: true,
  fullNameAr: true,
  fullNameEn: true,
  specialtyAr: true,
  specialtyEn: true,
  specialty: { select: { id: true, nameAr: true, nameEn: true } },
  consultationFee: true,
  status: true,
};

const patientLabItemSelect = {
  id: true,
  customTestName: true,
  labReviewStatus: true,
  resultValue: true,
  referenceRangeMin: true,
  referenceRangeMax: true,
  isOutOfRange: true,
  fileAttachmentPath: true,
  service: { select: { labelAr: true, labelEn: true, category: true } },
};

const CANCELLABLE_STATUSES = ['PENDING', 'SCHEDULED', 'CONFIRMED'];
const RESCHEDULABLE_STATUSES = ['PENDING', 'SCHEDULED', 'CONFIRMED'];

/** Same envelope as Express sendError(res, status, code, message). */
function apiError(status: number, code: string, message: string) {
  return new HttpException({ error: { code, message } }, status);
}

function activeDoctorWhere() {
  return {
    status: 'ACTIVE',
    user: { status: 'ACTIVE' },
    OR: [{ specialtyId: null }, { specialty: { active: true } }],
  };
}

function stateConflict() {
  return apiError(409, 'APPOINTMENT_STATE_CONFLICT', 'Appointment state changed before this operation could be completed.');
}

function isAppointmentSlotConflict(error: any) {
  if (error?.code !== 'P2002') return false;
  const target = error?.meta?.target;
  return String(error.message || '').includes('Appointment_active_doctor_slot_key')
    || (Array.isArray(target)
      && ['doctorId', 'appointmentDate', 'appointmentTime'].every((field) => target.includes(field)));
}

function attachmentUrl(path: string | null | undefined) {
  return path ? `/api/upload/${path.split('/').pop()}` : null;
}

function mapPatientSafeLabTests(order: any) {
  return (order.items || [])
    .filter((item: any) => item.labReviewStatus !== 'EXTERNAL' && item.resultValue != null)
    .map((item: any) => ({
      id: item.id,
      service: item.service,
      customTestName: item.customTestName,
      testNameAr: item.service?.labelAr || item.customTestName || '',
      testNameEn: item.service?.labelEn || item.customTestName || '',
      resultValue: item.resultValue,
      referenceRangeMin: item.referenceRangeMin == null ? '' : String(item.referenceRangeMin),
      referenceRangeMax: item.referenceRangeMax == null ? '' : String(item.referenceRangeMax),
      isOutOfRange: Boolean(item.isOutOfRange),
      releasedToPatientAt: order.releasedToPatientAt,
      attachmentPath: attachmentUrl(item.fileAttachmentPath),
    }));
}

function parsePatientVitalSigns(value: any) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value || '{}') : value;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(([, item]) => ['string', 'number'].includes(typeof item)),
    );
  } catch {
    return {};
  }
}

function medicineOf(item: any, drug: any) {
  return drug || {
    labelAr: item.customDrugName || '',
    labelEn: item.customDrugName || '',
    genericName: item.customDrugName || '',
    strength: '',
    dosageForm: '',
  };
}

@Injectable()
export class PatientPortalService {
  constructor(private readonly prisma: PrismaService) {}

  private async getOwnedPatient(userId: string) {
    const patient = await this.prisma.patient.findUnique({
      where: { userId },
    });
    if (!patient) {
      throw new HttpException(
        {
          code: 'PATIENT_RECORD_NOT_LINKED',
          message: 'This account is not linked to a patient record.',
        },
        HttpStatus.CONFLICT,
      );
    }
    return patient;
  }

  async getMe(userId: string) {
    const patient = await this.getOwnedPatient(userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        phoneNormalized: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        preferredLanguage: true,
        externalIdentities: {
          where: { provider: 'GOOGLE' },
          select: { normalizedEmailAtLink: true, createdAt: true },
          take: 1,
        },
      },
    });

    const googleIdentity = user?.externalIdentities?.[0];
    const googleAccount = {
      linked: Boolean(googleIdentity),
      ...(googleIdentity
        ? {
            email: googleIdentity.normalizedEmailAtLink,
            linkedAt: googleIdentity.createdAt,
          }
        : {}),
    };

    return {
      ...patientIdentitySummary(patient),
      id: patient.id,
      fileNumber: patient.fileNumber,
      fullNameAr: patient.fullNameAr,
      fullNameEn: patient.fullNameEn,
      gender: patient.gender,
      dateOfBirth: patient.dateOfBirth,
      phone: user?.phoneNormalized,
      email: user?.email,
      phoneVerified: Boolean(user?.phoneVerifiedAt),
      emailVerified: Boolean(user?.emailVerifiedAt),
      addressStateId: patient.addressStateId,
      addressDetails: patient.addressDetails,
      emergencyContact: patient.emergencyContact,
      bloodType: patient.bloodType,
      preferredLanguage: user?.preferredLanguage,
      googleAccount,
    };
  }

  async updateMe(userId: string, body: any, ip?: string) {
    const patient = await this.getOwnedPatient(userId);

    await this.prisma.$transaction(async (tx: any) => {
      await tx.patient.update({
        where: { id: patient.id },
        data: {
          addressStateId: body.addressStateId,
          addressDetails: body.addressDetails,
          emergencyContact: body.emergencyContact,
          bloodType: body.bloodType,
        },
      });

      if (body.preferredLanguage) {
        await tx.user.update({
          where: { id: userId },
          data: { preferredLanguage: body.preferredLanguage },
        });
      }

      await tx.tenantAuditLog.create({
        data: {
          userId,
          action: 'PATIENT_PROFILE_UPDATED',
          details: 'Patient updated self-service contact/profile fields.',
          ipAddress: ip || 'unknown',
        },
      });
    });

    return { success: true };
  }

  async requestEmailChange(userId: string, authVersion: number, body: { email: string; currentPassword: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.authVersion !== authVersion || !await bcrypt.compare(body.currentPassword, user.passwordHash)) {
      throw new HttpException(
        { code: 'REAUTHENTICATION_FAILED', message: 'Current credentials are invalid.' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const email = normalizeEmail(body.email);
    const { challenge, developmentCode } = await createVerificationChallenge(user, 'PROFILE_EMAIL_CHANGE', email);
    return {
      state: 'VERIFICATION_REQUIRED',
      challengeId: challenge.id,
      expiresInMinutes: 10,
      ...(developmentCode ? { developmentCode } : {}),
    };
  }

  async verifyEmailChange(userId: string, authVersion: number, body: { challengeId: string; code: string; currentPassword: string }, ip?: string) {
    try {
      await consumeVerificationChallenge({
        ...body,
        purpose: 'PROFILE_EMAIL_CHANGE',
        userId,
        authVersion,
        transition: async (tx: any, challenge: any) => {
          await tx.user.update({
            where: { id: userId },
            data: {
              email: challenge.targetNormalized,
              emailVerifiedAt: new Date(),
              authVersion: { increment: 1 },
              ...(challenge.user.username === challenge.user.email ? { username: challenge.targetNormalized } : {}),
            },
          });
          await invalidateChallenges(tx, userId);
          await tx.tenantAuditLog.create({
            data: {
              userId,
              action: 'PATIENT_EMAIL_CHANGED',
              details: 'Patient changed verified recovery email after password reauthentication. All sessions revoked.',
              ipAddress: ip || 'unknown',
            },
          });
        },
      });
      return { success: true, reauthenticationRequired: true };
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      if (error.code === 'P2002') {
        throw new HttpException(
          { code: 'EMAIL_CHANGE_UNAVAILABLE', message: 'Unable to complete this email change.' },
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async requestPhoneChange(userId: string, authVersion: number, phoneStr: string) {
    const phone = normalizePhone(phoneStr);
    if (!phone) {
      throw new HttpException(
        { code: 'PHONE_INVALID', message: 'Phone number is invalid.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.authVersion !== authVersion) {
      throw new HttpException(
        { code: 'SESSION_REVOKED', message: 'Sign in again.' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (!user.emailVerifiedAt) {
      throw new HttpException(
        { code: 'VERIFIED_EMAIL_REQUIRED', message: 'A verified email is required before changing the phone number.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const { challenge, developmentCode } = await createVerificationChallenge(user, 'PROFILE_PHONE_CHANGE', phone);
    return {
      state: 'VERIFICATION_REQUIRED',
      challengeId: challenge.id,
      expiresInMinutes: 10,
      ...(developmentCode ? { developmentCode } : {}),
    };
  }

  async verifyPhoneChange(userId: string, authVersion: number, body: { challengeId: string; code: string }, ip?: string) {
    try {
      await consumeVerificationChallenge({
        ...body,
        purpose: 'PROFILE_PHONE_CHANGE',
        userId,
        authVersion,
        transition: async (tx: any, challenge: any) => {
          await tx.user.update({
            where: { id: userId },
            data: {
              phoneNormalized: challenge.targetNormalized,
              phoneVerifiedAt: null,
              authVersion: { increment: 1 },
              ...(challenge.user.username === challenge.user.phoneNormalized ? { username: challenge.targetNormalized } : {}),
            },
          });
          await tx.patient.update({
            where: { userId },
            data: { phone: challenge.targetNormalized },
          });
          await invalidateChallenges(tx, userId);
          await tx.tenantAuditLog.create({
            data: {
              userId,
              action: 'PATIENT_PHONE_CHANGED',
              details: 'Patient changed contact phone through verified email authorization. Sessions revoked; new phone remains unverified.',
              ipAddress: ip || 'unknown',
            },
          });
        },
      });
      return { success: true, phoneVerified: false, reauthenticationRequired: true };
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      if (error.code === 'P2002') {
        throw new HttpException(
          { code: 'PHONE_CHANGE_UNAVAILABLE', message: 'Unable to complete this phone change.' },
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async linkGoogle(userId: string, body: any, ip?: string) {
    return linkGooglePatientIdentity({
      userId,
      currentPassword: body.currentPassword,
      credential: body.credential,
      onLinked: (tx: any, identity: any) =>
        tx.tenantAuditLog.create({
          data: {
            userId,
            action: 'PATIENT_GOOGLE_LINKED',
            details: `Patient linked Google account ${identity.normalizedEmailAtLink}.`,
            ipAddress: ip || 'unknown',
          },
        }),
    });
  }

  async unlinkGoogle(userId: string, body: any, ip?: string) {
    return unlinkGooglePatientIdentity({
      userId,
      currentPassword: body.currentPassword,
      onUnlinked: (tx: any) =>
        tx.tenantAuditLog.create({
          data: {
            userId,
            action: 'PATIENT_GOOGLE_UNLINKED',
            details: 'Patient unlinked Google account.',
            ipAddress: ip || 'unknown',
          },
        }),
    });
  }

  // ---- Doctors & specialties (public to any linked patient) ----

  async listDoctors() {
    return this.prisma.doctor.findMany({
      where: activeDoctorWhere(),
      select: doctorSelect,
      orderBy: { fullNameEn: 'asc' },
    });
  }

  async listSpecialties() {
    const specialties = await this.prisma.specialty.findMany({
      where: { active: true },
      select: { id: true, nameAr: true, nameEn: true },
      orderBy: { nameEn: 'asc' },
    });
    return specialties.map(({ id, nameAr, nameEn }) => ({ id, labelAr: nameAr, labelEn: nameEn }));
  }

  async getDoctor(id: string) {
    const doctor = await this.prisma.doctor.findFirst({
      where: { id, ...activeDoctorWhere() },
      select: doctorSelect,
    });
    if (!doctor) throw apiError(404, 'DOCTOR_NOT_FOUND', 'Doctor not found.');
    return doctor;
  }

  // ---- Appointments ----

  async listAppointments(patientId: string, groupParam: unknown) {
    const group = groupParam || 'all';
    const today = todayString();
    const where: any = { patientId };
    if (group === 'upcoming') Object.assign(where, { appointmentDate: { gte: today }, status: { notIn: ['CANCELLED', 'COMPLETED', 'NO_SHOW'] } });
    if (group === 'past') Object.assign(where, { OR: [{ appointmentDate: { lt: today } }, { status: { in: ['COMPLETED', 'NO_SHOW'] } }] });
    if (group === 'cancelled') Object.assign(where, { status: 'CANCELLED' });
    const appointments = await this.prisma.appointment.findMany({
      where,
      include: { doctor: { select: doctorSelect } },
      orderBy: [{ appointmentDate: 'desc' }, { appointmentTime: 'desc' }],
    });
    return appointments.map(({ patientId: _patientId, ...appointment }) => appointment);
  }

  async getAppointment(patientId: string, id: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id, patientId },
      include: { doctor: { select: doctorSelect } },
    });
    if (!appointment) throw apiError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found.');
    const { patientId: _patientId, ...safe } = appointment;
    return safe;
  }

  private async validateSlot(doctorId: string, date: string, time: string) {
    if (date < todayString()) throw apiError(422, 'APPOINTMENT_DATE_IN_PAST', 'Past appointment dates are not allowed.');
    const doctor = await this.prisma.doctor.findFirst({ where: { id: doctorId, status: 'ACTIVE' } });
    if (!doctor) throw apiError(404, 'DOCTOR_NOT_FOUND', 'Active doctor not found.');
    if (!(await getConfiguredSlots(doctor, date, undefined, this.prisma)).includes(time)) {
      throw apiError(422, 'INVALID_APPOINTMENT_SLOT', 'The selected time is not in the doctor schedule.');
    }
    return doctor;
  }

  async bookAppointment(patient: { id: string; userId: string }, body: BookingInput, ip?: string) {
    try {
      await this.validateSlot(body.doctorId, body.appointmentDate, body.appointmentTime);
      return await this.prisma.$transaction(async (tx: any) => {
        if (!(await lockDoctorScheduleRows(tx, [body.doctorId]))) {
          throw apiError(404, 'DOCTOR_NOT_FOUND', 'Active doctor not found.');
        }
        const doctor = await tx.doctor.findFirst({ where: { id: body.doctorId, status: 'ACTIVE' } });
        if (!(await getConfiguredSlots(doctor, body.appointmentDate, undefined, tx)).includes(body.appointmentTime)) {
          throw apiError(409, 'INVALID_APPOINTMENT_SLOT', 'The selected appointment time is no longer available in the doctor schedule.');
        }
        const created = await tx.appointment.create({
          data: { patientId: patient.id, ...body, status: 'PENDING' },
          include: { doctor: { select: doctorSelect } },
        });
        await tx.tenantAuditLog.create({
          data: {
            userId: patient.userId,
            action: 'PATIENT_APPOINTMENT_BOOKED',
            details: `Patient booked appointment ${created.id}.`,
            ipAddress: ip || 'unknown',
          },
        });
        return created;
      });
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      if (error?.code === 'P2002') {
        throw apiError(409, 'APPOINTMENT_SLOT_UNAVAILABLE', 'This appointment slot is no longer available.');
      }
      throw error;
    }
  }

  async cancelAppointment(patient: { id: string; userId: string }, id: string, ip?: string) {
    const appointment = await this.prisma.appointment.findFirst({ where: { id, patientId: patient.id } });
    if (!appointment) throw apiError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found.');
    if (!CANCELLABLE_STATUSES.includes(appointment.status)) {
      throw apiError(409, 'APPOINTMENT_CANNOT_BE_CANCELLED', 'Appointment can no longer be cancelled.');
    }
    const cutoffHours = Number(process.env.PATIENT_CANCELLATION_CUTOFF_HOURS || 2);
    if (cancellationCutoffReached(appointment.appointmentDate, appointment.appointmentTime, cutoffHours)) {
      throw apiError(409, 'CANCELLATION_CUTOFF_REACHED', 'Appointment cancellation cutoff has passed.');
    }
    await this.prisma.$transaction(async (tx: any) => {
      const claimed = await tx.appointment.updateMany({
        where: {
          id: appointment.id,
          patientId: patient.id,
          status: appointment.status,
          doctorId: appointment.doctorId,
          appointmentDate: appointment.appointmentDate,
          appointmentTime: appointment.appointmentTime,
        },
        data: { status: 'CANCELLED' },
      });
      if (claimed.count !== 1) throw stateConflict();
      await tx.tenantAuditLog.create({
        data: {
          userId: patient.userId,
          action: 'PATIENT_APPOINTMENT_CANCELLED',
          details: `Patient cancelled appointment ${appointment.id}.`,
          ipAddress: ip || 'unknown',
        },
      });
    });
    return { success: true };
  }

  async rescheduleAppointment(patient: { id: string; userId: string }, id: string, body: BookingInput, ip?: string) {
    const appointment = await this.prisma.appointment.findFirst({ where: { id, patientId: patient.id } });
    if (!appointment) throw apiError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found.');
    if (!RESCHEDULABLE_STATUSES.includes(appointment.status)) {
      throw apiError(409, 'APPOINTMENT_CANNOT_BE_RESCHEDULED', 'Appointment can no longer be rescheduled.');
    }
    await this.validateSlot(body.doctorId, body.appointmentDate, body.appointmentTime);
    try {
      return await this.prisma.$transaction(async (tx: any) => {
        if (!(await lockDoctorScheduleRows(tx, [appointment.doctorId, body.doctorId]))) {
          throw apiError(404, 'DOCTOR_NOT_FOUND', 'Active doctor not found.');
        }
        const targetDoctor = await tx.doctor.findFirst({ where: { id: body.doctorId, status: 'ACTIVE' } });
        if (!(await getConfiguredSlots(targetDoctor, body.appointmentDate, undefined, tx)).includes(body.appointmentTime)) {
          throw apiError(409, 'INVALID_APPOINTMENT_SLOT', 'The selected appointment time is no longer available in the doctor schedule.');
        }
        const claimed = await tx.appointment.updateMany({
          where: {
            id: appointment.id,
            patientId: patient.id,
            status: appointment.status,
            doctorId: appointment.doctorId,
            appointmentDate: appointment.appointmentDate,
            appointmentTime: appointment.appointmentTime,
          },
          data: { ...body, status: 'PENDING' },
        });
        if (claimed.count !== 1) throw stateConflict();
        await tx.tenantAuditLog.create({
          data: {
            userId: patient.userId,
            action: 'PATIENT_APPOINTMENT_RESCHEDULED',
            details: `Patient rescheduled appointment ${appointment.id}.`,
            ipAddress: ip || 'unknown',
          },
        });
        return tx.appointment.findUnique({
          where: { id: appointment.id },
          include: { doctor: { select: doctorSelect } },
        });
      });
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      if (isAppointmentSlotConflict(error)) {
        throw apiError(409, 'APPOINTMENT_SLOT_UNAVAILABLE', 'The requested new slot is no longer available; the original appointment was preserved.');
      }
      throw error;
    }
  }

  // ---- Lab results, prescriptions, medical records ----

  async listLabResults(patientId: string) {
    const orders = await this.prisma.labOrder.findMany({
      where: {
        patientId,
        status: 'COMPLETED',
        releasedToPatientAt: { not: null },
      },
      select: {
        id: true,
        orderDate: true,
        releasedToPatientAt: true,
        doctor: { select: doctorSelect },
        items: { select: patientLabItemSelect },
      },
      orderBy: { orderDate: 'desc' },
    });
    return orders.map((order) => ({
      id: order.id,
      orderDate: order.orderDate,
      releasedAt: order.releasedToPatientAt,
      doctor: order.doctor,
      tests: mapPatientSafeLabTests(order),
    }));
  }

  async listPrescriptions(patientId: string) {
    const prescriptions = await this.prisma.prescription.findMany({
      where: { patientId },
      include: {
        doctor: { select: doctorSelect },
        prescribedDrugs: {
          include: {
            drug: { select: { labelAr: true, labelEn: true, genericName: true, strength: true, dosageForm: true } },
          },
        },
      },
      orderBy: { prescriptionDate: 'desc' },
    });
    return prescriptions.map((rx) => ({
      id: rx.id,
      prescriptionDate: rx.prescriptionDate,
      status: rx.status,
      doctor: rx.doctor,
      medicines: rx.prescribedDrugs.map((item) => ({
        id: item.id,
        medicine: medicineOf(item, item.drug),
        customDrugName: item.customDrugName,
        dosage: item.dosage,
        duration: item.duration,
        instructionsAr: item.instructionsAr,
        instructionsEn: item.instructionsEn,
        qtyPrescribed: item.qtyPrescribed,
        qtyDispensed: item.qtyDispensed,
      })),
    }));
  }

  async listMedicalRecords(patientId: string) {
    const records = await this.prisma.medicalRecord.findMany({
      where: { patientId },
      include: {
        doctor: { select: doctorSelect },
        prescriptions: { select: { id: true, status: true } },
        labOrders: {
          where: { releasedToPatientAt: { not: null } },
          select: { id: true, status: true, releasedToPatientAt: true },
        },
      },
      orderBy: { visitDate: 'desc' },
    });
    return records.map((record) => ({
      id: record.id,
      visitDate: record.visitDate,
      doctor: record.doctor,
      diagnosis: decrypt(record.diagnosisEncrypted),
      treatment: decrypt(record.treatmentEncrypted),
      prescriptions: record.prescriptions,
      releasedLabResults: record.labOrders,
      attachmentPath: attachmentUrl(record.attachmentPath),
    }));
  }

  async getMedicalRecord(patientId: string, id: string) {
    let record: any;
    try {
      record = await this.prisma.medicalRecord.findFirst({
        where: { id, patientId },
        include: {
          doctor: { select: doctorSelect },
          prescriptions: {
            include: {
              prescribedDrugs: {
                include: { drug: true },
              },
            },
          },
          labOrders: {
            where: { releasedToPatientAt: { not: null } },
            select: {
              releasedToPatientAt: true,
              items: { select: patientLabItemSelect },
            },
          },
        },
      });
    } catch (error) {
      this.failMedicalRecordDetail(error);
    }

    // Not-found is returned outside the detail try-block (as in Express).
    if (!record) throw apiError(404, 'MEDICAL_RECORD_NOT_FOUND', 'Medical record not found.');

    try {
      return {
        id: record.id,
        visitDate: record.visitDate,
        doctor: record.doctor,
        symptoms: decrypt(record.symptomsEncrypted),
        diagnosis: decrypt(record.diagnosisEncrypted),
        treatment: decrypt(record.treatmentEncrypted),
        vitalSigns: parsePatientVitalSigns(record.vitalSignsJson),
        prescriptions: (record.prescriptions || []).map((prescription: any) => ({
          id: prescription.id,
          status: prescription.status,
          medicines: (prescription.prescribedDrugs || []).map((item: any) => ({
            id: item.id,
            medicine: medicineOf(item, item.drug),
            customDrugName: item.customDrugName,
            dosage: item.dosage,
            duration: item.duration,
            instructionsAr: item.instructionsAr,
            instructionsEn: item.instructionsEn,
            qtyPrescribed: item.qtyPrescribed,
            qtyDispensed: item.qtyDispensed,
          })),
        })),
        releasedLabResults: (record.labOrders || []).flatMap((order: any) => mapPatientSafeLabTests(order)),
        attachmentPath: attachmentUrl(record.attachmentPath),
      };
    } catch (error) {
      this.failMedicalRecordDetail(error);
    }
  }

  private failMedicalRecordDetail(error: any): never {
    if (isClinicalDataDecryptionError(error)) {
      throw apiError(500, 'CLINICAL_DATA_UNREADABLE', 'Clinical information is unavailable.');
    }
    logger.error('Fetch patient medical record detail error:', error?.stack ?? String(error));
    throw apiError(500, 'MEDICAL_RECORD_DETAIL_FAILED', 'Failed to retrieve medical record.');
  }
}

export type BookingInput = { doctorId: string; appointmentDate: string; appointmentTime: string };
