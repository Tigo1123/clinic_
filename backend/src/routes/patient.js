import express from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { allowRoles, requireOwnedPatient, ROLES } from '../middleware/policies.js';
import { validate } from '../middleware/validate.js';
import { sendError } from '../utils/apiError.js';
import { getConfiguredSlots, DATE_PATTERN, TIME_PATTERN, todayString } from '../utils/scheduling.js';
import { decrypt } from '../utils/encryption.js';
import { cancellationCutoffReached } from '../utils/clinicTime.js';
import { normalizeEmail, normalizePhone } from '../utils/identity.js';
import { createVerificationChallenge, consumeVerificationChallenge, invalidateChallenges } from '../services/verification.js';
import { createLoginLimiter } from '../utils/edgeSecurity.js';
import { rateLimits } from '../config.js';
import { markSensitiveResponse } from '../utils/edgeSecurity.js';

const router = express.Router();
router.use((req, res, next) => { markSensitiveResponse(res); next(); });
router.use(authenticate, allowRoles(ROLES.PATIENT), requireOwnedPatient);

function safeDecrypt(value) {
  const result = decrypt(value || '');
  return result.startsWith('[Decryption Error') ? '' : result;
}

async function audit(req, action, details, db = prisma) {
  await db.tenantAuditLog.create({ data: { userId: req.user.id, action, details, ipAddress: req.ip || 'unknown' } });
}

function stateConflict() {
  return Object.assign(new Error('Appointment state changed before this operation could be completed.'), {
    status: 409,
    code: 'APPOINTMENT_STATE_CONFLICT'
  });
}

function isAppointmentSlotConflict(error) {
  if (error?.code !== 'P2002') return false;
  const target = error?.meta?.target;
  return String(error.message || '').includes('Appointment_active_doctor_slot_key')
    || (Array.isArray(target)
      && ['doctorId', 'appointmentDate', 'appointmentTime'].every((field) => target.includes(field)));
}

const doctorSelect = { id: true, fullNameAr: true, fullNameEn: true, specialtyAr: true, specialtyEn: true, specialty: { select: { id: true, nameAr: true, nameEn: true } }, consultationFee: true, status: true };

const recoveryIdentityLimiter = createLoginLimiter({ windowMs: rateLimits.windowMs, limit: rateLimits.verification });
router.get('/me', async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { email: true, phoneNormalized: true, emailVerifiedAt: true, phoneVerifiedAt: true, preferredLanguage: true } });
  return res.json({ id: req.patient.id, fileNumber: req.patient.fileNumber, fullNameAr: req.patient.fullNameAr, fullNameEn: req.patient.fullNameEn, gender: req.patient.gender, dateOfBirth: req.patient.dateOfBirth, phone: user.phoneNormalized, email: user.email, phoneVerified: Boolean(user.phoneVerifiedAt), emailVerified: Boolean(user.emailVerifiedAt), addressStateId: req.patient.addressStateId, addressDetails: req.patient.addressDetails, emergencyContact: req.patient.emergencyContact, bloodType: req.patient.bloodType, preferredLanguage: user.preferredLanguage });
});

router.patch('/me', (req, res, next) => {
  if (Object.hasOwn(req.body || {}, 'fileNumber') || Object.hasOwn(req.body || {}, 'mrn')) {
    return sendError(res, 422, 'PATIENT_IDENTITY_FIELD_FORBIDDEN', 'Patient file identity fields cannot be changed.');
  }
  return next();
}, validate(z.object({ addressStateId: z.coerce.number().int().min(1).max(18).optional(), addressDetails: z.string().trim().max(300).nullable().optional(), emergencyContact: z.string().trim().min(2).max(150).optional(), bloodType: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).nullable().optional(), preferredLanguage: z.enum(['ar', 'en']).optional() }).refine((body) => Object.keys(body).length > 0)), async (req, res) => {
  await prisma.$transaction([
    prisma.patient.update({ where: { id: req.patient.id }, data: { addressStateId: req.body.addressStateId, addressDetails: req.body.addressDetails, emergencyContact: req.body.emergencyContact, bloodType: req.body.bloodType } }),
    ...(req.body.preferredLanguage ? [prisma.user.update({ where: { id: req.user.id }, data: { preferredLanguage: req.body.preferredLanguage } })] : [])
  ]);
  await audit(req, 'PATIENT_PROFILE_UPDATED', 'Patient updated self-service contact/profile fields.');
  return res.json({ success: true });
});


