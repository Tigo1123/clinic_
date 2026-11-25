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

const namePartSchema = z.string()
  .refine((value) => !/\p{Cc}/u.test(value), 'Name part cannot contain control characters.')
  .transform(normalizeNamePart)
  .refine((value) => value.length > 0, 'Name part cannot be blank.')
  .refine((value) => value.length <= NAME_PART_MAX_LENGTH, 'Name part exceeds 80 characters.');

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

export function newPatientSchema(fields) {
  return structuredPatientNameSchema.extend(fields).strict().superRefine((patient, context) => {
    const seen = new Map();
    const repeated = new Set();
    for (const field of STRUCTURED_PATIENT_NAME_FIELDS) {
      const name = patient[field];
      if (!name.includes(' ')) continue;
      const key = field.slice(-2) + ':' + name.toLowerCase();
      if (seen.has(key)) {
        repeated.add(seen.get(key));
        repeated.add(field);
      }
      seen.set(key, field);
    }
    for (const field of repeated) {
      context.addIssue({ code: 'custom', path: [field], message: 'Enter each part of the name in its own field.' });
    }
  });
}
