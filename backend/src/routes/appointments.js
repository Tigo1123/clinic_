import express from 'express';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { sendSMS, sendBookingConfirmation, sendStatusUpdateNotification } from '../utils/notifications.js';
import { sendNotification } from './notifications.js';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { allowRoles, ROLES } from '../middleware/policies.js';
import { sendError } from '../utils/apiError.js';
import rateLimit from 'express-rate-limit';
import { rateLimits } from '../config.js';
import crypto from 'crypto';
import { emitQueueUpdate } from '../utils/socketEvents.js';
import { configuredSlots, DATE_PATTERN, TIME_PATTERN, todayString } from '../utils/scheduling.js';

const router = express.Router();
const otpLimiter = rateLimit({ windowMs: rateLimits.windowMs, limit: rateLimits.verification, standardHeaders: 'draft-7', legacyHeaders: false });
const developmentOtps = new Map();

/**
 * GET /api/appointments/slots
 * Generates and returns available time slots for a doctor on a specific date (YYYY-MM-DD).
 */
const appointmentStatuses = ['PENDING', 'SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION', 'WAITING_LAB', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];
const transitions = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  SCHEDULED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['IN_CONSULTATION', 'CANCELLED', 'NO_SHOW'],
  IN_CONSULTATION: ['WAITING_LAB', 'COMPLETED'],
  WAITING_LAB: ['IN_CONSULTATION'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: []
};

router.get('/slots', validate(z.object({ doctorId: z.string().uuid(), date: z.string().regex(DATE_PATTERN) }), 'query'), async (req, res) => {
  const { doctorId, date } = req.query;

  if (date < todayString()) return sendError(res, 422, 'APPOINTMENT_DATE_IN_PAST', 'Past appointment dates are not allowed.');

  try {
    // 1. Fetch Doctor
    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId }
    });

    if (!doctor || doctor.status !== 'ACTIVE') {
      return res.status(404).json({ error: 'Active doctor not found.' });
    }

    // 2. Parse schedule configuration
    const slots = configuredSlots(doctor, date);

    // 4. Fetch already booked slots for this doctor on this day
    const bookings = await prisma.appointment.findMany({
      where: {
        doctorId,
        appointmentDate: date,
        status: { notIn: ['CANCELLED', 'NO_SHOW'] }
      },
      select: { appointmentTime: true }
    });

    const bookedTimes = bookings.map((b) => b.appointmentTime);

    // 5. Filter out booked slots
    const availableSlots = slots.filter((slot) => !bookedTimes.includes(slot));

    return res.json(availableSlots);

  } catch (error) {
    console.error('Slot calculation error:', error);
    return res.status(500).json({ error: 'Failed to retrieve available slots.' });
  }
});

/**
 * POST /api/appointments/otp/request
 * Mock endpoint to send OTP code to patient via SMS/WhatsApp.
 */
router.post('/otp/request', otpLimiter, async (req, res) => {
  if (process.env.NODE_ENV === 'production') return sendError(res, 503, 'SMS_PROVIDER_UNAVAILABLE', 'SMS verification is not configured. Use an authenticated patient account to book.');
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required.' });
  }

  const code = String(crypto.randomInt(100000, 1000000));
  developmentOtps.set(phone, { code, expiresAt: Date.now() + 10 * 60 * 1000 });
  return res.json({ success: true, message: 'Development verification code generated.', developmentCode: code });
});

/**
 * POST /api/appointments/book
 * Public patient booking submission. Handles verification check & rate limit check (2 per day per phone).
 */
