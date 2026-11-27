import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import i18n from '../src/i18n.js';
import { patientErrorMessage } from '../src/services/patientErrors.js';
import { localizeDoctorSpecialty } from '../src/features/patient/portal/doctorSpecialty.js';

const bookPage = readFileSync(
  new URL('../src/features/patient/portal/pages/BookAppointment.jsx', import.meta.url),
  'utf8'
);
const bookStyles = readFileSync(
  new URL('../src/features/patient/portal/pages/BookAppointment.css', import.meta.url),
  'utf8'
);

test('Booking locale keys and doctor error messages work in Arabic and English and CSS supports RTL and mobile', async () => {
  await i18n.changeLanguage('en');
  assert.equal(i18n.t('sendBookingRequest'), 'Send booking request');
  assert.equal(i18n.t('specialty'), 'Specialty');
  assert.equal(i18n.t('consultationFee'), 'Consultation fee');
  assert.equal(i18n.t('appointmentTime'), 'Time');
  assert.equal(i18n.t('bookingStatus'), 'Status');
  assert.equal(
    patientErrorMessage({ code: 'DOCTOR_NOT_FOUND', status: 404 }, i18n.t('patientLoadError'), 'en'),
    'Doctor not found or not currently active.'
  );
  assert.equal(localizeDoctorSpecialty({ specialtyEn: 'Cardiology', specialtyAr: 'أمراض القلب' }, 'en'), 'Cardiology');

  await i18n.changeLanguage('ar');
  assert.equal(i18n.t('sendBookingRequest'), 'إرسال طلب الحجز');
  assert.equal(i18n.t('specialty'), 'التخصص');
  assert.equal(i18n.t('consultationFee'), 'رسوم الكشف');
  assert.equal(i18n.t('appointmentTime'), 'الوقت');
  assert.equal(i18n.t('bookingStatus'), 'الحالة');
  assert.equal(
    patientErrorMessage({ code: 'DOCTOR_NOT_FOUND', status: 404 }, i18n.t('patientLoadError'), 'ar'),
    'تعذر العثور على الطبيب أو الطبيب غير متاح حالياً.'
  );
  assert.equal(localizeDoctorSpecialty({ specialtyEn: 'Cardiology', specialtyAr: 'أمراض القلب' }, 'ar'), 'أمراض القلب');

  assert.match(bookPage, /dir=\{direction\}/);
  assert.match(bookPage, /<bdi dir="ltr"/);
  assert.match(bookStyles, /@media \(max-width: 480px\)/);
  assert.match(bookStyles, /inset-inline-end:/);
  assert.doesNotMatch(bookStyles, /\b(margin-left|margin-right|padding-left|padding-right)\b/);
});
