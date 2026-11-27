import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import i18n from '../src/i18n.js';
import { PATIENT_BOOKING_PATH, patientDestination } from '../src/app/router/patientBooking.js';

const authPages = readFileSync(new URL('../src/features/patient/auth/PatientAuthPages.jsx', import.meta.url), 'utf8');
const authStyles = readFileSync(new URL('../src/features/patient/auth/patientAuth.css', import.meta.url), 'utf8');
const doctorsPage = readFileSync(new URL('../src/features/patient/portal/pages/Doctors.jsx', import.meta.url), 'utf8');
const portalStyles = readFileSync(new URL('../src/features/patient/portal/patient.css', import.meta.url), 'utf8');

test('patientDestination only allows the safe patient booking path and falls back to /patient', () => {
  assert.equal(PATIENT_BOOKING_PATH, '/patient/doctors');
  assert.equal(patientDestination({ afterSignIn: '/patient/doctors' }), '/patient/doctors');
  assert.equal(patientDestination(undefined), '/patient');
  assert.equal(patientDestination(null), '/patient');
  assert.equal(patientDestination({ afterSignIn: '/patient' }), '/patient');
  assert.equal(patientDestination({ afterSignIn: '/staff' }), '/patient');
  assert.equal(patientDestination({ afterSignIn: 'https://evil.example' }), '/patient');
  assert.equal(patientDestination({ afterSignIn: '//evil.example' }), '/patient');
});

test('booking sign-in locale keys exist in Arabic and English without altering generic login keys', async () => {
  await i18n.changeLanguage('en');
  assert.equal(i18n.t('patientLogin'), 'Patient Login');
  assert.equal(i18n.t('welcomeBack'), 'Welcome back');
  assert.equal(i18n.t('patientBookingLoginEyebrow'), 'Appointment booking');
  assert.equal(i18n.t('patientBookingLoginTitle'), 'Sign in to book an appointment');
  assert.match(i18n.t('patientBookingLoginIntro'), /choose a doctor|appointment/i);
  assert.equal(i18n.t('details'), 'Details');
  assert.equal(i18n.t('book'), 'Book');

  await i18n.changeLanguage('ar');
  assert.equal(i18n.t('patientLogin'), 'دخول المريض');
  assert.equal(i18n.t('welcomeBack'), 'مرحباً بعودتك');
  assert.equal(i18n.t('patientBookingLoginEyebrow'), 'حجز موعد');
  assert.equal(i18n.t('patientBookingLoginTitle'), 'سجّل الدخول لحجز موعد');
  assert.match(i18n.t('patientBookingLoginIntro'), /الطبيب|موعد/);
  assert.equal(i18n.t('details'), 'التفاصيل');
  assert.equal(i18n.t('book'), 'حجز');
});

test('PatientLogin switches heading and intro only when redirected from booking and preserves afterSignIn across login, register, Google, and password reset', () => {
  const loginStart = authPages.indexOf('export function PatientLogin');
  const loginEnd = authPages.indexOf('export function PatientForgotPassword');
  const login = authPages.slice(loginStart, loginEnd);
  const forgotStart = loginEnd;
  const forgotEnd = authPages.indexOf('export function PatientRegister');
  const forgot = authPages.slice(forgotStart, forgotEnd);
  const registerStart = forgotEnd;
  const registerEnd = authPages.indexOf('export function PatientClaim');
  const register = authPages.slice(registerStart, registerEnd);
  const shell = authPages.slice(authPages.indexOf('function AuthShell'));

  assert.match(login, /const isBookingEntry = destination === PATIENT_BOOKING_PATH;/);
  assert.match(login, /isBookingEntry \? t\('patientBookingLoginTitle'\) : t\('patientLogin'\)/);
  assert.match(login, /isBookingEntry \? t\('patientBookingLoginEyebrow'\) : undefined/);
  assert.match(login, /isBookingEntry \? t\('patientBookingLoginIntro'\) : undefined/);
  assert.match(login, /navigate\(destination\)/);
  assert.match(login, /navigate\('\/register', \{ state: \{ afterSignIn: destination, googleOnboarding: true \} \}\)/);
  assert.match(login, /to="\/register" state=\{\{ afterSignIn: destination \}\}/);
  assert.match(login, /to="\/forgot-password" state=\{isBookingEntry \? \{ afterSignIn: destination \} : undefined\}/);

  assert.match(forgot, /const destination = patientDestination\(location\.state\);/);
  assert.match(forgot, /to="\/patient-login" state=\{bookingState\}/);
  assert.match(forgot, /\.\.\.\(bookingState \|\| \{\}\)/);

  assert.match(register, /const destination = patientDestination\(location\.state\);/);
  assert.match(register, /navigate\(destination\)/);
  assert.match(register, /afterSignIn: destination, googleOnboarding: true/);
  assert.match(register, /to="\/patient-login" state=\{\{ afterSignIn: destination \}\}/);

  assert.match(shell, /const isLogin = !isRegistration && \(login \|\| title === t\('patientLogin'\)\);/);
  assert.match(shell, /eyebrow \|\| t\('welcomeBack'\)/);
  assert.match(shell, /subtitle \|\| \(language === 'ar'/);
  assert.match(authStyles, /\.patient-auth-login-intro__copy\s*\{\s*min-width:\s*0;\s*\}/);
  assert.match(authStyles, /\[dir="rtl"\] \.patient-auth-shell--login \.patient-auth-welcome/);
});

test('Doctors directory renders visible accessible bilingual Book alongside Details with small mobile and RTL support', () => {
  assert.match(doctorsPage, /dir=\{language === 'ar' \? 'rtl' : 'ltr'\}/);
  assert.match(doctorsPage, /to=\{`\/patient\/doctors\/\$\{doctor\.id\}`\}/);
  assert.match(doctorsPage, /aria-label=\{`\$\{t\('details'\)\} \$\{name\}`\}/);
  assert.match(doctorsPage, /to=\{`\/patient\/book\/\$\{doctor\.id\}`\}/);
  assert.match(doctorsPage, /aria-label=\{`\$\{t\('book'\)\} \$\{name\}`\}/);
  assert.match(doctorsPage, /<span>\{t\('book'\)\}<\/span>/);
  assert.match(doctorsPage, /className="patient-button patient-doctors__book-btn"/);
  assert.match(doctorsPage, /className="patient-row-link__arrow"/);

  assert.match(portalStyles, /\.patient-doctors__details-btn,\s*\.patient-doctors__book-btn\s*\{[^}]*min-height:\s*44px;/s);
  assert.match(portalStyles, /\.patient-doctors__book-btn \.patient-row-link__arrow\s*\{\s*color:\s*currentColor;\s*\}/);
  assert.match(portalStyles, /\[dir=rtl\] \.patient-row-link__arrow\s*\{\s*transform:\s*rotate\(180deg\);\s*\}/);
  assert.match(portalStyles, /@media \(max-width: 520px\)[\s\S]*?\.patient-doctors__row\s*\{[^}]*flex-direction:\s*column;/);
  assert.match(portalStyles, /@media \(max-width: 520px\)[\s\S]*?\.patient-doctors__actions\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
});
