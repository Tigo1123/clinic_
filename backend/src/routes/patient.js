import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { allowRoles, requireOwnedPatient, ROLES } from '../middleware/policies.js';
import { validate } from '../middleware/validate.js';
import { sendError } from '../utils/apiError.js';
import { configuredSlots, DATE_PATTERN, TIME_PATTERN, todayString } from '../utils/scheduling.js';
import { decrypt } from '../utils/encryption.js';
import { cancellationCutoffReached } from '../utils/clinicTime.js';
import { normalizeEmail, normalizePhone } from '../utils/identity.js';
import { sendEmail } from '../utils/notifications.js';

const router = express.Router();
router.use(authenticate, allowRoles(ROLES.PATIENT), requireOwnedPatient);

function safeDecrypt(value) {
  const result = decrypt(value || '');
  return result.startsWith('[Decryption Error') ? '' : result;
}

async function audit(req, action, details) {
  await prisma.tenantAuditLog.create({ data: { userId: req.user.id, action, details, ipAddress: req.ip || 'unknown' } });
}

const doctorSelect = { id: true, fullNameAr: true, fullNameEn: true, specialtyAr: true, specialtyEn: true, consultationFee: true, status: true };

const PROFILE_CHANGE_EXPIRY_MINUTES = 10;

async function createProfileChangeChallenge({
  userId,
  type,
  targetNormalized,
  deliveryEmail,
  subject,
  message
}) {
  const code = String(
    crypto.randomInt(100000, 1000000)
  );

  const codeHash = await bcrypt.hash(code, 10);

  // Invalidate older unused challenges of the same type.
  await prisma.verificationChallenge.updateMany({
    where: {
      userId,
      type,
      usedAt: null
    },
    data: {
      usedAt: new Date()
    }
  });

  const challenge =
    await prisma.verificationChallenge.create({
      data: {
        userId,
        type,
        targetNormalized,
        codeHash,
        expiresAt: new Date(
          Date.now() +
            PROFILE_CHANGE_EXPIRY_MINUTES * 60 * 1000
        )
      }
    });

  const developmentMode =
    process.env.VERIFICATION_PROVIDER === 'development' &&
    process.env.NODE_ENV !== 'production';

  if (developmentMode) {
    return {
      challenge,
      developmentCode: code
    };
  }

  const sent = await sendEmail({
    to: deliveryEmail,
    subject,
    text: `${message}

Verification code: ${code}

This code expires in ${PROFILE_CHANGE_EXPIRY_MINUTES} minutes.`
  });

  if (!sent) {
    await prisma.verificationChallenge
      .delete({
        where: {
          id: challenge.id
        }
      })
      .catch(() => {});

    return null;
  }

  return {
    challenge
  };
}

async function verifyProfileChangeChallenge({
  challengeId,
  code,
  userId,
  type
}) {
  const challenge =
    await prisma.verificationChallenge.findUnique({
      where: {
        id: challengeId
      }
    });

  if (
    !challenge ||
    challenge.userId !== userId ||
    challenge.type !== type ||
    challenge.usedAt
  ) {
    return {
      error: 'INVALID'
    };
  }

  if (challenge.expiresAt <= new Date()) {
    return {
      error: 'EXPIRED'
    };
  }

  if (challenge.attemptCount >= challenge.maxAttempts) {
    return {
      error: 'ATTEMPTS_EXCEEDED'
    };
  }

  const valid = await bcrypt.compare(
    String(code),
    challenge.codeHash
  );

  if (!valid) {
    await prisma.verificationChallenge.update({
      where: {
        id: challenge.id
      },
      data: {
        attemptCount: {
          increment: 1
        }
      }
    });

    return {
      error: 'INCORRECT'
    };
  }

  return {
    challenge
  };
}

router.get('/me', async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { email: true, phoneNormalized: true, emailVerifiedAt: true, phoneVerifiedAt: true, preferredLanguage: true } });
  return res.json({ id: req.patient.id, fullNameAr: req.patient.fullNameAr, fullNameEn: req.patient.fullNameEn, gender: req.patient.gender, dateOfBirth: req.patient.dateOfBirth, phone: user.phoneNormalized, email: user.email, phoneVerified: Boolean(user.phoneVerifiedAt), emailVerified: Boolean(user.emailVerifiedAt), addressStateId: req.patient.addressStateId, addressDetails: req.patient.addressDetails, emergencyContact: req.patient.emergencyContact, bloodType: req.patient.bloodType, preferredLanguage: user.preferredLanguage });
});

