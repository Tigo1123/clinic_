import { parsePhoneNumberFromString } from 'libphonenumber-js';

export function normalizeEmail(value) {
  if (!value) return null;
  return value.trim().toLowerCase();
}

export function normalizePhone(value, defaultCountry = process.env.PHONE_DEFAULT_COUNTRY || 'SD') {
  if (!value) return null;
  const parsed = parsePhoneNumberFromString(String(value).trim(), defaultCountry);
  if (!parsed?.isValid()) return null;
  return parsed.number;
}
