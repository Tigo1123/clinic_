import {
  Injectable,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { createRequire } from 'node:module';
import { PrismaService } from '../../database/prisma.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';

const require = createRequire(import.meta.url);
const {
  getAvailableSlots,
  getConfiguredSlots,
  lockDoctorScheduleRows,
  todayString,
} = require('../../utils/scheduling.js');
const {
  normalizeNationalId,
  normalizePatientPhone,
  findPossiblePatientDuplicates,
  safeDuplicateCandidates,
} = require('../../utils/patientIdentity.js');
const {
  publicDoctorSelect,
  toPublicBookingConfirmation,
  toPublicDoctor,
} = require('../../utils/publicDto.js');
const { structuredPatientName } = require('../../utils/patientName.js');
const { lockPatientIdentity } = require('../../utils/patientOnboarding.js');
const {
  finishAppointmentOtp,
  issueAppointmentOtp,
  reserveAppointmentOtp,
} = require('../../services/appointmentOtp.js');
const {
  sendBookingConfirmation,
  sendStatusUpdateNotification,
} = require('../../utils/notifications.js');

const transitions: Record<string, string[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  SCHEDULED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['IN_CONSULTATION', 'CANCELLED', 'NO_SHOW'],
  IN_CONSULTATION: ['WAITING_LAB', 'COMPLETED'],
  WAITING_LAB: ['IN_CONSULTATION'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

function appointmentStateConflict() {
  return new HttpException(
    {
      code: 'APPOINTMENT_STATE_CONFLICT',
      message: 'Appointment state changed before this operation could be completed.',
    },
    HttpStatus.CONFLICT,
  );
}

function isAppointmentSlotConflict(error: any) {
  if (error?.code !== 'P2002') return false;
  const target = error?.meta?.target;
  const slotFields = ['doctorId', 'appointmentDate', 'appointmentTime'];
  const metadataMatchesSlot =
    Array.isArray(target) &&
    target.length === slotFields.length &&
    slotFields.every((field) => target.includes(field)) &&
    (!error?.meta?.modelName || error.meta.modelName === 'Appointment');
  return (
    metadataMatchesSlot ||
    String(error.message || '').includes('Appointment_active_doctor_slot_key')
  );
}

function isPatientNationalIdConflict(error: any) {
  if (error?.code !== 'P2002') return false;
  const target = error?.meta?.target;
  return (
    (Array.isArray(target) && target.includes('nationalId')) ||
    String(error.message || '').includes('Patient_nationalId_key')
  );
}

function isEmergencyOverrideConflict(error: any) {
  return (
    error?.code === 'P2002' &&
    String(error.message || '').includes('EmergencyOverride_appointmentId_key')
  );
}

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  async getSlots(doctorId: string, date: string) {
    if (date < todayString()) {
      throw new HttpException(
        { code: 'APPOINTMENT_DATE_IN_PAST', message: 'Past appointment dates are not allowed.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const doctor = await this.prisma.doctor.findUnique({
      where: {
        id: doctorId,
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
        OR: [{ specialtyId: null }, { specialty: { active: true } }],
      },
    });

    if (!doctor || doctor.status !== 'ACTIVE') {
      throw new HttpException(
        { error: 'Active doctor not found.' },
        HttpStatus.NOT_FOUND,
      );
    }

    return getAvailableSlots(doctor, date, undefined, this.prisma);
  }

  async requestOtp(phoneRaw: string) {
    if (!['development', 'test'].includes(process.env.NODE_ENV || '')) {
      throw new HttpException(
        {
          code: 'SMS_PROVIDER_UNAVAILABLE',
          message: 'SMS verification is not configured. Use an authenticated patient account to book.',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const phone = normalizePatientPhone(phoneRaw);
    if (!phone) {
      throw new HttpException(
        { code: 'PHONE_INVALID', message: 'Phone number is invalid.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const issued = issueAppointmentOtp(phone, code);
    if (!issued.issued) {
      throw new HttpException(
        {
          error: 'Please wait before requesting another verification code.',
          retryAfterSeconds: issued.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return {
      success: true,
      message: 'Development verification code generated.',
      developmentCode: code,
    };
  }

  async book(body: any, ip?: string) {
    if (!['development', 'test'].includes(process.env.NODE_ENV || '')) {
      throw new HttpException(
        {
          code: 'PUBLIC_BOOKING_VERIFICATION_UNAVAILABLE',
          message: 'Public OTP booking is unavailable. Use an authenticated patient account to book.',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const {
      doctorId,
      appointmentDate,
      appointmentTime,
      gender,
      dateOfBirth,
      nationalId,
      phone,
      addressStateId,
      otpCode,
    } = body;

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

    const otpReservation = reserveAppointmentOtp(normalizedPhone, otpCode);
    if (!otpReservation.valid) {
      throw new HttpException(
        { error: 'Incorrect verification code. Please try again.' },
        HttpStatus.BAD_REQUEST,
      );
    }

    let otpConsumed = false;
    try {
      if (appointmentDate < todayString()) {
        throw new HttpException(
          { code: 'APPOINTMENT_DATE_IN_PAST', message: 'Past appointment dates are not allowed.' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (dateOfBirth >= todayString()) {
        throw new HttpException(
          { code: 'INVALID_DATE_OF_BIRTH', message: 'Date of birth must be in the past.' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      const doctor = await this.prisma.doctor.findFirst({
        where: {
          id: doctorId,
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
          OR: [{ specialtyId: null }, { specialty: { active: true } }],
        },
      });
      if (!doctor) {
        throw new HttpException(
          { code: 'DOCTOR_NOT_FOUND', message: 'Active doctor not found.' },
          HttpStatus.NOT_FOUND,
        );
      }

      if (!(await getConfiguredSlots(doctor, appointmentDate, undefined, this.prisma)).includes(appointmentTime)) {
        throw new HttpException(
          { code: 'INVALID_APPOINTMENT_SLOT', message: 'The selected time is not in the doctor schedule.' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      const dailyBookingsCount = await this.prisma.appointment.count({
        where: {
          appointmentDate,
          patient: { phone: { in: [...new Set([normalizedPhone, phone.trim()])] } },
        },
      });
      if (dailyBookingsCount >= 2) {
        throw new HttpException(
          { error: 'Sorry, you have exceeded the maximum allowed bookings for today (max 2 per phone).' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      let patient: any = null;
      if (normalizedNationalId) {
        patient = await this.prisma.patient.findUnique({
          where: { nationalId: normalizedNationalId },
        });
        if (patient) {
          const identityMatches =
            normalizePatientPhone(patient.phone) === normalizedPhone &&
            patient.dateOfBirth === dateOfBirth &&
            patient.gender === gender &&
            patient.fullNameAr.trim() === structuredPatientName(body).fullNameAr &&
            patient.fullNameEn.trim().toLocaleLowerCase('en') ===
              structuredPatientName(body).fullNameEn.toLocaleLowerCase('en');
          if (!identityMatches) {
            throw new HttpException(
              {
                code: 'PATIENT_IDENTITY_REVIEW_REQUIRED',
                message: 'The booking could not be linked automatically. Contact reception for identity review.',
              },
              HttpStatus.CONFLICT,
            );
          }
        }
      }

      if (!patient) {
        patient = await this.prisma.$transaction(async (tx: any) => {
          await lockPatientIdentity(tx, { phone: normalizedPhone, dateOfBirth, nationalId: normalizedNationalId });
          const candidates = await findPossiblePatientDuplicates(tx, {
            phone: normalizedPhone,
            dateOfBirth,
            nationalId: normalizedNationalId,
          });
          if (candidates.length) {
            throw new HttpException(
              {
                code: 'PATIENT_IDENTITY_REVIEW_REQUIRED',
                message: 'The booking could not be linked automatically. Contact reception for identity review.',
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
              emergencyContact: 'Self',
              status: 'ACTIVE',
            },
          });

          await tx.tenantAuditLog.create({
            data: {
              userId: null,
              action: 'PATIENT_FILE_CREATED',
              details: JSON.stringify({
                patientId: created.id,
                fileNumber: created.fileNumber,
                context: 'PUBLIC_BOOKING',
              }),
              ipAddress: ip || 'unknown',
            },
          });
          return created;
        });
      }

      const existingBooking = await this.prisma.appointment.findFirst({
        where: {
          doctorId,
          appointmentDate,
          appointmentTime,
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        },
      });
      if (existingBooking) {
        throw new HttpException(
          {
            code: 'APPOINTMENT_SLOT_UNAVAILABLE',
            message: 'This appointment slot was booked in the meantime. Please select another slot.',
          },
          HttpStatus.CONFLICT,
        );
      }

      const appointment = await this.prisma.$transaction(async (tx: any) => {
        if (!(await lockDoctorScheduleRows(tx, [doctorId]))) {
          throw new HttpException(
            { code: 'DOCTOR_NOT_FOUND', message: 'Active doctor not found.' },
            HttpStatus.NOT_FOUND,
          );
        }
        const currentDoctor = await tx.doctor.findFirst({ where: { id: doctorId, status: 'ACTIVE' } });
        if (!(await getConfiguredSlots(currentDoctor, appointmentDate, undefined, tx)).includes(appointmentTime)) {
          throw new HttpException(
            {
              code: 'INVALID_APPOINTMENT_SLOT',
              message: 'The selected appointment time is no longer available in the doctor schedule.',
            },
            HttpStatus.CONFLICT,
          );
        }
        const duplicate = await tx.appointment.findFirst({
          where: {
            doctorId,
            appointmentDate,
            appointmentTime,
            status: { notIn: ['CANCELLED', 'NO_SHOW'] },
          },
          select: { id: true },
        });
        if (duplicate) {
          throw new HttpException(
            {
              code: 'APPOINTMENT_SLOT_UNAVAILABLE',
              message: 'This appointment slot was booked in the meantime. Please select another slot.',
            },
            HttpStatus.CONFLICT,
          );
        }
        return tx.appointment.create({
          data: {
            patientId: patient.id,
            doctorId,
            appointmentDate,
            appointmentTime,
            status: 'PENDING',
          },
          include: { doctor: true, patient: true },
        });
      });

      finishAppointmentOtp(normalizedPhone, otpReservation.reservationToken, { consumed: true });
      otpConsumed = true;

      await sendBookingConfirmation(appointment);
      this.realtimeGateway.emitQueueUpdate(
        { type: 'BOOKING_PENDING', appointmentId: appointment.id, doctorId },
        [doctorId],
      );

      return toPublicBookingConfirmation(appointment);
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      if (isPatientNationalIdConflict(error)) {
        throw new HttpException(
          {
            code: 'PATIENT_IDENTITY_REVIEW_REQUIRED',
            message: 'The booking could not be linked automatically. Contact reception for identity review.',
          },
          HttpStatus.CONFLICT,
        );
      }
      if (isAppointmentSlotConflict(error)) {
        throw new HttpException(
          {
            code: 'APPOINTMENT_SLOT_UNAVAILABLE',
            message: 'This appointment slot was booked in the meantime. Please select another slot.',
          },
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    } finally {
      if (!otpConsumed) {
        finishAppointmentOtp(normalizedPhone, otpReservation.reservationToken, { consumed: false });
      }
    }
  }

  async getPending() {
    return this.prisma.appointment.findMany({
      where: { status: 'PENDING' },
      include: { patient: true, doctor: true },
      orderBy: [{ appointmentDate: 'asc' }, { appointmentTime: 'asc' }],
    });
  }

  async createWalkIn(body: any, userId: string, ip?: string) {
    const { mode, patientId, doctorId, appointmentDate, appointmentTime, patient } = body;

    if (appointmentDate !== todayString()) {
      throw new HttpException(
        { code: 'WALK_IN_DATE_INVALID', message: 'Walk-in appointments must use the clinic date.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const doctor = await this.prisma.doctor.findFirst({
      where: {
        id: doctorId,
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
        OR: [{ specialtyId: null }, { specialty: { active: true } }],
      },
    });
    if (!doctor) {
      throw new HttpException(
        { code: 'DOCTOR_NOT_FOUND', message: 'Active doctor not found.' },
        HttpStatus.NOT_FOUND,
      );
    }

    if (!(await getConfiguredSlots(doctor, appointmentDate, undefined, this.prisma)).includes(appointmentTime)) {
      throw new HttpException(
        { code: 'INVALID_APPOINTMENT_SLOT', message: 'The selected time is not in the doctor schedule.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    if (mode === 'NEW' && patient.dateOfBirth >= todayString()) {
      throw new HttpException(
        { code: 'INVALID_DATE_OF_BIRTH', message: 'Date of birth must be in the past.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    try {
      const appointment = await this.prisma.$transaction(async (tx: any) => {
        if (!(await lockDoctorScheduleRows(tx, [doctorId]))) {
          throw new HttpException(
            { code: 'DOCTOR_NOT_FOUND', message: 'Active doctor not found.' },
            HttpStatus.NOT_FOUND,
          );
        }
        const currentDoctor = await tx.doctor.findFirst({ where: { id: doctorId, status: 'ACTIVE' } });
        if (!(await getConfiguredSlots(currentDoctor, appointmentDate, undefined, tx)).includes(appointmentTime)) {
          throw new HttpException(
            { code: 'INVALID_APPOINTMENT_SLOT', message: 'The selected time is no longer in the doctor schedule.' },
            HttpStatus.CONFLICT,
          );
        }

        let targetPatient: any;
        if (mode === 'EXISTING') {
          targetPatient = await tx.patient.findUnique({ where: { id: patientId } });
          if (!targetPatient || targetPatient.status !== 'ACTIVE') {
            throw new HttpException(
              { code: 'PATIENT_NOT_FOUND', message: 'Patient not found.' },
              HttpStatus.NOT_FOUND,
            );
          }
        } else {
          const normalizedPhone = normalizePatientPhone(patient.phone);
          const normalizedNationalId = normalizeNationalId(patient.nationalId);
          if (!normalizedPhone) {
            throw new HttpException({ code: 'PHONE_INVALID', message: 'Phone number is invalid.' }, HttpStatus.UNPROCESSABLE_ENTITY);
          }
          if (patient.nationalId && !normalizedNationalId) {
            throw new HttpException({ code: 'NATIONAL_ID_INVALID', message: 'National ID is invalid.' }, HttpStatus.UNPROCESSABLE_ENTITY);
          }

          await lockPatientIdentity(tx, { phone: normalizedPhone, dateOfBirth: patient.dateOfBirth, nationalId: normalizedNationalId });
          const candidates = await findPossiblePatientDuplicates(tx, {
            phone: normalizedPhone,
            dateOfBirth: patient.dateOfBirth,
            nationalId: normalizedNationalId,
          });

          if (candidates.length) {
            throw new HttpException(
              {
                code: 'POSSIBLE_PATIENT_DUPLICATE',
                message: 'A possible existing patient was found. Search and select the existing patient before creating a new walk-in record.',
                details: safeDuplicateCandidates(candidates),
              },
              HttpStatus.CONFLICT,
            );
          }

          targetPatient = await tx.patient.create({
            data: {
              ...structuredPatientName(patient),
              gender: patient.gender,
              dateOfBirth: patient.dateOfBirth,
              nationalId: normalizedNationalId,
              phone: normalizedPhone,
              addressStateId: patient.addressStateId,
              addressDetails: patient.addressDetails || null,
              emergencyContact: patient.emergencyContact || 'Self',
              status: 'ACTIVE',
            },
          });

          await tx.tenantAuditLog.create({
            data: {
              userId,
              action: 'PATIENT_FILE_CREATED',
              details: JSON.stringify({
                patientId: targetPatient.id,
                fileNumber: targetPatient.fileNumber,
                context: 'WALK_IN_REGISTRATION',
              }),
              ipAddress: ip || 'unknown',
            },
          });
        }

        await tx.$queryRaw`SELECT "id" FROM "Patient" WHERE "id" = ${targetPatient.id} FOR UPDATE`;
        const existingWalkIn = await tx.appointment.findFirst({
          where: {
            patientId: targetPatient.id,
            appointmentDate,
            status: { notIn: ['CANCELLED', 'NO_SHOW'] },
          },
          select: { id: true },
        });

        if (existingWalkIn) {
          throw new HttpException(
            {
              code: 'WALK_IN_ALREADY_EXISTS',
              message: 'This patient already has an active appointment today.',
            },
            HttpStatus.CONFLICT,
          );
        }

        const created = await tx.appointment.create({
          data: {
            patientId: targetPatient.id,
            doctorId,
            appointmentDate,
            appointmentTime,
            status: 'SCHEDULED',
          },
          include: { patient: true, doctor: true },
        });

        const claimed = await tx.appointment.updateMany({
          where: { id: created.id, status: 'SCHEDULED', doctorId },
          data: { status: 'CHECKED_IN' },
        });
        if (claimed.count !== 1) throw appointmentStateConflict();

        await tx.tenantAuditLog.create({
          data: {
            userId,
            action: 'WALK_IN_APPOINTMENT_CREATED',
            details: JSON.stringify({
              patientId: targetPatient.id,
              appointmentId: created.id,
              doctorId,
              status: 'CHECKED_IN',
            }),
            ipAddress: ip || 'unknown',
          },
        });

        return tx.appointment.findUnique({
          where: { id: created.id },
          include: { patient: true, doctor: true },
        });
      });

      const notifResult = await sendStatusUpdateNotification(appointment, 'CHECKED_IN');
      this.realtimeGateway.emitQueueUpdate(
        { type: 'STATUS_UPDATE', appointmentId: appointment.id, status: 'CHECKED_IN', doctorId },
        [doctorId],
      );

      return {
        ...appointment,
        whatsAppLinkAr: notifResult?.whatsAppLinkAr,
        whatsAppLinkEn: notifResult?.whatsAppLinkEn,
      };
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      if (isAppointmentSlotConflict(error)) {
        throw new HttpException(
          { code: 'APPOINTMENT_SLOT_UNAVAILABLE', message: 'This appointment slot is no longer available.' },
          HttpStatus.CONFLICT,
        );
      }
      if (isPatientNationalIdConflict(error)) {
        throw new HttpException(
          { code: 'POSSIBLE_PATIENT_DUPLICATE', message: 'A possible existing patient was found. Search and select the existing patient before creating a new walk-in record.' },
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async getQueue(doctorId: string, targetDate = todayString(), user: any) {
    if (user.role === 'DOCTOR' && user.doctorId !== doctorId) {
      throw new HttpException(
        { code: 'DOCTOR_QUEUE_FORBIDDEN', message: 'Doctors may only access their own queue.' },
        HttpStatus.FORBIDDEN,
      );
    }

    const queue = await this.prisma.appointment.findMany({
      where: {
        doctorId,
        appointmentDate: targetDate,
        status: { notIn: ['CANCELLED', 'NO_SHOW', 'PENDING'] },
      },
      include: {
        patient: true,
        doctor: {
          select: {
            id: true,
            fullNameAr: true,
            fullNameEn: true,
            consultationFee: true,
          },
        },
        emergencyOverride: true,
        medicalRecord: { select: { id: true } },
        invoices: {
          where: { invoiceType: 'CONSULTATION' },
          orderBy: { invoiceDate: 'desc' },
          select: {
            id: true,
            paymentStatus: true,
            totalAmountSdg: true,
            invoiceDate: true,
          },
          take: 1,
        },
      },
      orderBy: [{ status: 'desc' }, { appointmentTime: 'asc' }],
    });

    const paymentAwareQueue = queue.map((appointment: any) => {
      const consultationInvoice = appointment.invoices?.[0] || null;
      const medicalRecordId = appointment.medicalRecord?.id || null;
      const { invoices, medicalRecord, ...safeAppointment } = appointment;
      return {
        ...safeAppointment,
        medicalRecordId,
        consultationInvoice,
        consultationPaymentStatus: consultationInvoice?.paymentStatus || 'NOT_BILLED',
        consultationReady: consultationInvoice?.paymentStatus === 'PAID',
      };
    });

    return paymentAwareQueue.sort((a: any, b: any) => {
      const aHasEmergency = a.emergencyOverride ? 1 : 0;
      const bHasEmergency = b.emergencyOverride ? 1 : 0;
      if (aHasEmergency !== bHasEmergency) {
        return bHasEmergency - aHasEmergency;
      }
      return 0;
    });
  }

  async updateStatus(id: string, status: string, user: any, ip?: string) {
    const current = await this.prisma.appointment.findUnique({ where: { id } });
    if (!current) {
      throw new HttpException(
        { code: 'APPOINTMENT_NOT_FOUND', message: 'Appointment not found.' },
        HttpStatus.NOT_FOUND,
      );
    }

    if (!transitions[current.status]?.includes(status)) {
      throw new HttpException(
        {
          code: 'ILLEGAL_APPOINTMENT_STATUS_TRANSITION',
          message: `Appointment cannot move from ${current.status} to ${status}.`,
        },
        HttpStatus.CONFLICT,
      );
    }

    if (user.role === 'DOCTOR') {
      if (current.doctorId !== user.doctorId || !['IN_CONSULTATION', 'COMPLETED'].includes(status)) {
        throw new HttpException(
          { code: 'APPOINTMENT_STATUS_FORBIDDEN', message: 'Doctors may only advance their own clinical appointments.' },
          HttpStatus.FORBIDDEN,
        );
      }
    } else if (user.role === 'RECEPTIONIST' && !['CONFIRMED', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW'].includes(status)) {
      throw new HttpException(
        { code: 'APPOINTMENT_STATUS_FORBIDDEN', message: 'Receptionists cannot set clinical appointment states.' },
        HttpStatus.FORBIDDEN,
      );
    }

    if (current.status === 'CHECKED_IN' && status === 'IN_CONSULTATION') {
      const paidConsultationInvoice = await this.prisma.invoice.findFirst({
        where: {
          appointmentId: current.id,
          invoiceType: 'CONSULTATION',
          paymentStatus: 'PAID',
        },
        select: { id: true },
      });
      if (!paidConsultationInvoice) {
        throw new HttpException(
          {
            code: 'CONSULTATION_PAYMENT_REQUIRED',
            message: 'Consultation fee must be paid at reception before the consultation can start.',
          },
          HttpStatus.CONFLICT,
        );
      }
    }

    const appointment = await this.prisma.$transaction(async (tx: any) => {
      const claimed = await tx.appointment.updateMany({
        where: { id: current.id, status: current.status, doctorId: current.doctorId },
        data: { status },
      });
      if (claimed.count !== 1) throw appointmentStateConflict();

      await tx.tenantAuditLog.create({
        data: {
          userId: user.id,
          action: 'APPOINTMENT_STATUS_UPDATED',
          details: JSON.stringify({
            appointmentId: current.id,
            previousStatus: current.status,
            status,
          }),
          ipAddress: ip || 'unknown',
        },
      });

      return tx.appointment.findUnique({
        where: { id: current.id },
        include: { patient: true, doctor: true },
      });
    });

    const notifResult = await sendStatusUpdateNotification(appointment, status);
    this.realtimeGateway.emitQueueUpdate(
      { type: 'STATUS_UPDATE', appointmentId: appointment.id, status, doctorId: appointment.doctorId },
      [appointment.doctorId],
    );

    return {
      ...appointment,
      whatsAppLinkAr: notifResult?.whatsAppLinkAr,
      whatsAppLinkEn: notifResult?.whatsAppLinkEn,
    };
  }

  async applyOverride(id: string, justification: string, userId: string, ip?: string) {
    if (typeof justification !== 'string' || justification.trim().length < 20) {
      throw new HttpException(
        {
          code: 'OVERRIDE_JUSTIFICATION_REQUIRED',
          message: 'Emergency override justification must contain at least 20 characters.',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const appointment = await this.prisma.appointment.findUnique({ where: { id } });
    if (!appointment) {
      throw new HttpException(
        { code: 'APPOINTMENT_NOT_FOUND', message: 'Appointment not found.' },
        HttpStatus.NOT_FOUND,
      );
    }
    if (!['PENDING', 'SCHEDULED', 'CONFIRMED', 'CHECKED_IN'].includes(appointment.status)) {
      throw new HttpException(
        {
          code: 'OVERRIDE_INVALID_STATE',
          message: `Emergency override is not allowed from ${appointment.status}.`,
        },
        HttpStatus.CONFLICT,
      );
    }
    if (await this.prisma.emergencyOverride.findUnique({ where: { appointmentId: appointment.id } })) {
      throw new HttpException(
        {
          code: 'OVERRIDE_ALREADY_APPLIED',
          message: 'An emergency override already exists for this appointment.',
        },
        HttpStatus.CONFLICT,
      );
    }

    try {
      await this.prisma.$transaction(async (tx: any) => {
        const claimed = await tx.appointment.updateMany({
          where: { id: appointment.id, status: appointment.status },
          data: { status: 'CHECKED_IN' },
        });
        if (claimed.count !== 1) throw appointmentStateConflict();

        await tx.emergencyOverride.create({
          data: {
            appointmentId: id,
            justification: justification.trim(),
            authorizedById: userId,
          },
        });

        await tx.tenantAuditLog.create({
          data: {
            userId,
            action: 'QUEUE_EMERGENCY_OVERRIDE',
            details: `Emergency override requested for Appointment ${id}. Justification: ${justification.trim()}`,
            ipAddress: ip || '127.0.0.1',
          },
        });
      });

      this.realtimeGateway.emitQueueUpdate(
        { type: 'OVERRIDE', appointmentId: id, doctorId: appointment.doctorId },
        [appointment.doctorId],
      );

      return { success: true, message: 'Emergency queue override applied successfully.' };
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      if (isEmergencyOverrideConflict(error)) {
        throw new HttpException(
          {
            code: 'OVERRIDE_ALREADY_APPLIED',
            message: 'An emergency override already exists for this appointment.',
          },
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async transfer(id: string, targetDoctorId: string, userId: string, ip?: string) {
    if (!targetDoctorId) {
      throw new HttpException(
        { error: 'Target doctor ID is required.' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const [appointment, targetDoctor] = await Promise.all([
      this.prisma.appointment.findUnique({ where: { id } }),
      this.prisma.doctor.findFirst({
        where: {
          id: targetDoctorId,
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
          OR: [{ specialtyId: null }, { specialty: { active: true } }],
        },
      }),
    ]);

    if (!appointment) {
      throw new HttpException({ code: 'APPOINTMENT_NOT_FOUND', message: 'Appointment not found.' }, HttpStatus.NOT_FOUND);
    }
    if (!targetDoctor) {
      throw new HttpException({ code: 'DOCTOR_NOT_FOUND', message: 'Target doctor is not active.' }, HttpStatus.NOT_FOUND);
    }
    if (appointment.status !== 'CHECKED_IN') {
      throw new HttpException({ code: 'TRANSFER_INVALID_STATE', message: 'Only checked-in appointments can be transferred.' }, HttpStatus.CONFLICT);
    }

    if (!(await getConfiguredSlots(targetDoctor, appointment.appointmentDate, undefined, this.prisma)).includes(appointment.appointmentTime)) {
      throw new HttpException({ code: 'TARGET_DOCTOR_UNAVAILABLE', message: 'Target doctor is not scheduled for this appointment slot.' }, HttpStatus.CONFLICT);
    }

    const conflict = await this.prisma.appointment.findFirst({
      where: {
        doctorId: targetDoctorId,
        appointmentDate: appointment.appointmentDate,
        appointmentTime: appointment.appointmentTime,
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        id: { not: appointment.id },
      },
    });
    if (conflict) {
      throw new HttpException({ code: 'APPOINTMENT_SLOT_UNAVAILABLE', message: 'Target doctor already has an appointment in this slot.' }, HttpStatus.CONFLICT);
    }

    try {
      await this.prisma.$transaction(async (tx: any) => {
        if (!(await lockDoctorScheduleRows(tx, [appointment.doctorId, targetDoctorId]))) {
          throw new HttpException({ code: 'DOCTOR_NOT_FOUND', message: 'Active doctor not found.' }, HttpStatus.NOT_FOUND);
        }
        const currentTargetDoctor = await tx.doctor.findFirst({ where: { id: targetDoctorId, status: 'ACTIVE' } });
        if (!(await getConfiguredSlots(currentTargetDoctor, appointment.appointmentDate, undefined, tx)).includes(appointment.appointmentTime)) {
          throw new HttpException({ code: 'TARGET_DOCTOR_UNAVAILABLE', message: 'Target doctor is no longer scheduled for this appointment slot.' }, HttpStatus.CONFLICT);
        }

        const targetConflict = await tx.appointment.findFirst({
          where: {
            doctorId: targetDoctorId,
            appointmentDate: appointment.appointmentDate,
            appointmentTime: appointment.appointmentTime,
            status: { notIn: ['CANCELLED', 'NO_SHOW'] },
            id: { not: appointment.id },
          },
          select: { id: true },
        });
        if (targetConflict) {
          throw new HttpException({ code: 'APPOINTMENT_SLOT_UNAVAILABLE', message: 'Target doctor already has an appointment in this slot.' }, HttpStatus.CONFLICT);
        }

        const claimed = await tx.appointment.updateMany({
          where: { id: appointment.id, status: 'CHECKED_IN', doctorId: appointment.doctorId },
          data: { doctorId: targetDoctorId, status: 'CHECKED_IN' },
        });
        if (claimed.count !== 1) throw appointmentStateConflict();

        await tx.tenantAuditLog.create({
          data: {
            userId,
            action: 'PATIENT_INTERNAL_TRANSFER',
            details: `Transferred appointment ${id} to Doctor ${targetDoctorId}`,
            ipAddress: ip || '127.0.0.1',
          },
        });
      });

      this.realtimeGateway.emitQueueUpdate(
        { type: 'TRANSFER', appointmentId: id, targetDoctorId },
        [appointment.doctorId, targetDoctorId],
      );

      return { success: true, message: 'Patient transferred internally successfully.' };
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      if (isAppointmentSlotConflict(error)) {
        throw new HttpException({ code: 'APPOINTMENT_SLOT_UNAVAILABLE', message: 'Target doctor already has an appointment in this slot.' }, HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  async getDoctors() {
    const doctors = await this.prisma.doctor.findMany({
      where: {
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
        OR: [{ specialtyId: null }, { specialty: { active: true } }],
      },
      select: publicDoctorSelect,
      orderBy: { fullNameEn: 'asc' },
    });
    return doctors.map(toPublicDoctor);
  }
}