router.patch('/me', validate(z.object({ addressStateId: z.coerce.number().int().min(1).max(18).optional(), addressDetails: z.string().trim().max(300).nullable().optional(), emergencyContact: z.string().trim().min(2).max(150).optional(), bloodType: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).nullable().optional(), preferredLanguage: z.enum(['ar', 'en']).optional() }).refine((body) => Object.keys(body).length > 0)), async (req, res) => {
  await prisma.$transaction([
    prisma.patient.update({ where: { id: req.patient.id }, data: { addressStateId: req.body.addressStateId, addressDetails: req.body.addressDetails, emergencyContact: req.body.emergencyContact, bloodType: req.body.bloodType } }),
    ...(req.body.preferredLanguage ? [prisma.user.update({ where: { id: req.user.id }, data: { preferredLanguage: req.body.preferredLanguage } })] : [])
  ]);
  await audit(req, 'PATIENT_PROFILE_UPDATED', 'Patient updated self-service contact/profile fields.');
  return res.json({ success: true });
});


/**
 * POST /api/patient/me/email-change/request
 *
 * Sends a verification code to the NEW email address.
 * The stored email is not changed until verification succeeds.
 */
router.post(
  '/me/email-change/request',
  validate(
    z.object({
      email: z.string().trim().email().max(254)
    })
  ),
  async (req, res, next) => {
    try {
      const newEmail = normalizeEmail(req.body.email);

      const user = await prisma.user.findUnique({
        where: {
          id: req.user.id
        },
        select: {
          id: true,
          email: true
        }
      });

      if (!user) {
        return sendError(
          res,
          404,
          'USER_NOT_FOUND',
          'User account not found.'
        );
      }

      if (user.email === newEmail) {
        return sendError(
          res,
          409,
          'EMAIL_UNCHANGED',
          'The new email is the same as the current email.'
        );
      }

      const existing = await prisma.user.findUnique({
        where: {
          email: newEmail
        },
        select: {
          id: true
        }
      });

      if (existing && existing.id !== req.user.id) {
        return sendError(
          res,
          409,
          'EMAIL_ALREADY_REGISTERED',
          'This email address is already used by another account.'
        );
      }

      const result =
        await createProfileChangeChallenge({
          userId: req.user.id,
          type: 'PROFILE_EMAIL_CHANGE',
          targetNormalized: newEmail,
          deliveryEmail: newEmail,
          subject: 'Confirm your new email - Al-Shifa Medical Clinic',
          message:
            'A request was made to change the email address for your Al-Shifa patient account.'
        });

      if (!result) {
        return sendError(
          res,
          503,
          'EMAIL_CHANGE_DELIVERY_FAILED',
          'The verification code could not be delivered to the new email address.'
        );
      }

      await audit(
        req,
        'PATIENT_EMAIL_CHANGE_REQUESTED',
        'Patient requested a verified email address change.'
      );

      return res.status(201).json({
        state: 'VERIFICATION_REQUIRED',
        challengeId: result.challenge.id,
        expiresInMinutes:
          PROFILE_CHANGE_EXPIRY_MINUTES,
        ...(result.developmentCode
          ? {
              developmentCode:
                result.developmentCode
            }
          : {})
      });
    } catch (error) {
      next(error);
    }
  }
);


/**
 * POST /api/patient/me/email-change/verify
 */
