import test from 'node:test';
import assert from 'node:assert/strict';
import i18n from '../src/i18n.js';
import { readFileSync } from 'node:fs';
import { INITIAL_ONBOARDING_FORM, NAME_FIELDS, ONBOARDING_STEPS, onboardingErrorMessage, registrationPayload, validateOnboardingStep } from '../src/features/patient-auth/onboarding.js';

const messages = { required:'required', nameInvalid:'name', dateInvalid:'dob', phoneInvalid:'phone', emailInvalid:'email', passwordInvalid:'password', passwordMismatch:'mismatch', rateLimited:'rate', emailDuplicate:'email duplicate', phoneDuplicate:'phone duplicate', manualReview:'review', verificationFailed:'verify', requestFailed:'failed' };
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

test('DOB, Rwanda phone, password confirmation, and step state validate before submission', () => {
  assert.equal(validateOnboardingStep({ ...complete, dateOfBirth:'2026-02-30' }, 2, messages).dateOfBirth, 'dob');
  assert.equal(validateOnboardingStep({ ...complete, dateOfBirth:'0000-01-01' }, 2, messages).dateOfBirth, 'dob');
  assert.equal(validateOnboardingStep({ ...complete, phone:'+250700000000' }, 3, messages).phone, 'phone');
  assert.equal(validateOnboardingStep({ ...complete, confirmPassword:'other' }, 5, messages).confirmPassword, 'mismatch');
});

test('registration payload is allowlisted and cannot inject MRN or client identity fields', () => {
  const payload = registrationPayload({ ...complete, fileNumber:'SHF-999', userId:'secret', role:'ADMIN', patientId:'x' });
  assert.deepEqual(Object.keys(payload).sort(), [...NAME_FIELDS, 'addressStateId', 'dateOfBirth', 'email', 'gender', 'password', 'phone'].sort());
  assert.equal(payload.fileNumber, undefined); assert.equal(payload.userId, undefined);
});

test('safe localized errors cover duplicate identities, verification, rate limiting, and server failures', () => {
  assert.equal(onboardingErrorMessage({ code:'EMAIL_ALREADY_REGISTERED' }, messages), 'email duplicate');
  assert.equal(onboardingErrorMessage({ code:'PHONE_ALREADY_REGISTERED' }, messages), 'phone duplicate');
  assert.equal(onboardingErrorMessage({ code:'VERIFICATION_CODE_EXPIRED' }, messages), 'verify');
  assert.equal(onboardingErrorMessage({ status:429 }, messages), 'rate');
  assert.equal(onboardingErrorMessage({ message:'raw database error' }, messages), 'failed');
});

test('registration page renders the stepper, keeps RTL/LTR inputs explicit, and continues verified patients safely', () => {
  const page = readFileSync(new URL('../src/features/patient-auth/PatientAuthPages.jsx', import.meta.url), 'utf8');
  assert.match(page, /onboarding-progress/);
  assert.match(page, /dir=\{step === 0 \? 'rtl' : 'ltr'\}/);
  assert.match(page, /onboarding-grid" dir="ltr"/);
  assert.match(page, /continueToDashboard/);
  assert.match(page, /identity\?\.fileNumber/);
});
