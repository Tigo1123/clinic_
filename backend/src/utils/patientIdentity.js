import { normalizePhone } from './identity.js';

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

export function normalizeFileNumber(value) {
  if (typeof value !== 'string' || value.length > 30 || CONTROL_CHARACTERS.test(value)) return null;
  const match = value.trim().toUpperCase().match(/^SHF-(\d+)$/);
  if (!match) return null;
  const digits = match[1].replace(/^0+/, '') || '0';
  return `SHF-${digits.padStart(6, '0')}`;
}

export function normalizePatientPhone(value) {
  if (typeof value !== 'string' || value.length > 30 || CONTROL_CHARACTERS.test(value)) return null;
  const input = value.trim();
  if (!input) return null;
  if (input.startsWith('+')) return normalizePhone(input);
  const countries = [...new Set([process.env.PHONE_DEFAULT_COUNTRY || 'SD', 'SD', 'RW'])];
  const matches = [...new Set(countries.map((country) => normalizePhone(input, country)).filter(Boolean))];
  return matches.length === 1 ? matches[0] : null;
}

export function normalizeNationalId(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 30 || CONTROL_CHARACTERS.test(value)) return null;
  const normalized = value.trim().normalize('NFKC').toUpperCase();
  return normalized || null;
}

export function maskPhone(value) {
  const normalized = normalizePatientPhone(value);
  if (!normalized) return '••••';
  return `${normalized.slice(0, Math.min(4, normalized.length - 4))}••••${normalized.slice(-3)}`;
}

export async function findPossiblePatientDuplicates(client, { phone, dateOfBirth, nationalId }, take = 5) {
  const normalizedPhone = normalizePatientPhone(phone);
  const normalizedNationalId = normalizeNationalId(nationalId);
  const candidates = await client.patient.findMany({
    where: {
      OR: [
        ...(normalizedNationalId ? [{ nationalId: normalizedNationalId }] : []),
        ...(dateOfBirth ? [{ dateOfBirth }] : [])
      ]
    },
    select: { id: true, fullNameAr: true, fullNameEn: true, phone: true, dateOfBirth: true, nationalId: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 200
  });
  return candidates.filter((candidate) =>
    (normalizedNationalId && normalizeNationalId(candidate.nationalId) === normalizedNationalId)
    || (normalizedPhone && candidate.dateOfBirth === dateOfBirth && normalizePatientPhone(candidate.phone) === normalizedPhone)
  ).slice(0, take);
}

export function safeDuplicateCandidates(candidates) {
  return candidates.map(({ id, fullNameAr, fullNameEn, phone, dateOfBirth }) => ({
    id, fullNameAr, fullNameEn, phoneMasked: maskPhone(phone), dateOfBirth
  }));
}