router.post('/book', validate(z.object({
  doctorId: z.string().uuid(), appointmentDate: z.string().regex(DATE_PATTERN), appointmentTime: z.string().regex(TIME_PATTERN),
  fullNameAr: z.string().trim().min(2).max(150), fullNameEn: z.string().trim().min(2).max(150),
  gender: z.enum(['MALE', 'FEMALE']), dateOfBirth: z.string().regex(DATE_PATTERN), nationalId: z.string().trim().max(30).optional(),
  phone: z.string().trim().min(7).max(20), addressStateId: z.coerce.number().int().min(1).max(18), otpCode: z.string().length(6)
})), async (req, res) => {
  if (process.env.NODE_ENV === 'production') return sendError(res, 503, 'PUBLIC_BOOKING_VERIFICATION_UNAVAILABLE', 'Public OTP booking is unavailable. Use an authenticated patient account to book.');
  const {
    doctorId,
    appointmentDate,
    appointmentTime,
    fullNameAr,
    fullNameEn,
    gender,
    dateOfBirth,
    nationalId,
    phone,
    addressStateId,
    otpCode
  } = req.body;

  const issuedOtp = developmentOtps.get(phone);
  if (!issuedOtp || issuedOtp.expiresAt <= Date.now() || otpCode !== issuedOtp.code) {
    return res.status(400).json({ error: 'Incorrect verification code. Please try again.' });
  }

  try {
    if (appointmentDate < todayString()) return sendError(res, 422, 'APPOINTMENT_DATE_IN_PAST', 'Past appointment dates are not allowed.');
    if (dateOfBirth >= todayString()) return sendError(res, 422, 'INVALID_DATE_OF_BIRTH', 'Date of birth must be in the past.');
    const doctor = await prisma.doctor.findFirst({ where: { id: doctorId, status: 'ACTIVE' } });
    if (!doctor) return sendError(res, 404, 'DOCTOR_NOT_FOUND', 'Active doctor not found.');
    if (!configuredSlots(doctor, appointmentDate).includes(appointmentTime)) {
      return sendError(res, 422, 'INVALID_APPOINTMENT_SLOT', 'The selected time is not in the doctor schedule.');
    }
    // 1. Rate Limit check: max 2 bookings per day per phone number
    const dailyBookingsCount = await prisma.appointment.count({
      where: {
        appointmentDate,
        patient: { phone }
      }
    });

    if (dailyBookingsCount >= 2) {
      return res.status(429).json({ error: 'Sorry, you have exceeded the maximum allowed bookings for today (max 2 per phone).' });
    }

    // 2. Check if patient already exists, or create new patient record
    let patient = null;
    if (nationalId) {
      patient = await prisma.patient.findUnique({
        where: { nationalId }
      });
    }

    if (!patient) {
      patient = await prisma.patient.findFirst({
        where: { phone }
      });
    }

    if (!patient) {
      patient = await prisma.patient.create({
        data: {
          fullNameAr,
          fullNameEn,
          gender,
          dateOfBirth,
          nationalId: nationalId || null,
          phone,
          addressStateId: parseInt(addressStateId),
          emergencyContact: 'Self',
          status: 'ACTIVE'
        }
      });
    }

    // 3. Friendly pre-check; the database unique index is the final concurrency guard.
    const existingBooking = await prisma.appointment.findFirst({
      where: {
        doctorId,
        appointmentDate,
        appointmentTime,
        status: { notIn: ['CANCELLED', 'NO_SHOW'] }
      }
    });

    if (existingBooking) {
      return sendError(res, 409, 'APPOINTMENT_SLOT_UNAVAILABLE', 'This appointment slot was booked in the meantime. Please select another slot.');
    }

    // 4. Create appointment with PENDING status (awaiting receptionist approval)
    const appointment = await prisma.appointment.create({
      data: {
        patientId: patient.id,
        doctorId,
        appointmentDate,
        appointmentTime,
        status: 'PENDING'
      },
      include: {
        doctor: true,
        patient: true
      }
    });

    // 5. Send Multi-Channel Notifications & Get WhatsApp Links
    const notifResult = await sendBookingConfirmation(appointment);

    // Emit WebSocket update & notify receptionists in real-time
    const io = req.app.get('io');
    emitQueueUpdate(io, { type: 'BOOKING_PENDING', appointmentId: appointment.id, doctorId }, [doctorId]);

    // Query receptionists and admin users to send target notifications
    try {
      const receptionists = await prisma.user.findMany({
        where: {
          role: { in: ['RECEPTIONIST', 'ADMIN'] },
          status: 'ACTIVE'
        },
        select: { id: true }
      });

      const patientName = patient.fullNameAr || patient.fullNameEn;
      const doctorName = appointment.doctor?.fullNameAr || appointment.doctor?.fullNameEn || 'الطبيب';
      const notifTitle = 'طلب موعد جديد بانتظار التأكيد';
      const notifMsg = `تم استلام طلب موعد جديد للمريض (${patientName}) مع (${doctorName}) بتاريخ ${appointmentDate} الساعة ${appointmentTime}.`;

      for (const recep of receptionists) {
        await sendNotification(io, {
          userId: recep.id,
          title: notifTitle,
          message: notifMsg
        });
      }
    } catch (notifErr) {
      console.error('Failed to dispatch receptionist notifications:', notifErr);
    }

    return res.status(201).json({
      ...appointment,
      whatsAppLinkAr: notifResult?.whatsAppLinkAr,
      whatsAppLinkEn: notifResult?.whatsAppLinkEn
    });

  } catch (error) {
    if (error.code === 'P2002' || String(error.message).includes('Appointment_active_doctor_slot_key')) {
      return sendError(res, 409, 'APPOINTMENT_SLOT_UNAVAILABLE', 'This appointment slot was booked in the meantime. Please select another slot.');
    }
    console.error('Booking submission error:', error);
    return res.status(500).json({ error: 'Failed to complete appointment booking.' });
  }
});

