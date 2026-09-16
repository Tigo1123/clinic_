import test from 'node:test';
import assert from 'node:assert/strict';
import i18n from '../src/i18n.js';
import { readFileSync } from 'node:fs';
import { INITIAL_ONBOARDING_FORM, NAME_FIELDS, normaliseOnboardingForm, ONBOARDING_STEPS, onboardingErrorMessage, registrationPayload, RESEND_COOLDOWN_SECONDS, resendSecondsRemaining, validateOnboardingStep } from '../src/features/patient-auth/onboarding.js';
import { DEFAULT_PHONE_COUNTRY, normalisePatientPhone, PATIENT_PHONE_COUNTRIES, splitInternationalPhone } from '../src/features/patient-auth/phoneCountries.js';

const messages = { required:'required', nameInvalid:'name', dateInvalid:'dob', phoneInvalid:'phone', emailInvalid:'email', passwordInvalid:'password', passwordMismatch:'mismatch', rateLimited:'rate', addressStateInvalid:'state invalid', emailDuplicate:'email duplicate', phoneDuplicate:'phone duplicate', manualReview:'review', verificationFailed:'verify', requestFailed:'failed' };
const complete = { ...INITIAL_ONBOARDING_FORM, firstNameAr:'محمد', fatherNameAr:'أحمد', grandfatherNameAr:'علي', familyNameAr:'النور', firstNameEn:'José', fatherNameEn:'Ahmed', grandfatherNameEn:'Ali', familyNameEn:"O’Neill", dateOfBirth:'1990-01-02', gender:'MALE', phone:'+250788123456', email:'patient@example.test', password:'SecurePass1', confirmPassword:'SecurePass1' };

test('onboarding defines seven steps and all required bilingual name fields', () => {
  assert.equal(ONBOARDING_STEPS.length, 7);
  assert.equal(NAME_FIELDS.length, 8);
  for (let step = 0; step < 2; step += 1) assert.equal(Object.keys(validateOnboardingStep(INITIAL_ONBOARDING_FORM, step, messages)).length, 4);
});

test('Arabic and English onboarding labels are localized and the form preserves Unicode values', async () => {
  await i18n.changeLanguage('ar'); assert.equal(i18n.t('onboardingFirstNameAr'), 'الاسم الأول');
  await i18n.changeLanguage('en'); assert.equal(i18n.t('onboardingFirstNameEn'), 'First Name');
  assert.equal(registrationPayload(complete).firstNameEn, 'José');
});

test('country-aware phone validation accepts supported African and Arab numbers and rejects invalid ones', () => {
  assert.equal(DEFAULT_PHONE_COUNTRY, 'SD');
  assert.ok(PATIENT_PHONE_COUNTRIES.includes('SD'));
  assert.ok(PATIENT_PHONE_COUNTRIES.includes('RW'));
  assert.ok(PATIENT_PHONE_COUNTRIES.includes('SA'));
  assert.equal(new Set(PATIENT_PHONE_COUNTRIES).size, PATIENT_PHONE_COUNTRIES.length);
  assert.equal(normalisePatientPhone('912345678', 'SD'), '+249912345678');
  assert.equal(normalisePatientPhone('788123456', 'RW'), '+250788123456');
  assert.equal(normalisePatientPhone('501234567', 'SA'), '+966501234567');
  assert.equal(normalisePatientPhone('not-a-phone', 'SD'), null);
  assert.equal(validateOnboardingStep({ ...complete, phoneCountry:'SD', phone:'123' }, 3, messages).phone, 'phone');
});

test('a selected country stays in onboarding form state across step and language changes', () => {
  const selected = normaliseOnboardingForm({ ...complete, phoneCountry:'SA', phone:' 501234567 ' });
  assert.equal(selected.phoneCountry, 'SA');
  assert.equal(selected.phone, '501234567');
  assert.equal(registrationPayload(selected).phone, '+966501234567');
});

test('full E.164 pastes select the country and never duplicate its calling code', () => {
  assert.deepEqual(splitInternationalPhone('+249912345678', 'RW'), { country:'SD', phone:'912345678' });
  assert.equal(registrationPayload({ ...complete, phoneCountry:'SD', phone:'912345678' }).phone, '+249912345678');
  assert.equal(registrationPayload({ ...complete, phoneCountry:'SA', phone:'501234567' }).phone, '+966501234567');
});

