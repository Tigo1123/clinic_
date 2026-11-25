import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getUserNotifications,
  markNotificationAsRead,
  notifyAppointmentBooked,
  notifyLabPricingRequired,
  notifyLabResultReadyToDoctor,
  notifyLabResultReleasedToPatient,
} from '../src/services/actionableNotifications.js';

function fixture() {
  const users = [
    { id: 'patient-user', role: 'PATIENT', status: 'ACTIVE', preferredLanguage: 'ar' },
    { id: 'doctor-user', role: 'DOCTOR', status: 'ACTIVE', preferredLanguage: 'en' },
    { id: 'other-doctor', role: 'DOCTOR', status: 'ACTIVE', preferredLanguage: 'en' },
    { id: 'reception-user', role: 'RECEPTIONIST', status: 'ACTIVE', preferredLanguage: 'en' },
    { id: 'admin-user', role: 'ADMIN', status: 'ACTIVE', preferredLanguage: 'ar' },
    { id: 'inactive-admin', role: 'ADMIN', status: 'INACTIVE', preferredLanguage: 'en' },
  ];
  const rows = [];
  const events = [];
  const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
  const db = {
    user: {
      findMany: async ({ where }) => users.filter((user) => where.role.in.includes(user.role) && user.status === where.status),
      findUnique: async ({ where }) => users.find((user) => matches(user, where)),
    },
    patient: { findUnique: async () => ({ userId: users[0].id, user: users[0] }) },
    doctor: { findUnique: async () => ({ fullNameAr: 'طبيب العيادة', fullNameEn: 'Clinic doctor', user: users[1] }) },
    labOrder: { findUnique: async () => ({ doctorId: 'doctor', patientId: 'patient', medicalRecord: { appointmentId: 'appointment' } }) },
    notification: {
      create: async ({ data }) => {
        if (data.dedupeKey && rows.some((row) => row.userId === data.userId && row.dedupeKey === data.dedupeKey)) {
          throw Object.assign(new Error('duplicate'), { code: 'P2002' });
        }
        const row = { ...data, id: String(rows.length + 1), createdAt: new Date() };
        rows.push(row);
        return row;
      },
      findMany: async ({ where }) => rows.filter((row) => matches(row, where)),
      findFirst: async ({ where }) => rows.find((row) => matches(row, where)),
      count: async ({ where }) => rows.filter((row) => matches(row, where)).length,
      update: async ({ where, data }) => Object.assign(rows.find((row) => matches(row, where)), data),
    },
  };
  const emit = (userId, notification) => {
    assert.ok(rows.some((row) => row.id === notification.id && row.userId === userId));
    events.push({ userId, notification });
  };
  return { db, emit, events };
}

test('booking persists once for each authorized account, with both locales and private delivery', async () => {
  const { db, emit, events } = fixture();
  const input = {
    appointment: {
      id: 'appointment', patientId: 'patient', doctorId: 'doctor',
      appointmentDate: '2026-11-25', appointmentTime: '10:00',
    },
  };
  await notifyAppointmentBooked(db, emit, input);
  await notifyAppointmentBooked(db, emit, input);

  assert.deepEqual(events.map(({ userId }) => userId).sort(), ['admin-user', 'patient-user', 'reception-user']);
  const { notifications, unreadCount } = await getUserNotifications(db, 'patient-user');
  assert.equal(unreadCount, 1);
  const [item] = notifications;
  assert.equal(item.title, item.titleAr);
  assert.equal(item.titleEn, 'Appointment Request Received');
  assert.equal(item.targetId, input.appointment.id);
  assert.equal(item.payload.patientId, undefined);

  assert.equal(await markNotificationAsRead(db, item.id, 'other-doctor'), null);
  await markNotificationAsRead(db, item.id, 'patient-user');
  await notifyAppointmentBooked(db, emit, input);
  assert.equal((await getUserNotifications(db, 'patient-user')).unreadCount, 0);
  assert.equal(events.length, 3);
});

test('lab readiness and release go to the assigned doctor and patient respectively, and admins open pricing only', async () => {
  const { db, emit, events } = fixture();
  await notifyLabResultReadyToDoctor(db, emit, { labOrderId: 'lab-order' });
  assert.equal(events.length, 1);
  assert.equal(events[0].userId, 'doctor-user');
  assert.equal(events[0].notification.payload.releasedToPatient, false);

  await notifyLabResultReleasedToPatient(db, emit, { labOrderId: 'lab-order' });
  assert.equal(events[1].userId, 'patient-user');
  assert.equal(events[1].notification.payload.releasedToPatient, true);

  await notifyLabPricingRequired(db, emit, { labOrderId: 'lab-order', serviceId: 'service' });
  assert.equal(events[2].userId, 'admin-user');
  assert.equal(events[2].notification.targetType, 'servicePricing');
  assert.equal(events[2].notification.targetId, 'service');
  assert.equal(events[2].notification.payload, null);
});