/**
 * GET /api/appointments/pending
 * Returns all pending appointment requests awaiting receptionist approval.
 */
router.get('/pending', authenticate, allowRoles(ROLES.ADMIN, ROLES.RECEPTIONIST), async (req, res) => {
  try {
    const pendingAppointments = await prisma.appointment.findMany({
      where: {
        status: 'PENDING'
      },
      include: {
        patient: true,
        doctor: true
      },
      orderBy: [
        { appointmentDate: 'asc' },
        { appointmentTime: 'asc' }
      ]
    });
    return res.json(pendingAppointments);
  } catch (error) {
    console.error('Pending appointments fetch error:', error);
    return res.status(500).json({ error: 'Failed to retrieve pending appointments.' });
  }
});

/**
 * GET /api/appointments/queue/:doctorId
 * Returns the daily queue (Checked-In, Consultation, Scheduled) for a doctor.
 */
router.get('/queue/:doctorId', authenticate, allowRoles(ROLES.ADMIN, ROLES.RECEPTIONIST, ROLES.DOCTOR), async (req, res) => {
  const doctorId = req.params.doctorId;
  const targetDate = req.query.date || todayString();

  try {
    if (req.user.role === ROLES.DOCTOR && req.user.doctorId !== doctorId) {
      return sendError(res, 403, 'DOCTOR_QUEUE_FORBIDDEN', 'Doctors may only access their own queue.');
    }
    const queue = await prisma.appointment.findMany({
      where: {
        doctorId,
        appointmentDate: targetDate,
        status: { notIn: ['CANCELLED', 'NO_SHOW', 'PENDING'] }
      },
      include: {
        patient: true,
        emergencyOverride: true
      },
      orderBy: [
        { status: 'desc' }, // In Consultation, Checked In, Scheduled
        { appointmentTime: 'asc' }
      ]
    });

    // Custom sorting: If emergencyOverride exists, put at the top of Checked In queue
    const sortedQueue = queue.sort((a, b) => {
      const aHasEmergency = a.emergencyOverride ? 1 : 0;
      const bHasEmergency = b.emergencyOverride ? 1 : 0;
      if (aHasEmergency !== bHasEmergency) {
        return bHasEmergency - aHasEmergency; // put emergency first
      }
      return 0; // maintain default date/status sorting otherwise
    });

    return res.json(sortedQueue);
  } catch (error) {
    console.error('Queue retrieval error:', error);
    return res.status(500).json({ error: 'Failed to retrieve active doctor queue.' });
  }
});

