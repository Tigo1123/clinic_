import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  NOTIFICATION_EVENTS,
  applyIncomingSocketNotification,
  applyMarkNotificationRead,
  formatNotificationPresentation,
  reconcileNotificationsSnapshot,
  resolveNotificationIntent,
} from '../src/features/notifications/notificationModel.js';

test('all event types use the server copy in the current locale, with a plain-text fallback', () => {
  for (const eventType of Object.values(NOTIFICATION_EVENTS)) {
    const item = {
      id: eventType, eventType, title: 'Fallback title', message: 'Fallback message',
      titleAr: 'عنوان من الخادم', messageAr: 'نص من الخادم',
      titleEn: 'Server title', messageEn: 'Server message',
    };
    const en = formatNotificationPresentation(item, 'en', 'PATIENT');
    const ar = formatNotificationPresentation(item, 'ar', 'PATIENT');
    assert.deepEqual([en.title, en.message], [item.titleEn, item.messageEn]);
    assert.deepEqual([ar.title, ar.message], [item.titleAr, item.messageAr]);
  }

  const legacy = formatNotificationPresentation({ id: 'legacy', title: 'Notice', message: 'Plain text' }, 'ar', 'PATIENT');
  assert.deepEqual([legacy.title, legacy.message, legacy.isLegacy, legacy.intent.kind], ['Notice', 'Plain text', true, 'mark_only']);
});

test('duplicate socket delivery and a stale reconnect snapshot preserve a read notification', () => {
  const received = { id: 'read-event', isRead: false };
  const incoming = applyIncomingSocketNotification({ notifications: [], unreadCount: 0 }, received);
  const read = applyMarkNotificationRead(incoming, received.id);
  assert.equal(applyIncomingSocketNotification(read, received).unreadCount, 0);
  const other = { id: 'new-event', isRead: false };
  const afterReconnect = reconcileNotificationsSnapshot({
    notifications: [received], unreadCount: 1,
  }, [other, received, other], read);
  assert.equal(afterReconnect.unreadCount, 1);
  assert.equal(afterReconnect.notifications.length, 2);
  assert.equal(afterReconnect.notifications.find((item) => item.id === received.id).isRead, true);
});

test('notification drill-downs require the recipient’s role and open an accessible destination', () => {
  const labOrder = {
    id: 'lab-sent', eventType: NOTIFICATION_EVENTS.LAB_ORDERED,
    targetType: 'labOrder', targetId: 'lab-order', payload: { appointmentId: 'visit' },
  };
  assert.equal(resolveNotificationIntent(labOrder, { role: 'PATIENT' }).route, '/patient/appointments/visit');
  assert.equal(resolveNotificationIntent(labOrder, { role: 'RECEPTIONIST' }).targetId, 'lab-order');
  assert.equal(resolveNotificationIntent(labOrder, { role: 'ADMIN' }).kind, 'restricted');

  const labResult = { ...labOrder, eventType: NOTIFICATION_EVENTS.LAB_RESULT_READY, payload: { appointmentId: 'visit', doctorId: 'assigned' } };
  assert.equal(resolveNotificationIntent(labResult, { role: 'PATIENT' }).kind, 'mark_only');
  assert.equal(resolveNotificationIntent(labResult, { role: 'DOCTOR', doctorId: 'other' }).kind, 'restricted');
  assert.equal(resolveNotificationIntent(labResult, { role: 'DOCTOR', doctorId: 'assigned' }).kind, 'drilldown');
  const released = { ...labResult, payload: { releasedToPatient: true } };
  assert.equal(resolveNotificationIntent(released, { role: 'PATIENT' }).route, '/patient/lab-results?orderId=lab-order');

  const pricing = {
    id: 'price-needed', eventType: NOTIFICATION_EVENTS.PHARMACY_PRICING_REQUIRED,
    targetType: 'medicinePricing', targetId: 'formulary-medicine',
  };
  assert.equal(resolveNotificationIntent(pricing, { role: 'ADMIN' }).targetId, 'formulary-medicine');
  assert.equal(resolveNotificationIntent(pricing, { role: 'PHARMACIST' }).kind, 'restricted');
});