// Both steps require the current password. The challenge is bound to the
// authenticated generation and a proposed target; it never changes linkage.
router.post('/me/email-change/request', recoveryIdentityLimiter, validate(z.object({ email: z.string().trim().email().max(254), currentPassword: z.string().min(1).max(200) }).strict()), async (req, res, next) => {
  markSensitiveResponse(res);
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user || user.authVersion !== req.user.av || !await bcrypt.compare(req.body.currentPassword, user.passwordHash)) return sendError(res, 401, 'REAUTHENTICATION_FAILED', 'Current credentials are invalid.');
    const email = normalizeEmail(req.body.email);
    // Ownership conflicts are reported only at completion with a generic error.
    const { challenge, developmentCode } = await createVerificationChallenge(user, 'PROFILE_EMAIL_CHANGE', email);
    return res.status(201).json({ state: 'VERIFICATION_REQUIRED', challengeId: challenge.id, expiresInMinutes: 10, ...(developmentCode ? { developmentCode } : {}) });
  } catch (error) { next(error); }
});

router.post('/me/email-change/verify', recoveryIdentityLimiter, validate(z.object({ challengeId: z.string().uuid(), code: z.string().regex(/^\d{6}$/), currentPassword: z.string().min(1).max(200) }).strict()), async (req, res, next) => {
  markSensitiveResponse(res);
  try {
    await consumeVerificationChallenge({ ...req.body, purpose: 'PROFILE_EMAIL_CHANGE', userId: req.user.id, authVersion: req.user.av, transition: async (tx, challenge) => {
      await tx.user.update({ where: { id: req.user.id }, data: {
        email: challenge.targetNormalized, emailVerifiedAt: new Date(), authVersion: { increment: 1 },
        ...(challenge.user.username === challenge.user.email ? { username: challenge.targetNormalized } : {})
      } });
      await invalidateChallenges(tx, req.user.id);
      await audit(req, 'PATIENT_EMAIL_CHANGED', 'Patient changed verified recovery email after password reauthentication. All sessions revoked.', tx);
    } });
    return res.json({ success: true, reauthenticationRequired: true });
  } catch (error) {
    if (error.code === 'P2002') return sendError(res, 409, 'EMAIL_CHANGE_UNAVAILABLE', 'Unable to complete this email change.');
    next(error);
  }
});

// Existing verified-email authorization is retained for phone changes. It
// authorizes changing contact details; it does not prove new-phone ownership.
router.post('/me/phone-change/request', recoveryIdentityLimiter, validate(z.object({ phone: z.string().trim().min(7).max(30) }).strict()), async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone);
    if (!phone) return sendError(res, 422, 'PHONE_INVALID', 'Phone number is invalid.');
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user || user.authVersion !== req.user.av) return sendError(res, 401, 'SESSION_REVOKED', 'Sign in again.');
    if (!user.emailVerifiedAt) return sendError(res, 422, 'VERIFIED_EMAIL_REQUIRED', 'A verified email is required before changing the phone number.');
    const { challenge, developmentCode } = await createVerificationChallenge(user, 'PROFILE_PHONE_CHANGE', phone);
    return res.status(201).json({ state: 'VERIFICATION_REQUIRED', challengeId: challenge.id, expiresInMinutes: 10, ...(developmentCode ? { developmentCode } : {}) });
  } catch (error) { next(error); }
});
router.post('/me/phone-change/verify', recoveryIdentityLimiter, validate(z.object({ challengeId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) }).strict()), async (req, res, next) => {
  try {
    await consumeVerificationChallenge({ ...req.body, purpose: 'PROFILE_PHONE_CHANGE', userId: req.user.id, authVersion: req.user.av, transition: async (tx, challenge) => {
      await tx.user.update({ where: { id: req.user.id }, data: {
        phoneNormalized: challenge.targetNormalized, phoneVerifiedAt: null, authVersion: { increment: 1 },
        ...(challenge.user.username === challenge.user.phoneNormalized ? { username: challenge.targetNormalized } : {})
      } });
      await tx.patient.update({ where: { userId: req.user.id }, data: { phone: challenge.targetNormalized } });
      await invalidateChallenges(tx, req.user.id);
      await audit(req, 'PATIENT_PHONE_CHANGED', 'Patient changed contact phone through verified email authorization. Sessions revoked; new phone remains unverified.', tx);
    } });
    return res.json({ success: true, phoneVerified: false, reauthenticationRequired: true });
  } catch (error) {
    if (error.code === 'P2002') return sendError(res, 409, 'PHONE_CHANGE_UNAVAILABLE', 'Unable to complete this phone change.');
    next(error);
  }
});

