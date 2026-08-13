import prisma from '../db.js';
import { sendError } from '../utils/apiError.js';

export const ROLES = Object.freeze({
  ADMIN: 'ADMIN', RECEPTIONIST: 'RECEPTIONIST', DOCTOR: 'DOCTOR',
  PHARMACIST: 'PHARMACIST', LAB_TECH: 'LAB_TECH', PATIENT: 'PATIENT'
});

export function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) return sendError(res, 401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
    if (!roles.includes(req.user.role)) return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to perform this action.');
    next();
  };
}

export async function requireOwnedPatient(req, res, next) {
  try {
    if (req.user?.role !== ROLES.PATIENT) return sendError(res, 403, 'PATIENT_ROLE_REQUIRED', 'A patient account is required.');
    const patient = await prisma.patient.findUnique({ where: { userId: req.user.id } });
    if (!patient) return sendError(res, 409, 'PATIENT_RECORD_NOT_LINKED', 'This account is not linked to a patient record.');
    req.patient = patient;
    next();
  } catch (error) { next(error); }
}

export async function doctorHasPatientAccess(user, patientId) {
  if (user.role !== ROLES.DOCTOR || !user.doctorId) return false;
  const appointment = await prisma.appointment.findFirst({
    where: { doctorId: user.doctorId, patientId, status: { not: 'CANCELLED' } },
    select: { id: true }
  });
  return Boolean(appointment);
}

export async function requireDoctorPatientAccess(req, res, next) {
  try {
    const patientId = req.params.id || req.params.patientId || req.body.patientId;
    if (await doctorHasPatientAccess(req.user, patientId)) return next();
    return sendError(res, 403, 'PATIENT_ACCESS_FORBIDDEN', 'This patient is not assigned to the authenticated doctor.');
  } catch (error) { next(error); }
}

export async function requireDoctorAppointmentAccess(req, res, next) {
  try {
    if (req.user.role !== ROLES.DOCTOR || !req.user.doctorId) {
      return sendError(res, 403, 'APPOINTMENT_ACCESS_FORBIDDEN', 'Doctor access is required.');
    }
    const appointmentId = req.params.id || req.params.appointmentId || req.body.appointmentId;
    const appointment = await prisma.appointment.findFirst({
      where: { id: appointmentId, doctorId: req.user.doctorId }, select: { id: true, patientId: true, doctorId: true, status: true }
    });
    if (!appointment) return sendError(res, 403, 'APPOINTMENT_ACCESS_FORBIDDEN', 'This appointment is not assigned to the authenticated doctor.');
    req.appointment = appointment;
    next();
  } catch (error) { next(error); }
}
