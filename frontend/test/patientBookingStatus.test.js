import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasPendingAppointments, localizedAppointmentStatus } from '../src/utils/appointmentStatus.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (relative) => readFileSync(path.join(root, relative), 'utf8');

test('booking success clearly describes pending receptionist review', () => {
  const page = source('src/features/patient-dashboard/PatientPages.jsx');
  const i18n = source('src/i18n.js');
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
  const page = source('src/features/patient-dashboard/PatientPages.jsx');
  assert.match(page, /hasPending&&<aside/);
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
  const page = source('src/features/patient-dashboard/PatientPages.jsx');
  assert.match(page, /pollInterval=45000/);
  assert.match(page, /if\(pollWhen\?\.\(data\)\)pollTimer=setTimeout/);
  assert.match(page, /clearTimeout\(pollTimer\)/);
  assert.match(page, /pollWhen:hasPendingAppointments/);
});

test('patient appointment queries remain authenticated and patient-scoped', () => {
  const backend = source('../backend/src/routes/patient.js');
  assert.match(backend, /const where = \{ patientId: req\.patient\.id \}/);
  assert.match(backend, /where: \{ id: req\.params\.id, patientId: req\.patient\.id \}/);
  assert.match(backend, /data: \{ patientId: req\.patient\.id, \.\.\.req\.body, status: 'PENDING' \}/);
});
