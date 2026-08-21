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

const EMR_CONSENT_VALIDITY_MS = 24 * 60 * 60 * 1000;
const BREAK_GLASS_VALIDITY_MS = 2 * 60 * 60 * 1000;

/**
 * Builds the record-level visibility policy for a doctor and patient.
 *
 * Ordinary patient access only exposes records owned by the authenticated
 * doctor's profile. A verified, recent EMR consent or a doctor/user-specific
 * break-glass grant permits the existing patient-wide cross-doctor access.
 */
export async function getDoctorMedicalRecordAccess(user, patientId, now = new Date()) {
  if (user.role !== ROLES.DOCTOR || !user.doctorId) {
    return { hasCrossDoctorAccess: false, where: { id: { in: [] } } };
  }

  const [verifiedConsent, activeBreakGlass] = await Promise.all([
    prisma.consent.findFirst({
      where: {
        patientId,
        consentType: 'EMR_ACCESS',
        otpVerified: true,
        timestamp: { gte: new Date(now.getTime() - EMR_CONSENT_VALIDITY_MS) }
      },
      select: { id: true }
    }),
    prisma.tenantAuditLog.findFirst({
      where: {
        userId: user.id,
        action: `EMR_BREAK_THE_GLASS_BYPASS:${patientId}`,
        timestamp: { gte: new Date(now.getTime() - BREAK_GLASS_VALIDITY_MS) }
      },
      select: { id: true }
    })
  ]);

  const hasCrossDoctorAccess = Boolean(verifiedConsent || activeBreakGlass);
  return {
    hasCrossDoctorAccess,
    where: hasCrossDoctorAccess ? { patientId } : { patientId, doctorId: user.doctorId }
  };
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