router.post(
  '/me/email-change/verify',
  validate(
    z.object({
      challengeId: z.string().uuid(),
      code: z.string().regex(/^\d{6}$/)
    })
  ),
  async (req, res, next) => {
    try {
      const result =
        await verifyProfileChangeChallenge({
          challengeId: req.body.challengeId,
          code: req.body.code,
          userId: req.user.id,
          type: 'PROFILE_EMAIL_CHANGE'
        });

      if (result.error === 'INVALID') {
        return sendError(
          res,
          422,
          'EMAIL_CHANGE_INVALID',
          'Email change verification is invalid or already used.'
        );
      }

      if (result.error === 'EXPIRED') {
        return sendError(
          res,
          422,
          'EMAIL_CHANGE_EXPIRED',
          'Email change verification code has expired.'
        );
      }

      if (result.error === 'ATTEMPTS_EXCEEDED') {
        return sendError(
          res,
          429,
          'EMAIL_CHANGE_ATTEMPTS_EXCEEDED',
          'Email change verification attempt limit exceeded.'
        );
      }

      if (result.error === 'INCORRECT') {
        return sendError(
          res,
          422,
          'EMAIL_CHANGE_CODE_INCORRECT',
          'Email change verification code is incorrect.'
        );
      }

      const challenge = result.challenge;

      const currentUser = await prisma.user.findUnique({
        where: {
          id: req.user.id
        },
        select: {
          email: true,
          username: true
        }
      });

      const changedAt = new Date();

      const updated = await prisma.$transaction(
        async (tx) => {
          const consumed =
            await tx.verificationChallenge.updateMany({
              where: {
                id: challenge.id,
                usedAt: null
              },
              data: {
                usedAt: changedAt
              }
            });

          if (consumed.count !== 1) {
            return null;
          }

          return tx.user.update({
            where: {
              id: req.user.id
            },
            data: {
              email: challenge.targetNormalized,
              emailVerifiedAt: changedAt,

              ...(currentUser?.username ===
              currentUser?.email
                ? {
                    username:
                      challenge.targetNormalized
                  }
                : {})
            },
            select: {
              email: true,
              emailVerifiedAt: true
            }
          });
        }
      );

      if (!updated) {
        return sendError(
          res,
          409,
          'EMAIL_CHANGE_ALREADY_COMPLETED',
          'This email change request was already completed.'
        );
      }

      await audit(
        req,
        'PATIENT_EMAIL_CHANGED',
        'Patient changed and verified account email address.'
      );

      return res.json({
        success: true,
        email: updated.email,
        emailVerified: true
      });
    } catch (error) {
      if (error.code === 'P2002') {
        return sendError(
          res,
          409,
          'EMAIL_ALREADY_REGISTERED',
          'This email address is already used by another account.'
        );
      }

      next(error);
    }
  }
);


/**
 * POST /api/patient/me/phone-change/request
 *
 * Until a real SMS provider is configured, phone changes are
 * authorized through the CURRENT VERIFIED EMAIL.
 *
 * This proves account ownership but does NOT prove ownership
 * of the new phone number, so phoneVerifiedAt remains null.
 */
router.post(
  '/me/phone-change/request',
  validate(
    z.object({
      phone: z.string().trim().min(7).max(30)
    })
  ),
  async (req, res, next) => {
    try {
      const newPhone = normalizePhone(req.body.phone);

      if (!newPhone) {
        return sendError(
          res,
          422,
          'PHONE_INVALID',
          'Phone number is invalid.'
        );
      }

      const user = await prisma.user.findUnique({
        where: {
          id: req.user.id
        },
        select: {
          id: true,
          email: true,
          emailVerifiedAt: true,
          phoneNormalized: true
        }
      });

      if (!user) {
        return sendError(
          res,
          404,
          'USER_NOT_FOUND',
          'User account not found.'
        );
      }

      if (user.phoneNormalized === newPhone) {
        return sendError(
          res,
          409,
          'PHONE_UNCHANGED',
          'The new phone number is the same as the current phone number.'
        );
      }

      if (!user.email || !user.emailVerifiedAt) {
        return sendError(
          res,
          422,
          'VERIFIED_EMAIL_REQUIRED',
          'A verified email address is required before changing the phone number.'
        );
      }

      const existing = await prisma.user.findUnique({
        where: {
          phoneNormalized: newPhone
        },
        select: {
          id: true
        }
      });

      if (existing && existing.id !== req.user.id) {
        return sendError(
          res,
          409,
          'PHONE_ALREADY_REGISTERED',
          'This phone number is already used by another account.'
        );
      }

      const result =
        await createProfileChangeChallenge({
          userId: req.user.id,
          type: 'PROFILE_PHONE_CHANGE',
          targetNormalized: newPhone,
          deliveryEmail: user.email,
          subject: 'Confirm phone number change - Al-Shifa Medical Clinic',
          message:
            `A request was made to change your Al-Shifa patient account phone number to ${newPhone}.`
        });

      if (!result) {
        return sendError(
          res,
          503,
          'PHONE_CHANGE_AUTHORIZATION_FAILED',
          'The phone change authorization code could not be delivered.'
        );
      }

      await audit(
        req,
        'PATIENT_PHONE_CHANGE_REQUESTED',
        'Patient requested an authorized phone number change.'
      );

      return res.status(201).json({
        state: 'VERIFICATION_REQUIRED',
        challengeId: result.challenge.id,
        deliveredTo: user.email,
        expiresInMinutes:
          PROFILE_CHANGE_EXPIRY_MINUTES,
        ...(result.developmentCode
          ? {
              developmentCode:
                result.developmentCode
            }
          : {})
      });
    } catch (error) {
      next(error);
    }
  }
);


