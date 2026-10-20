import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtmlText, getFacilityBranding, SHIFA_PRODUCT_IDENTITY } from '../src/utils/facilityBranding.js';
import { sendBookingConfirmation, sendStatusUpdateNotification } from '../src/utils/notifications.js';

test('facility branding defaults to the Shifa product identity and falls back per language', () => {
  const defaults = getFacilityBranding({});
  assert.equal(defaults.displayNameAr, 'شفاء');
  assert.equal(defaults.displayNameEn, 'Shifa');
  assert.equal(defaults.facilityNameAr, null);
  assert.equal(defaults.facilityNameEn, null);
  assert.equal(getFacilityBranding({ FACILITY_NAME_AR: 'مرفق تجريبي' }).displayNameEn, 'Shifa');
  assert.deepEqual(SHIFA_PRODUCT_IDENTITY, {
    nameAr: 'شفاء', nameEn: 'Shifa',
    descriptorAr: 'نظام إدارة المنشآت الصحية', descriptorEn: 'Healthcare Facility Management System'
  });
});

test('configured facility names are normalized, bounded, and HTML escaped as text', () => {
  const branding = getFacilityBranding({ FACILITY_NAME_AR: ' مركز & <رعاية> ', FACILITY_NAME_EN: 'Care & <Partners>' });
  assert.equal(branding.displayNameAr, 'مركز & <رعاية>');
  assert.equal(branding.displayNameEn, 'Care & <Partners>');
  assert.equal(escapeHtmlText(branding.displayNameEn), 'Care &amp; &lt;Partners&gt;');
  assert.throws(() => getFacilityBranding({ FACILITY_NAME_EN: 'x'.repeat(121) }), /FACILITY_NAME_EN/);
  assert.throws(() => getFacilityBranding({ FACILITY_NAME_AR: 'Name\nHeader' }), /FACILITY_NAME_AR/);
});

test('booking and status notification text uses the configured facility identity', async () => {
  const previous = {
    FACILITY_NAME_AR: process.env.FACILITY_NAME_AR,
    FACILITY_NAME_EN: process.env.FACILITY_NAME_EN,
    NOTIFICATIONS_DISABLED: process.env.NOTIFICATIONS_DISABLED
  };
  process.env.FACILITY_NAME_AR = 'مركز الاختبار';
  process.env.FACILITY_NAME_EN = 'Test Facility';
  process.env.NOTIFICATIONS_DISABLED = 'true';
  try {
    const appointment = {
      id: '12345678-1234-1234-1234-123456789012', patientId: 'patient-id',
      patient: { phone: '+249912345678', fullNameAr: 'مريض', fullNameEn: 'Patient' },
      doctor: { fullNameAr: 'طبيب', fullNameEn: 'Doctor' }, appointmentDate: '2030-01-01', appointmentTime: '09:00'
    };
    const booking = await sendBookingConfirmation(appointment);
    const status = await sendStatusUpdateNotification(appointment, 'CONFIRMED');
    assert.match(booking.smsTextAr, /^مركز الاختبار:/);
    assert.match(booking.smsTextEn, /^Test Facility:/);
    assert.match(decodeURIComponent(booking.whatsAppLinkEn), /Test Facility/);
    assert.match(status.messageAr, /^مركز الاختبار:/);
    assert.match(status.messageEn, /^Test Facility:/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
