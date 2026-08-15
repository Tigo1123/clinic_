import express from 'express';
import { z } from 'zod';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { allowRoles, requireOwnedPatient, ROLES } from '../middleware/policies.js';
import { validate } from '../middleware/validate.js';
import { sendError } from '../utils/apiError.js';
import { configuredSlots, DATE_PATTERN, TIME_PATTERN, todayString } from '../utils/scheduling.js';
import { decrypt } from '../utils/encryption.js';
import { cancellationCutoffReached } from '../utils/clinicTime.js';

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

router.get('/me', async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { email: true, phoneNormalized: true, emailVerifiedAt: true, phoneVerifiedAt: true, preferredLanguage: true } });
  return res.json({ id: req.patient.id, fullNameAr: req.patient.fullNameAr, fullNameEn: req.patient.fullNameEn, gender: req.patient.gender, dateOfBirth: req.patient.dateOfBirth, phone: user.phoneNormalized, email: user.email, phoneVerified: Boolean(user.phoneVerifiedAt), emailVerified: Boolean(user.emailVerifiedAt), addressStateId: req.patient.addressStateId, addressDetails: req.patient.addressDetails, emergencyContact: req.patient.emergencyContact, preferredLanguage: user.preferredLanguage });
});

router.patch('/me', validate(z.object({ addressStateId: z.coerce.number().int().min(1).max(18).optional(), addressDetails: z.string().trim().max(300).nullable().optional(), emergencyContact: z.string().trim().min(2).max(150).optional(), preferredLanguage: z.enum(['ar', 'en']).optional() }).refine((body) => Object.keys(body).length > 0)), async (req, res) => {
  await prisma.$transaction([
    prisma.patient.update({ where: { id: req.patient.id }, data: { addressStateId: req.body.addressStateId, addressDetails: req.body.addressDetails, emergencyContact: req.body.emergencyContact } }),
    ...(req.body.preferredLanguage ? [prisma.user.update({ where: { id: req.user.id }, data: { preferredLanguage: req.body.preferredLanguage } })] : [])
  ]);
  await audit(req, 'PATIENT_PROFILE_UPDATED', 'Patient updated self-service contact/profile fields.');
  return res.json({ success: true });
});

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