test('DOB, password confirmation, and step state validate before submission', () => {
  assert.equal(validateOnboardingStep({ ...complete, dateOfBirth:'2026-02-30' }, 2, messages).dateOfBirth, 'dob');
  assert.equal(validateOnboardingStep({ ...complete, dateOfBirth:'0000-01-01' }, 2, messages).dateOfBirth, 'dob');
  assert.equal(validateOnboardingStep({ ...complete, phone:'700000000' }, 3, messages).phone, 'phone');
  assert.equal(validateOnboardingStep({ ...complete, confirmPassword:'other' }, 5, messages).confirmPassword, 'mismatch');
});

test('registration payload is allowlisted and cannot inject MRN or client identity fields', () => {
  const payload = registrationPayload({ ...complete, phoneCountry:'SA', phone:'501234567', fileNumber:'SHF-999', userId:'secret', role:'ADMIN', patientId:'x' });
  assert.deepEqual(Object.keys(payload).sort(), [...NAME_FIELDS, 'addressStateId', 'dateOfBirth', 'email', 'gender', 'password', 'phone'].sort());
  assert.equal(payload.phone, '+966501234567');
  assert.equal(payload.fileNumber, undefined); assert.equal(payload.userId, undefined); assert.equal(payload.phoneCountry, undefined);
});

test('safe localized errors cover duplicate identities, verification, rate limiting, and server failures', () => {
  assert.equal(onboardingErrorMessage({ code:'INVALID_ADDRESS_STATE' }, messages), 'state invalid');
  assert.equal(onboardingErrorMessage({ code:'EMAIL_ALREADY_REGISTERED' }, messages), 'email duplicate');
  assert.equal(onboardingErrorMessage({ code:'PHONE_ALREADY_REGISTERED' }, messages), 'phone duplicate');
  assert.equal(onboardingErrorMessage({ code:'VERIFICATION_CODE_EXPIRED' }, messages), 'verify');
  assert.equal(onboardingErrorMessage({ status:429 }, messages), 'rate');
  assert.equal(onboardingErrorMessage({ message:'raw database error' }, messages), 'failed');
});

test('OTP resend cooldown is deterministic and localized in both languages', async () => {
  assert.equal(RESEND_COOLDOWN_SECONDS, 60);
  assert.equal(resendSecondsRemaining(160_000, 100_001), 60);
  assert.equal(resendSecondsRemaining(160_000, 160_000), 0);
  await i18n.changeLanguage('ar'); assert.match(i18n.t('onboardingResendAvailableIn', { seconds:47 }), /47/);
  await i18n.changeLanguage('en'); assert.equal(i18n.t('onboardingResendAvailableIn', { seconds:47 }), 'Resend available in 47s');
});

test('registration page renders the stepper, keeps RTL/LTR inputs explicit, and continues verified patients safely', () => {
  const page = readFileSync(new URL('../src/features/patient-auth/PatientAuthPages.jsx', import.meta.url), 'utf8');
  assert.match(page, /onboarding-progress/);
  assert.match(page, /dir=\{step === 0 \? 'rtl' : 'ltr'\}/);
  assert.match(page, /patient-phone-control/);
  assert.match(page, /splitInternationalPhone/);
  assert.match(page, /inputMode="tel" dir="ltr"/);
  assert.match(page, /continueToDashboard/);
  assert.match(page, /identity\?\.fileNumber/);
  assert.match(page, /onboarding-step-summary/);
  assert.match(page, /onboarding-resend/);
  assert.match(page, /verification\/resend/);
  assert.match(page, /inputMode="numeric" maxLength=\{6\} dir="ltr"/);
  assert.match(page, /patient-auth-doctor-v2\.webp/);
  assert.match(page, /patient-auth-hero-copy/);
  assert.match(page, /alreadyHaveAccount/);
  assert.match(page, /to="\/patient-login"/);
  assert.match(page, /dontHaveAccount/);
  assert.match(page, /to="\/register"/);
  assert.match(i18n.t('alreadyHaveAccount'), /حساب|account/i);
  assert.match(i18n.t('signIn'), /تسجيل الدخول|Sign in/);
});