router.get('/doctors', async (req, res) => {
  const doctors = await prisma.doctor.findMany({ where: { status: 'ACTIVE' }, select: doctorSelect, orderBy: { fullNameEn: 'asc' } });
  return res.json(doctors);
});

router.get('/specialties', async (req, res) => {
  const specialties = await prisma.specialty.findMany({ where: { active: true }, select: { id: true, nameAr: true, nameEn: true }, orderBy: { nameEn: 'asc' } });
  return res.json(specialties.map(({ id, nameAr, nameEn }) => ({ id, labelAr: nameAr, labelEn: nameEn })));
});

router.get('/doctors/:id', async (req, res) => {
  const doctor = await prisma.doctor.findFirst({ where: { id: req.params.id, status: 'ACTIVE' }, select: doctorSelect });
  if (!doctor) return sendError(res, 404, 'DOCTOR_NOT_FOUND', 'Doctor not found.');
  return res.json(doctor);
});

router.get('/appointments', async (req, res) => {
  const group = req.query.group || 'all';
  const today = todayString();
  const where = { patientId: req.patient.id };
  if (group === 'upcoming') Object.assign(where, { appointmentDate: { gte: today }, status: { notIn: ['CANCELLED', 'COMPLETED', 'NO_SHOW'] } });
  if (group === 'past') Object.assign(where, { OR: [{ appointmentDate: { lt: today } }, { status: { in: ['COMPLETED', 'NO_SHOW'] } }] });
  if (group === 'cancelled') Object.assign(where, { status: 'CANCELLED' });
  const appointments = await prisma.appointment.findMany({ where, include: { doctor: { select: doctorSelect } }, orderBy: [{ appointmentDate: 'desc' }, { appointmentTime: 'desc' }] });
  return res.json(appointments.map(({ patientId, ...appointment }) => appointment));
});

router.get('/appointments/:id', async (req, res) => {
  const appointment = await prisma.appointment.findFirst({ where: { id: req.params.id, patientId: req.patient.id }, include: { doctor: { select: doctorSelect } } });
  if (!appointment) return sendError(res, 404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found.');
  const { patientId, ...safe } = appointment;
  return res.json(safe);
});

const bookingSchema = z.object({ doctorId: z.string().uuid(), appointmentDate: z.string().regex(DATE_PATTERN), appointmentTime: z.string().regex(TIME_PATTERN) });
async function validateSlot(res, doctorId, date, time) {
  if (date < todayString()) { sendError(res, 422, 'APPOINTMENT_DATE_IN_PAST', 'Past appointment dates are not allowed.'); return null; }
  const doctor = await prisma.doctor.findFirst({ where: { id: doctorId, status: 'ACTIVE' } });
  if (!doctor) { sendError(res, 404, 'DOCTOR_NOT_FOUND', 'Active doctor not found.'); return null; }
  if (!(await getConfiguredSlots(doctor, date)).includes(time)) { sendError(res, 422, 'INVALID_APPOINTMENT_SLOT', 'The selected time is not in the doctor schedule.'); return null; }
  return doctor;
}

router.post('/appointments', validate(bookingSchema), async (req, res, next) => {
  try {
    if (!(await validateSlot(res, req.body.doctorId, req.body.appointmentDate, req.body.appointmentTime))) return;
    const appointment = await prisma.appointment.create({ data: { patientId: req.patient.id, ...req.body, status: 'PENDING' }, include: { doctor: { select: doctorSelect } } });
    await audit(req, 'PATIENT_APPOINTMENT_BOOKED', `Patient booked appointment ${appointment.id}.`);
    return res.status(201).json(appointment);
  } catch (error) {
    if (error.code === 'P2002') return sendError(res, 409, 'APPOINTMENT_SLOT_UNAVAILABLE', 'This appointment slot is no longer available.');
    next(error);
  }
});

router.post('/appointments/:id/cancel', async (req, res, next) => {
  const appointment = await prisma.appointment.findFirst({ where: { id: req.params.id, patientId: req.patient.id } });
  if (!appointment) return sendError(res, 404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found.');
  if (!['PENDING', 'SCHEDULED', 'CONFIRMED'].includes(appointment.status)) return sendError(res, 409, 'APPOINTMENT_CANNOT_BE_CANCELLED', 'Appointment can no longer be cancelled.');
  const cutoffHours = Number(process.env.PATIENT_CANCELLATION_CUTOFF_HOURS || 2);
  if (cancellationCutoffReached(appointment.appointmentDate, appointment.appointmentTime, cutoffHours)) return sendError(res, 409, 'CANCELLATION_CUTOFF_REACHED', 'Appointment cancellation cutoff has passed.');
  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.appointment.updateMany({
        where: {
          id: appointment.id,
          patientId: req.patient.id,
          status: appointment.status,
          doctorId: appointment.doctorId,
          appointmentDate: appointment.appointmentDate,
          appointmentTime: appointment.appointmentTime
        },
        data: { status: 'CANCELLED' }
      });
      if (claimed.count !== 1) throw stateConflict();
      await audit(req, 'PATIENT_APPOINTMENT_CANCELLED', `Patient cancelled appointment ${appointment.id}.`, tx);
    });
    return res.json({ success: true });
  } catch (error) {
    if (error.status === 409 && error.code === 'APPOINTMENT_STATE_CONFLICT') {
      return sendError(res, 409, error.code, error.message);
    }
    return next(error);
  }
});

