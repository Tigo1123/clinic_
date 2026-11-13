const SPECIALTIES = [
  {
    key: 'CARDIOLOGY',
    ar: 'أمراض القلب',
    en: 'Cardiology',
    aliases: ['cardiology', 'cardiologist', 'أمراض القلب', 'امراض القلب', 'قلب']
  },
  {
    key: 'PEDIATRICS',
    ar: 'طب الأطفال',
    en: 'Pediatrics',
    aliases: ['pediatrics', 'paediatrics', 'pediatric', 'paediatric', 'طب الأطفال', 'طب الاطفال', 'أطفال', 'اطفال']
  },
  {
    key: 'GENERAL_MEDICINE',
    ar: 'طب عام',
    en: 'General Medicine',
    aliases: ['general medicine', 'general practice', 'general practitioner', 'general', 'طب عام', 'الطب العام']
  }
];

export function normalizeSpecialtyLookup(value = '') {
  return String(value)
    .trim()
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/\s+/g, ' ');
}

export function normalizeDoctorDirectorySearch(value = '') {
  return normalizeSpecialtyLookup(value)
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ى/g, 'ي')
    .replace(/(^|\s)(دكتور|دكتورة|د\.?|doctor|dr\.?)\s*/gi, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function knownSpecialty(...values) {
  const normalized = values.filter(Boolean).map(normalizeSpecialtyLookup);
  return SPECIALTIES.find((specialty) => specialty.aliases.some((alias) => normalized.includes(normalizeSpecialtyLookup(alias))));
}

export function doctorSpecialtyKey(doctor = {}) {
  const known = knownSpecialty(doctor.specialtyEn, doctor.specialtyAr);
  if (known) return known.key;
  const fallback = doctor.specialtyEn || doctor.specialtyAr || '';
  return fallback ? `OTHER:${normalizeSpecialtyLookup(fallback)}` : '';
}

export function localizeDoctorSpecialty(doctor = {}, language = 'en') {
  const known = knownSpecialty(doctor.specialtyEn, doctor.specialtyAr);
  if (known) return language?.startsWith('ar') ? known.ar : known.en;
  return language?.startsWith('ar')
    ? (doctor.specialtyAr || doctor.specialtyEn || '')
    : (doctor.specialtyEn || doctor.specialtyAr || '');
}

export function doctorSpecialtySearchTerms(doctor = {}) {
  const known = knownSpecialty(doctor.specialtyEn, doctor.specialtyAr);
  return [
    doctor.specialtyAr,
    doctor.specialtyEn,
    ...(known ? [known.ar, known.en, ...known.aliases] : [])
  ].filter(Boolean);
}

export function doctorMatchesDirectorySearch(doctor = {}, query = '') {
  const normalizedQuery = normalizeDoctorDirectorySearch(query);
  if (!normalizedQuery) return true;
  return normalizeDoctorDirectorySearch([
    doctor.fullNameAr,
    doctor.fullNameEn,
    ...doctorSpecialtySearchTerms(doctor)
  ].filter(Boolean).join(' ')).includes(normalizedQuery);
}

export function doctorSpecialtyOptions(doctors = [], language = 'en') {
  const options = new Map();
  for (const doctor of doctors) {
    const key = doctorSpecialtyKey(doctor);
    if (key && !options.has(key)) options.set(key, localizeDoctorSpecialty(doctor, language));
  }
  return [...options].map(([key, label]) => ({ key, label }));
}