/**
 * POST /api/patient/me/phone-change/verify
 */
router.post(
  '/me/phone-change/verify',
  validate(
    z.object({
      challengeId: z.string().uuid(),
      code: z.string().regex(/^\d{6}$/)
    })
  ),
  async (req, res, next) => {
    try {
      const result =
        await verifyProfileChangeChallenge({
          challengeId: req.body.challengeId,
          code: req.body.code,
          userId: req.user.id,
          type: 'PROFILE_PHONE_CHANGE'
        });

      if (result.error === 'INVALID') {
        return sendError(
          res,
          422,
          'PHONE_CHANGE_INVALID',
          'Phone change verification is invalid or already used.'
        );
      }

      if (result.error === 'EXPIRED') {
        return sendError(
          res,
          422,
          'PHONE_CHANGE_EXPIRED',
          'Phone change authorization code has expired.'
        );
      }

      if (result.error === 'ATTEMPTS_EXCEEDED') {
        return sendError(
          res,
          429,
          'PHONE_CHANGE_ATTEMPTS_EXCEEDED',
          'Phone change verification attempt limit exceeded.'
        );
      }

      if (result.error === 'INCORRECT') {
        return sendError(
          res,
          422,
          'PHONE_CHANGE_CODE_INCORRECT',
          'Phone change authorization code is incorrect.'
        );
      }

      const challenge = result.challenge;

      const currentUser = await prisma.user.findUnique({
        where: {
          id: req.user.id
        },
        select: {
          username: true,
          phoneNormalized: true
        }
      });

      const changedAt = new Date();

      const updated = await prisma.$transaction(
        async (tx) => {
          const consumed =
            await tx.verificationChallenge.updateMany({
              where: {
                id: challenge.id,
                usedAt: null
              },
              data: {
                usedAt: changedAt
              }
            });

          if (consumed.count !== 1) {
            return null;
          }

          const updatedUser = await tx.user.update({
            where: {
              id: req.user.id
            },
            data: {
              phoneNormalized:
                challenge.targetNormalized,

              // We authenticated the account owner via email,
              // but have not verified ownership of the new
              // phone number with SMS.
              phoneVerifiedAt: null,

              ...(currentUser?.username ===
              currentUser?.phoneNormalized
                ? {
                    username:
                      challenge.targetNormalized
                  }
                : {})
            },
            select: {
              phoneNormalized: true
            }
          });

          await tx.patient.update({
            where: {
              id: req.patient.id
            },
            data: {
              phone:
                challenge.targetNormalized
            }
          });

          return updatedUser;
        }
      );

      if (!updated) {
        return sendError(
          res,
          409,
          'PHONE_CHANGE_ALREADY_COMPLETED',
          'This phone change request was already completed.'
        );
      }

      await audit(
        req,
        'PATIENT_PHONE_CHANGED',
        'Patient changed account phone number through verified email authorization.'
      );

      return res.json({
        success: true,
        phone: updated.phoneNormalized,
        phoneVerified: false,
        verificationStatus: 'PENDING_SMS_VERIFICATION'
      });
    } catch (error) {
      if (error.code === 'P2002') {
        return sendError(
          res,
          409,
          'PHONE_ALREADY_REGISTERED',
          'This phone number is already used by another account.'
        );
      }

      next(error);
    }
  }
);