router.put('/appointments/:id/reschedule', validate(bookingSchema), async (req, res, next) => {
  const appointment = await prisma.appointment.findFirst({ where: { id: req.params.id, patientId: req.patient.id } });
  if (!appointment) return sendError(res, 404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found.');
  if (!['PENDING', 'SCHEDULED', 'CONFIRMED'].includes(appointment.status)) return sendError(res, 409, 'APPOINTMENT_CANNOT_BE_RESCHEDULED', 'Appointment can no longer be rescheduled.');
  if (!(await validateSlot(res, req.body.doctorId, req.body.appointmentDate, req.body.appointmentTime))) return;
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.appointment.updateMany({
        where: {
          id: appointment.id,
          patientId: req.patient.id,
          status: appointment.status,
          doctorId: appointment.doctorId,
          appointmentDate: appointment.appointmentDate,
          appointmentTime: appointment.appointmentTime
        },
        data: { ...req.body, status: 'PENDING' }
      });
      if (claimed.count !== 1) throw stateConflict();
      await audit(req, 'PATIENT_APPOINTMENT_RESCHEDULED', `Patient rescheduled appointment ${appointment.id}.`, tx);
      return tx.appointment.findUnique({ where: { id: appointment.id }, include: { doctor: { select: doctorSelect } } });
    });
    return res.json(updated);
  } catch (error) {
    if (error.status === 409 && error.code === 'APPOINTMENT_STATE_CONFLICT') return sendError(res, 409, error.code, error.message);
    if (isAppointmentSlotConflict(error)) return sendError(res, 409, 'APPOINTMENT_SLOT_UNAVAILABLE', 'The requested new slot is no longer available; the original appointment was preserved.');
    next(error);
  }
});

const patientLabItemSelect = {
  id: true,
  customTestName: true,
  labReviewStatus: true,
  resultValue: true,
  referenceRangeMin: true,
  referenceRangeMax: true,
  isOutOfRange: true,
  fileAttachmentPath: true,
  service: { select: { labelAr: true, labelEn: true, category: true } }
};

function mapPatientSafeLabTests(order) {
  return (order.items || [])
    .filter((item) => item.labReviewStatus !== 'EXTERNAL' && item.resultValue != null)
    .map((item) => ({
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
      attachmentPath: item.fileAttachmentPath
        ? `/api/upload/${item.fileAttachmentPath.split('/').pop()}`
        : null
    }));
}

function parsePatientVitalSigns(value) {
  try {
    const parsed = typeof value === 'string'
      ? JSON.parse(value || '{}')
      : value;

    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, item]) => ['string', 'number'].includes(typeof item))
    );
  } catch {
    return {};
  }
}

router.get('/lab-results', async (req, res, next) => {
  try {
    const orders = await prisma.labOrder.findMany({
      where: {
        patientId: req.patient.id,
        status: 'COMPLETED',
        releasedToPatientAt: { not: null }
      },
      select: {
        id: true,
        orderDate: true,
        releasedToPatientAt: true,
        doctor: {
          select: doctorSelect
        },
        items: { select: patientLabItemSelect }
      },
      orderBy: {
        orderDate: 'desc'
      }
    });

    return res.json(
      orders.map((order) => ({
        id: order.id,
        orderDate: order.orderDate,
        releasedAt: order.releasedToPatientAt,
        doctor: order.doctor,
        tests: mapPatientSafeLabTests(order)
      }))
    );
  } catch (error) {
    next(error);
  }
});

