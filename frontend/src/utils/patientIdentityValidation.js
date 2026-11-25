import { clinicDateString } from './clinicTime.js';

export const NAME_FIELDS = [
  'firstNameAr', 'fatherNameAr', 'grandfatherNameAr', 'familyNameAr',
  'firstNameEn', 'fatherNameEn', 'grandfatherNameEn', 'familyNameEn'
];

export function latestBirthDate(today = clinicDateString()) {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function isValidPastDate(value, today = clinicDateString()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000') || value >= today) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function patientNameErrors(values) {
  const errors = {};
  const seen = new Map();
  for (const field of NAME_FIELDS) {
    const raw = values[field] || '';
    const name = raw.normalize('NFC').trim().replace(/\s+/gu, ' ');
    if (!name) {
      errors[field] = 'requiredField';
    } else if (name.length > 80 || /\p{Cc}/u.test(raw)) {
      errors[field] = 'onboardingNameInvalid';
    } else if (name.includes(' ')) {
      const key = field.slice(-2) + ':' + name.toLowerCase();
      const previous = seen.get(key);
      if (previous) {
        errors[previous] = 'patientNameRepeated';
        errors[field] = 'patientNameRepeated';
      }
      seen.set(key, field);
    }
  }
  return errors;
}
