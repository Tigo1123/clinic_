import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasPendingAppointments, localizedAppointmentStatus } from '../src/utils/appointmentStatus.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (relative) => readFileSync(path.join(root, relative), 'utf8');
const patientPagesSource = () => readdirSync(path.join(root, 'src/features/patient/portal/pages')).filter((file) => file.endsWith('.jsx')).sort().map((file) => source(`src/features/patient/portal/pages/${file}`)).join('\n');

test('booking success clearly describes pending receptionist review', () => {
  const page = patientPagesSource();
  const i18n = ['src/i18n.js', 'src/locales/ar.js', 'src/locales/en.js'].map(source).join('\n');
  assert.match(page, /bookingRequestSent/);
  assert.match(page, /bookingPendingReview/);
  assert.match(page, /bookingFollowStatus/);
  assert.match(page, /to="\/patient\/appointments"/);
  assert.match(i18n, /تم إرسال طلب الحجز بنجاح/);
  assert.match(i18n, /قيد مراجعة موظف الاستقبال/);
  assert.match(i18n, /متابعة صفحة مواعيدي/);
  assert.doesNotMatch(i18n, /bookingRequestSent: '.*تم تأكيد/);
});

test('pending reminder derives only from existing appointment data', () => {
  assert.equal(hasPendingAppointments([{ status: 'PENDING' }]), true);
  assert.equal(hasPendingAppointments([{ status: 'CONFIRMED' }, { status: 'COMPLETED' }]), false);
  assert.equal(hasPendingAppointments([]), false);
  const page = patientPagesSource();
  assert.match(page, /hasPendingAppointments\(appointments\.data\)\s*&&\s*<aside/);
  assert.match(page, /appointmentPendingReminder/);
});

test('patient appointment statuses are understandable in Arabic and English', () => {
  assert.equal(localizedAppointmentStatus('PENDING', 'ar'), 'قيد المراجعة');
  assert.equal(localizedAppointmentStatus('CONFIRMED', 'ar'), 'تم التأكيد');
  assert.equal(localizedAppointmentStatus('CANCELLED', 'ar'), 'تم الإلغاء');
  assert.equal(localizedAppointmentStatus('CHECKED_IN', 'ar'), 'تم تسجيل الحضور');
  assert.equal(localizedAppointmentStatus('COMPLETED', 'ar'), 'مكتمل');
  assert.equal(localizedAppointmentStatus('CONFIRMED', 'en'), 'Confirmed');
});

test('bounded polling runs only while pending and is cancelled on unmount', () => {
  const page = patientPagesSource();
  assert.match(page, /pollInterval=45000/);
  assert.match(page, /if\(pollWhen\?\.\(data\)\)pollTimer=setTimeout/);
  assert.match(page, /clearTimeout\(pollTimer\)/);
  assert.match(page, /pollWhen:\s*hasPendingAppointments/);
});

test('patient appointment queries remain authenticated and patient-scoped', () => {
  const backend = source('../backend/src/routes/patient.js');
  assert.match(backend, /const where = \{ patientId: req\.patient\.id \}/);
  assert.match(backend, /where: \{ id: req\.params\.id, patientId: req\.patient\.id \}/);
  assert.match(backend, /data: \{ patientId: req\.patient\.id, \.\.\.req\.body, status: 'PENDING' \}/);
});