router.get('/prescriptions', async (req, res) => {
  const prescriptions = await prisma.prescription.findMany({ where: { patientId: req.patient.id }, include: { doctor: { select: doctorSelect }, prescribedDrugs: { include: { drug: { select: { labelAr: true, labelEn: true, genericName: true, strength: true, dosageForm: true } } } } }, orderBy: { prescriptionDate: 'desc' } });
  return res.json(prescriptions.map((rx) => ({
    id: rx.id,
    prescriptionDate: rx.prescriptionDate,
    status: rx.status,
    doctor: rx.doctor,
    medicines: rx.prescribedDrugs.map((item) => ({
      id: item.id,
      medicine: item.drug || {
        labelAr: item.customDrugName || '',
        labelEn: item.customDrugName || '',
        genericName: item.customDrugName || '',
        strength: '',
        dosageForm: ''
      },
      customDrugName: item.customDrugName,
      dosage: item.dosage,
      duration: item.duration,
      instructionsAr: item.instructionsAr,
      instructionsEn: item.instructionsEn,
      qtyPrescribed: item.qtyPrescribed,
      qtyDispensed: item.qtyDispensed
    }))
  })));
});

router.get('/medical-records', async (req, res) => {
  const records = await prisma.medicalRecord.findMany({ where: { patientId: req.patient.id }, include: { doctor: { select: doctorSelect }, prescriptions: { select: { id: true, status: true } }, labOrders: { where: { releasedToPatientAt: { not: null } }, select: { id: true, status: true, releasedToPatientAt: true } } }, orderBy: { visitDate: 'desc' } });
  return res.json(records.map((record) => ({ id: record.id, visitDate: record.visitDate, doctor: record.doctor, diagnosis: safeDecrypt(record.diagnosisEncrypted), treatment: safeDecrypt(record.treatmentEncrypted), prescriptions: record.prescriptions, releasedLabResults: record.labOrders, attachmentPath: record.attachmentPath ? `/api/upload/${record.attachmentPath.split('/').pop()}` : null })));
});


router.get('/medical-records/:id', async (req, res) => {
  try {
    const record = await prisma.medicalRecord.findFirst({
      where: {
        id: req.params.id,
        patientId: req.patient.id
      },
      include: {
        doctor: {
          select: doctorSelect
        },
        prescriptions: {
          include: {
            prescribedDrugs: {
              include: {
                drug: true
              }
            }
          }
        },
        labOrders: {
          where: {
            releasedToPatientAt: {
              not: null
            }
          },
          select: {
            releasedToPatientAt: true,
            items: { select: patientLabItemSelect }
          }
        }
      }
    });

    if (!record) {
      return res.status(404).json({
        error: {
          code: 'MEDICAL_RECORD_NOT_FOUND',
          message: 'Medical record not found.'
        }
      });
    }

    const vitalSigns = parsePatientVitalSigns(record.vitalSignsJson);

    return res.json({
      id: record.id,
      visitDate: record.visitDate,

      doctor: record.doctor,

      symptoms: safeDecrypt(record.symptomsEncrypted),
      diagnosis: safeDecrypt(record.diagnosisEncrypted),
      treatment: safeDecrypt(record.treatmentEncrypted),

      vitalSigns,

      prescriptions: (record.prescriptions || []).map((prescription) => ({
        id: prescription.id,
        status: prescription.status,

        medicines: (prescription.prescribedDrugs || []).map((item) => ({
          id: item.id,

          medicine: item.drug || {
            labelAr: item.customDrugName || '',
            labelEn: item.customDrugName || '',
            genericName: item.customDrugName || '',
            strength: '',
            dosageForm: ''
          },

          customDrugName: item.customDrugName,
          dosage: item.dosage,
          duration: item.duration,
          instructionsAr: item.instructionsAr,
          instructionsEn: item.instructionsEn,
          qtyPrescribed: item.qtyPrescribed,
          qtyDispensed: item.qtyDispensed
        }))
      })),

      releasedLabResults: (record.labOrders || []).flatMap(mapPatientSafeLabTests),

      attachmentPath: record.attachmentPath
        ? `/api/upload/${record.attachmentPath.split('/').pop()}`
        : null
    });
  } catch (error) {
    console.error('Fetch patient medical record detail error:', error);

    return res.status(500).json({
      error: {
        code: 'MEDICAL_RECORD_DETAIL_FAILED',
        message: 'Failed to retrieve medical record.'
      }
    });
  }
});


export default router;