router.get('/doctors', async (req, res) => {
  const doctors = await prisma.doctor.findMany({ where: { status: 'ACTIVE' }, select: doctorSelect, orderBy: { fullNameEn: 'asc' } });
  return res.json(doctors);
});

router.get('/specialties', async (req, res) => {
  const doctors = await prisma.doctor.findMany({ where: { status: 'ACTIVE' }, select: { specialtyAr: true, specialtyEn: true } });
  const specialties = [...new Map(doctors.map((doctor) => [doctor.specialtyEn.trim().toLowerCase(), { labelAr: doctor.specialtyAr, labelEn: doctor.specialtyEn }])).values()];
  return res.json(specialties);
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
  if (!configuredSlots(doctor, date).includes(time)) { sendError(res, 422, 'INVALID_APPOINTMENT_SLOT', 'The selected time is not in the doctor schedule.'); return null; }
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

router.post('/appointments/:id/cancel', async (req, res) => {
  const appointment = await prisma.appointment.findFirst({ where: { id: req.params.id, patientId: req.patient.id } });
  if (!appointment) return sendError(res, 404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found.');
  if (!['PENDING', 'SCHEDULED', 'CONFIRMED'].includes(appointment.status)) return sendError(res, 409, 'APPOINTMENT_CANNOT_BE_CANCELLED', 'Appointment can no longer be cancelled.');
  const cutoffHours = Number(process.env.PATIENT_CANCELLATION_CUTOFF_HOURS || 2);
  if (cancellationCutoffReached(appointment.appointmentDate, appointment.appointmentTime, cutoffHours)) return sendError(res, 409, 'CANCELLATION_CUTOFF_REACHED', 'Appointment cancellation cutoff has passed.');
  await prisma.appointment.update({ where: { id: appointment.id }, data: { status: 'CANCELLED' } });
  await audit(req, 'PATIENT_APPOINTMENT_CANCELLED', `Patient cancelled appointment ${appointment.id}.`);
  return res.json({ success: true });
});

router.put('/appointments/:id/reschedule', validate(bookingSchema), async (req, res, next) => {
  const appointment = await prisma.appointment.findFirst({ where: { id: req.params.id, patientId: req.patient.id } });
  if (!appointment) return sendError(res, 404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found.');
  if (!['PENDING', 'SCHEDULED', 'CONFIRMED'].includes(appointment.status)) return sendError(res, 409, 'APPOINTMENT_CANNOT_BE_RESCHEDULED', 'Appointment can no longer be rescheduled.');
  if (!(await validateSlot(res, req.body.doctorId, req.body.appointmentDate, req.body.appointmentTime))) return;
  try {
    const updated = await prisma.appointment.update({ where: { id: appointment.id }, data: { ...req.body, status: 'PENDING' }, include: { doctor: { select: doctorSelect } } });
    await audit(req, 'PATIENT_APPOINTMENT_RESCHEDULED', `Patient rescheduled appointment ${appointment.id}.`);
    return res.json(updated);
  } catch (error) {
    if (error.code === 'P2002') return sendError(res, 409, 'APPOINTMENT_SLOT_UNAVAILABLE', 'The requested new slot is no longer available; the original appointment was preserved.');
    next(error);
  }
});

router.get('/lab-results', async (req, res) => {
  const orders = await prisma.labOrder.findMany({ where: { patientId: req.patient.id, status: 'COMPLETED', releasedToPatientAt: { not: null } }, include: { doctor: { select: doctorSelect }, items: { include: { service: { select: { labelAr: true, labelEn: true, category: true } } } } }, orderBy: { orderDate: 'desc' } });
  return res.json(orders.map((order) => ({ id: order.id, orderDate: order.orderDate, releasedAt: order.releasedToPatientAt, doctor: order.doctor, tests: order.items.map((item) => ({ id: item.id, service: item.service, resultValue: item.resultValue, referenceRangeMin: item.referenceRangeMin, referenceRangeMax: item.referenceRangeMax, isOutOfRange: item.isOutOfRange, attachmentPath: item.fileAttachmentPath ? `/api/upload/${item.fileAttachmentPath.split('/').pop()}` : null })) })));
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

export default router;
