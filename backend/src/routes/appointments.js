import express from 'express';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { sendSMS, sendBookingConfirmation, sendStatusUpdateNotification } from '../utils/notifications.js';
import { sendNotification } from './notifications.js';

const router = express.Router();

/**
 * GET /api/appointments/slots
 * Generates and returns available time slots for a doctor on a specific date (YYYY-MM-DD).
 */
router.get('/slots', async (req, res) => {
  const { doctorId, date } = req.query;

  if (!doctorId || !date) {
    return res.status(400).json({ error: 'Doctor ID and date (YYYY-MM-DD) are required.' });
  }

  try {
    // 1. Fetch Doctor
    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId }
    });

    if (!doctor || doctor.status !== 'ACTIVE') {
      return res.status(404).json({ error: 'Active doctor not found.' });
    }

    // 2. Parse schedule configuration
    const weeklySchedule = JSON.parse(doctor.weeklySchedule);
    
    // Determine day of the week
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const parsedDate = new Date(date);
    const dayName = daysOfWeek[parsedDate.getDay()];

    // Find if doctor works on this day
    const dayConfig = weeklySchedule.find((item) => item.day.toLowerCase() === dayName.toLowerCase());
    if (!dayConfig) {
      return res.json([]); // Doctor does not work on this day
    }

    const { startTime, endTime, slotDurationInMinutes } = dayConfig;

    // 3. Generate all possible slots
    const slots = [];
    let current = new Date(`${date}T${startTime}:00`);
    const end = new Date(`${date}T${endTime}:00`);

    while (current < end) {
      const timeString = current.toTimeString().substring(0, 5); // HH:MM
      slots.push(timeString);
      current = new Date(current.getTime() + slotDurationInMinutes * 60000);
    }

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
router.post('/otp/request', async (req, res) => {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required.' });
  }

  // Simulate gateway send
  console.log(`[SMS/WhatsApp Gateway] Sent OTP 1234 to phone: ${phone}`);
  return res.json({ success: true, message: 'OTP sent successfully.' });
});

/**
 * POST /api/appointments/book
 * Public patient booking submission. Handles verification check & rate limit check (2 per day per phone).
 */
router.post('/book', async (req, res) => {
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

  // Validate OTP code (mock validation: code must be '1234')
  if (otpCode !== '1234') {
    return res.status(400).json({ error: 'Incorrect verification code. Please try again.' });
  }

  try {
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

    // 3. Double booking check
    const existingBooking = await prisma.appointment.findFirst({
      where: {
        doctorId,
        appointmentDate,
        appointmentTime,
        status: { notIn: ['CANCELLED', 'NO_SHOW'] }
      }
    });

    if (existingBooking) {
      return res.status(409).json({ error: 'This appointment slot was booked in the meantime. Please select another slot.' });
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
    if (io) {
      io.emit('queueUpdated', { type: 'BOOKING_PENDING', appointmentId: appointment.id, doctorId });
    }

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
    console.error('Booking submission error:', error);
    return res.status(500).json({ error: 'Failed to complete appointment booking.' });
  }
});

/**
 * GET /api/appointments/pending
 * Returns all pending appointment requests awaiting receptionist approval.
 */
router.get('/pending', authenticate, async (req, res) => {
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
router.get('/queue/:doctorId', authenticate, async (req, res) => {
  const doctorId = req.params.doctorId;
  const targetDate = req.query.date || new Date().toISOString().substring(0, 10); // YYYY-MM-DD

  try {
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
router.put('/:id/status', authenticate, async (req, res) => {
  const { status } = req.body;

  try {
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
    if (io) {
      io.emit('queueUpdated', { type: 'STATUS_UPDATE', appointmentId: appointment.id, status, doctorId: appointment.doctorId });
    }

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
router.post('/:id/override', authenticate, async (req, res) => {
  const { justification } = req.body;

  if (!justification) {
    return res.status(400).json({ error: 'Override justification is required.' });
  }

  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id: req.params.id }
    });

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found.' });
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
          justification,
          authorizedById: req.user.id
        }
      }),
      prisma.tenantAuditLog.create({
        data: {
          userId: req.user.id,
          action: 'QUEUE_EMERGENCY_OVERRIDE',
          details: `Emergency override requested for Appointment ${req.params.id}. Justification: ${justification}`,
          ipAddress: req.ip || '127.0.0.1'
        }
      })
    ]);

    // Emit WebSocket update
    const io = req.app.get('io');
    if (io) {
      io.emit('queueUpdated', { type: 'OVERRIDE', appointmentId: req.params.id, doctorId: appointment.doctorId });
    }

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
router.post('/:id/transfer', authenticate, async (req, res) => {
  const { targetDoctorId } = req.body;

  if (!targetDoctorId) {
    return res.status(400).json({ error: 'Target doctor ID is required.' });
  }

  try {
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
    if (io) {
      io.emit('queueUpdated', { type: 'TRANSFER', appointmentId: req.params.id, targetDoctorId });
    }

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