/**
 * PUT /api/appointments/:id/status
 * Updates status of an appointment.
 */
router.put('/:id/status', authenticate, allowRoles(ROLES.ADMIN, ROLES.RECEPTIONIST, ROLES.DOCTOR), validate(z.object({ status: z.enum(appointmentStatuses) })), async (req, res) => {
  const { status } = req.body;

  try {
    const current = await prisma.appointment.findUnique({ where: { id: req.params.id } });
    if (!current) return sendError(res, 404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found.');
    if (!transitions[current.status]?.includes(status)) {
      return sendError(res, 409, 'ILLEGAL_APPOINTMENT_STATUS_TRANSITION', `Appointment cannot move from ${current.status} to ${status}.`);
    }
    if (req.user.role === ROLES.DOCTOR) {
      if (current.doctorId !== req.user.doctorId || !['IN_CONSULTATION', 'COMPLETED'].includes(status)) {
        return sendError(res, 403, 'APPOINTMENT_STATUS_FORBIDDEN', 'Doctors may only advance their own clinical appointments.');
      }
    } else if (req.user.role === ROLES.RECEPTIONIST && !['CONFIRMED', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW'].includes(status)) {
      return sendError(res, 403, 'APPOINTMENT_STATUS_FORBIDDEN', 'Receptionists cannot set clinical appointment states.');
    }
    const appointment = await prisma.appointment.update({
      where: { id: req.params.id },
      data: { status },
      include: {
        patient: true,
        doctor: true
      }
    });

    // Trigger status update notification (SMS/Email) & get WhatsApp links
    const notifResult = await sendStatusUpdateNotification(appointment, status);

    // Emit WebSocket update
    const io = req.app.get('io');
    emitQueueUpdate(io, { type: 'STATUS_UPDATE', appointmentId: appointment.id, status, doctorId: appointment.doctorId }, [appointment.doctorId]);

    return res.json({
      ...appointment,
      whatsAppLinkAr: notifResult?.whatsAppLinkAr,
      whatsAppLinkEn: notifResult?.whatsAppLinkEn
    });
  } catch (error) {
    console.error('Update status error:', error);
    return res.status(500).json({ error: 'Failed to update appointment status.' });
  }
});

/**
 * POST /api/appointments/:id/override
 * Emergency Queue Override. Places patient at top of waitlist.
 */
router.post('/:id/override', authenticate, allowRoles(ROLES.ADMIN, ROLES.RECEPTIONIST), async (req, res) => {
  const { justification } = req.body;

  if (typeof justification !== 'string' || justification.trim().length < 20) {
    return sendError(res, 422, 'OVERRIDE_JUSTIFICATION_REQUIRED', 'Emergency override justification must contain at least 20 characters.');
  }

  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id: req.params.id }
    });

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }
    if (!['PENDING', 'SCHEDULED', 'CONFIRMED', 'CHECKED_IN'].includes(appointment.status)) {
      return sendError(res, 409, 'OVERRIDE_INVALID_STATE', `Emergency override is not allowed from ${appointment.status}.`);
    }
    if (await prisma.emergencyOverride.findUnique({ where: { appointmentId: appointment.id } })) {
      return sendError(res, 409, 'OVERRIDE_ALREADY_APPLIED', 'An emergency override already exists for this appointment.');
    }

    // Update status to Checked In (if not already) and create Override log
    await prisma.$transaction([
      prisma.appointment.update({
        where: { id: req.params.id },
        data: { status: 'CHECKED_IN' }
      }),
      prisma.emergencyOverride.create({
        data: {
          appointmentId: req.params.id,
          justification: justification.trim(),
          authorizedById: req.user.id
        }
      }),
      prisma.tenantAuditLog.create({
        data: {
          userId: req.user.id,
          action: 'QUEUE_EMERGENCY_OVERRIDE',
          details: `Emergency override requested for Appointment ${req.params.id}. Justification: ${justification.trim()}`,
          ipAddress: req.ip || '127.0.0.1'
        }
      })
    ]);

    // Emit WebSocket update
    const io = req.app.get('io');
    emitQueueUpdate(io, { type: 'OVERRIDE', appointmentId: req.params.id, doctorId: appointment.doctorId }, [appointment.doctorId]);

    return res.json({ success: true, message: 'Emergency queue override applied successfully.' });
  } catch (error) {
    console.error('Override execution error:', error);
    return res.status(500).json({ error: 'Failed to apply emergency override.' });
  }
});

