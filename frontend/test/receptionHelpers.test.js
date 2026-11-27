import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatQueueDateLabel,
  formatQueueEmptyMessage,
  formatReceptionDoctorName
} from '../src/features/staff/reception/receptionHelpers.js';

test('formatReceptionDoctorName avoids duplicating an existing English or Arabic title', () => {
  const workflowDoctor = {
    fullNameEn: 'Dr. QA Workflow',
    fullNameAr: 'د. اختبار سير العمل'
  };
  assert.equal(formatReceptionDoctorName(workflowDoctor, 'en'), 'Dr. QA Workflow');
  assert.equal(formatReceptionDoctorName(workflowDoctor, 'ar'), 'د. اختبار سير العمل');

  assert.equal(formatReceptionDoctorName({ fullNameEn: 'dr. Sara Ali', fullNameAr: 'د/ سارة علي' }, 'en'), 'dr. Sara Ali');
  assert.equal(formatReceptionDoctorName({ fullNameEn: 'Dr Sara Ali', fullNameAr: 'دكتورة سارة علي' }, 'en'), 'Dr Sara Ali');
  assert.equal(formatReceptionDoctorName({ fullNameEn: 'Dr Sara Ali', fullNameAr: 'دكتورة سارة علي' }, 'ar'), 'دكتورة سارة علي');
  assert.equal(formatReceptionDoctorName({ fullNameEn: 'Dr Sara Ali', fullNameAr: 'د أحمد' }, 'ar'), 'د أحمد');
});

test('formatReceptionDoctorName adds localized title when missing and does not treat Dr/د name starts as titles', () => {
  assert.equal(formatReceptionDoctorName({ fullNameEn: 'Drew Parker', fullNameAr: 'داود علي' }, 'en'), 'Dr. Drew Parker');
  assert.equal(formatReceptionDoctorName({ fullNameEn: 'Drew Parker', fullNameAr: 'داود علي' }, 'ar'), 'د. داود علي');
  assert.equal(formatReceptionDoctorName({ fullNameEn: '', fullNameAr: 'دعاء محمد' }, 'ar'), 'د. دعاء محمد');
  assert.equal(formatReceptionDoctorName({ fullNameEn: '', fullNameAr: 'د. سارة' }, 'en'), 'د. سارة');
  assert.equal(formatReceptionDoctorName(null, 'en'), '—');
  assert.equal(formatReceptionDoctorName({}, 'ar'), '—');
});

test('formatQueueEmptyMessage names the selected doctor alongside the queue date in English and Arabic', () => {
  const doctor = { fullNameEn: 'Dr. QA Workflow', fullNameAr: 'د. اختبار سير العمل' };
  const dateEn = formatQueueDateLabel('2026-11-27', 'en', '2026-11-27');
  const dateAr = formatQueueDateLabel('2026-11-27', 'ar', '2026-11-27');

  const emptyEn = formatQueueEmptyMessage(doctor, dateEn, 'en');
  assert.equal(emptyEn, `No appointments scheduled for Dr. QA Workflow on ${dateEn}.`);
  assert.equal(emptyEn.includes('Dr. Dr.'), false);

  const emptyAr = formatQueueEmptyMessage(doctor, dateAr, 'ar');
  assert.equal(emptyAr, `لا توجد مواعيد مجدولة مع د. اختبار سير العمل في ${dateAr}.`);
  assert.equal(emptyAr.includes('د. د.'), false);

  const plainDoctor = { fullNameEn: 'Amina Hassan', fullNameAr: 'أمينة حسن' };
  assert.equal(formatQueueEmptyMessage(plainDoctor, dateEn, 'en'), `No appointments scheduled for Dr. Amina Hassan on ${dateEn}.`);
  assert.equal(formatQueueEmptyMessage(plainDoctor, dateAr, 'ar'), `لا توجد مواعيد مجدولة مع د. أمينة حسن في ${dateAr}.`);

  assert.equal(formatQueueEmptyMessage({}, dateEn, 'en'), `No appointments scheduled for this doctor on ${dateEn}.`);
  assert.equal(formatQueueEmptyMessage({}, dateAr, 'ar'), `لا توجد مواعيد مجدولة لهذا الطبيب في ${dateAr}.`);
});
