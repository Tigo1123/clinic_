import { z } from 'zod';

export const NAME_PART_MAX_LENGTH = 80;
export const STRUCTURED_PATIENT_NAME_FIELDS = Object.freeze([
  'firstNameAr', 'fatherNameAr', 'grandfatherNameAr', 'familyNameAr',
  'firstNameEn', 'fatherNameEn', 'grandfatherNameEn', 'familyNameEn'
]);

export function normalizeNamePart(value) {
  return typeof value === 'string' ? value.normalize('NFC').trim().replace(/\s+/gu, ' ') : '';
}

export function structuredPatientName(input) {
  const fields = ['firstNameAr', 'fatherNameAr', 'grandfatherNameAr', 'familyNameAr', 'firstNameEn', 'fatherNameEn', 'grandfatherNameEn', 'familyNameEn'];
  const normalized = Object.fromEntries(fields.map((field) => [field, normalizeNamePart(input[field])]));
  if (fields.some((field) => !normalized[field])) return null;
  return {
    ...normalized,
    fullNameAr: [normalized.firstNameAr, normalized.fatherNameAr, normalized.grandfatherNameAr, normalized.familyNameAr].join(' '),
    fullNameEn: [normalized.firstNameEn, normalized.fatherNameEn, normalized.grandfatherNameEn, normalized.familyNameEn].join(' ')
  };
}

export function hasStructuredPatientName(patient) {
  return Boolean(structuredPatientName(patient));
}

const namePartSchema = z.string().max(NAME_PART_MAX_LENGTH)
  .transform(normalizeNamePart)
  .refine((value) => value.length > 0, 'Name part cannot be blank.')
  .refine((value) => !/[\u0000-\u001F\u007F]/u.test(value), 'Name part cannot contain control characters.');

// One shared schema ensures every new-patient path accepts precisely the
// components that `structuredPatientName` can canonically derive.
export const structuredPatientNameSchema = z.object({
  firstNameAr: namePartSchema,
  fatherNameAr: namePartSchema,
  grandfatherNameAr: namePartSchema,
  familyNameAr: namePartSchema,
  firstNameEn: namePartSchema,
  fatherNameEn: namePartSchema,
  grandfatherNameEn: namePartSchema,
  familyNameEn: namePartSchema
});