/**
 * POST /api/appointments/:id/transfer
 * Internally transfers a checked-in patient to another doctor's queue.
 */
router.post('/:id/transfer', authenticate, allowRoles(ROLES.ADMIN, ROLES.RECEPTIONIST), async (req, res) => {
  const { targetDoctorId } = req.body;

  if (!targetDoctorId) {
    return res.status(400).json({ error: 'Target doctor ID is required.' });
  }

  try {
    const [appointment, targetDoctor] = await Promise.all([
      prisma.appointment.findUnique({ where: { id: req.params.id } }),
      prisma.doctor.findFirst({ where: { id: targetDoctorId, status: 'ACTIVE' } })
    ]);
    if (!appointment) return sendError(res, 404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found.');
    if (!targetDoctor) return sendError(res, 404, 'DOCTOR_NOT_FOUND', 'Target doctor is not active.');
    if (appointment.status !== 'CHECKED_IN') return sendError(res, 409, 'TRANSFER_INVALID_STATE', 'Only checked-in appointments can be transferred.');
    if (!configuredSlots(targetDoctor, appointment.appointmentDate).includes(appointment.appointmentTime)) {
      return sendError(res, 409, 'TARGET_DOCTOR_UNAVAILABLE', 'Target doctor is not scheduled for this appointment slot.');
    }
    const conflict = await prisma.appointment.findFirst({ where: {
      doctorId: targetDoctorId, appointmentDate: appointment.appointmentDate,
      appointmentTime: appointment.appointmentTime, status: { notIn: ['CANCELLED', 'NO_SHOW'] }, id: { not: appointment.id }
    } });
    if (conflict) return sendError(res, 409, 'APPOINTMENT_SLOT_UNAVAILABLE', 'Target doctor already has an appointment in this slot.');
    await prisma.$transaction([
      prisma.appointment.update({
        where: { id: req.params.id },
        data: {
          doctorId: targetDoctorId,
          status: 'CHECKED_IN' // Maintain checked-in status in target doctor's queue
        }
      }),
      prisma.tenantAuditLog.create({
        data: {
          userId: req.user.id,
          action: 'PATIENT_INTERNAL_TRANSFER',
          details: `Transferred appointment ${req.params.id} to Doctor ${targetDoctorId}`,
          ipAddress: req.ip || '127.0.0.1'
        }
      })
    ]);

    // Emit WebSocket update
    const io = req.app.get('io');
    emitQueueUpdate(io, { type: 'TRANSFER', appointmentId: req.params.id, targetDoctorId }, [appointment.doctorId, targetDoctorId]);

    return res.json({ success: true, message: 'Patient transferred internally successfully.' });
  } catch (error) {
    console.error('Transfer execution error:', error);
    return res.status(500).json({ error: 'Failed to complete internal transfer.' });
  }
});

/**
 * GET /api/appointments/doctors
 * Returns all active doctors.
 */
router.get('/doctors', async (req, res) => {
  try {
    const doctors = await prisma.doctor.findMany({
      where: { status: 'ACTIVE' }
    });
    return res.json(doctors);
  } catch (error) {
    console.error('Fetch doctors error:', error);
    return res.status(500).json({ error: 'Failed to retrieve doctors.' });
  }
});

export default router;
