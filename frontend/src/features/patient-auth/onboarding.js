import { DEFAULT_PHONE_COUNTRY, normalisePatientPhone } from './phoneCountries.js';

export const ONBOARDING_STEPS = ['arabicName', 'englishName', 'personalDetails', 'contact', 'address', 'security', 'review'];

export const NAME_FIELDS = [
  'firstNameAr', 'fatherNameAr', 'grandfatherNameAr', 'familyNameAr',
  'firstNameEn', 'fatherNameEn', 'grandfatherNameEn', 'familyNameEn'
];

export const INITIAL_ONBOARDING_FORM = {
  firstNameAr: '', fatherNameAr: '', grandfatherNameAr: '', familyNameAr: '',
  firstNameEn: '', fatherNameEn: '', grandfatherNameEn: '', familyNameEn: '',
  phoneCountry: DEFAULT_PHONE_COUNTRY, phone: '', email: '', dateOfBirth: '', gender: '', addressStateId: '1',
  password: '', confirmPassword: ''
};

const NAME_MAX = 80;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function normaliseOnboardingForm(form) {
  return Object.fromEntries(Object.entries(form).map(([key, value]) =>
    [key, typeof value === 'string' && key !== 'password' && key !== 'confirmPassword' ? value.trim().replace(/\s+/gu, ' ') : value]
  ));
}

export function passwordChecks(password) {
  return {
    length: password.length >= 10,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /\d/.test(password)
  };
}

export function isValidPastDate(value, today = new Date().toISOString().slice(0, 10)) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) === '0000' || value >= today) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateOnboardingStep(form, step, messages, today) {
  const value = normaliseOnboardingForm(form);
  const errors = {};
  const required = (field) => { if (!value[field]) errors[field] = messages.required; };
  const nameFields = step === 0 ? NAME_FIELDS.slice(0, 4) : step === 1 ? NAME_FIELDS.slice(4) : [];
  for (const field of nameFields) {
    required(field);
    if (value[field] && (value[field].length > NAME_MAX || /[\u0000-\u001F\u007F]/u.test(value[field]))) errors[field] = messages.nameInvalid;
  }
  if (step === 2) { required('gender'); if (!isValidPastDate(value.dateOfBirth, today)) errors.dateOfBirth = messages.dateInvalid; }
  if (step === 3) { if (!normalisePatientPhone(value.phone, value.phoneCountry)) errors.phone = messages.phoneInvalid; if (!emailPattern.test(value.email)) errors.email = messages.emailInvalid; }
  if (step === 4) required('addressStateId');
  if (step === 5) {
    if (!Object.values(passwordChecks(value.password)).every(Boolean)) errors.password = messages.passwordInvalid;
    if (value.password !== value.confirmPassword) errors.confirmPassword = messages.passwordMismatch;
  }
  return errors;
}

export function registrationPayload(form) {
  const value = normaliseOnboardingForm(form);
  return Object.fromEntries([
    ...NAME_FIELDS.map((field) => [field, value[field]]),
    ['phone', normalisePatientPhone(value.phone, value.phoneCountry)], ['email', value.email], ['dateOfBirth', value.dateOfBirth],
    ['gender', value.gender], ['addressStateId', Number(value.addressStateId)], ['password', value.password]
  ]);
}

export function onboardingErrorMessage(error, messages) {
  if (error?.status === 429) return messages.rateLimited;
  const code = error?.code;
  if (code === 'EMAIL_ALREADY_REGISTERED') return messages.emailDuplicate;
  if (code === 'PHONE_ALREADY_REGISTERED') return messages.phoneDuplicate;
  if (/DUPLICATE|IDENTITY|MANUAL_REVIEW|AMBIGUOUS/.test(code || '')) return messages.manualReview;
  if (/VERIFICATION.*(EXPIRED|INVALID)/.test(code || '')) return messages.verificationFailed;
  return messages.requestFailed;
}
