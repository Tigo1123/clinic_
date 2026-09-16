import { z } from 'zod';
import { DateTime } from 'luxon';
import { getClinicDateString } from './clinicTime.js';
import { normalizeNationalId, normalizePatientPhone } from './patientIdentity.js';
import { STRUCTURED_PATIENT_NAME_FIELDS } from './patientName.js';

export const patientDateOfBirthSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = DateTime.fromISO(value, { zone: 'UTC' });
    return date.isValid && date.year > 0 && date.toISODate() === value && value < getClinicDateString();
  }, 'Date of birth must be a valid calendar date in the past.');

// Patient phone is not unique: family members may share one number. Serialize
// duplicate checks on phone + DOB (and national ID), without inventing a new
// identity table or changing the MRN sequence. Acquire multiple locks in order.
export async function lockPatientIdentity(tx, { phone, dateOfBirth, nationalId }) {
  const normalizedPhone = normalizePatientPhone(phone);
  const normalizedId = normalizeNationalId(nationalId);
  const keys = [
    ...(normalizedPhone && dateOfBirth ? [`patient-phone-dob:${normalizedPhone}:${dateOfBirth}`] : []),
    ...(normalizedId ? [`patient-national-id:${normalizedId}`] : [])
  ].sort();
  for (const key of keys) await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

// Explicit DTO: never serialize User, credentials, ownership, or clinical data.
export function patientIdentitySummary(patient) {
  return {
    ...(patient.id ? { id: patient.id } : {}),
    ...(patient.fileNumber ? { fileNumber: patient.fileNumber } : {}),
    fullNameAr: patient.fullNameAr, fullNameEn: patient.fullNameEn,
    ...Object.fromEntries(STRUCTURED_PATIENT_NAME_FIELDS.map((key) => [key, patient[key] ?? null])),
    gender: patient.gender, dateOfBirth: patient.dateOfBirth, phone: patient.phone,
    addressStateId: patient.addressStateId,
    addressDetails: patient.addressDetails ?? null,
    emergencyContact: patient.emergencyContact ?? null
  };
}
