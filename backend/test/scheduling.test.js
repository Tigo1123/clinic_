import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../src/db.js';
import { getConfiguredSlots, getAvailableSlots } from '../src/utils/scheduling.js';
import { DateTime } from 'luxon';
import request from 'supertest';
import { app } from '../src/server.js';

let doctor;
const ids = [];
const monday = '2035-09-17';
const sunday = '2035-09-16';

before(async () => {
  doctor = await prisma.doctor.findFirst({ where: { status: 'ACTIVE' } });
  if (!(await prisma.patient.count())) await prisma.patient.create({ data: { fullNameAr: 'اختبار الجدولة', fullNameEn: 'Scheduling Test', gender: 'MALE', dateOfBirth: '1990-01-01', phone: '+250788000001', addressStateId: 1, emergencyContact: 'Test' } });
  await prisma.doctorSchedule.deleteMany({ where: { doctorId: doctor.id } });
});

after(async () => {
  await prisma.doctorSchedule.deleteMany({ where: { doctorId: doctor.id } });
  await prisma.$disconnect();
});

async function schedule(periods, { effectiveFrom = '2035-01-01', effectiveTo = null, active = true } = {}) {
  const row = await prisma.doctorSchedule.create({ data: {
    doctorId: doctor.id, effectiveFrom, effectiveTo, active,
    periods: { create: periods.map((p) => ({ dayOfWeek: p.dayOfWeek || 'MONDAY', startTime: p.startTime, endTime: p.endTime, slotDurationMinutes: p.slotDurationMinutes, breaks: p.breaks ? { create: p.breaks } : undefined })) }
  } });
  ids.push(row.id);
  return row;
}

test('normalized recurring periods generate bounded slots and multiple periods independently', async () => {
  await schedule([
    { startTime: '09:00', endTime: '11:00', slotDurationMinutes: 30 },
    { startTime: '14:00', endTime: '15:00', slotDurationMinutes: 20 }
  ]);
  assert.deepEqual(await getConfiguredSlots(doctor, monday, DateTime.fromISO('2035-09-16T08:00', { zone: 'Africa/Khartoum' })), ['09:00', '09:30', '10:00', '10:30', '14:00', '14:20', '14:40']);
  assert.deepEqual(await getConfiguredSlots(doctor, sunday, DateTime.fromISO('2035-09-16T08:00', { zone: 'Africa/Khartoum' })), []);
});

test('slot intervals must fit completely inside a period', async () => {
  await prisma.doctorSchedule.deleteMany({ where: { doctorId: doctor.id } });
  await schedule([{ startTime: '09:00', endTime: '10:10', slotDurationMinutes: 30 }]);
  assert.deepEqual(await getConfiguredSlots(doctor, monday, DateTime.fromISO('2035-09-16T08:00', { zone: 'Africa/Khartoum' })), ['09:00', '09:30']);
});

test('break overlap removes every intersecting slot while inactive breaks do not', async () => {
  await prisma.doctorSchedule.deleteMany({ where: { doctorId: doctor.id } });
  await schedule([{ startTime: '09:00', endTime: '12:00', slotDurationMinutes: 30, breaks: [{ startTime: '10:15', endTime: '10:45', active: true }, { startTime: '09:30', endTime: '10:00', active: false }] }]);
  assert.deepEqual(await getConfiguredSlots(doctor, monday, DateTime.fromISO('2035-09-16T08:00', { zone: 'Africa/Khartoum' })), ['09:00', '09:30', '11:00', '11:30']);
});

test('full-day leave and special hours override recurring availability', async () => {
  await prisma.doctorSchedule.deleteMany({ where: { doctorId: doctor.id } });
  await schedule([{ startTime: '09:00', endTime: '17:00', slotDurationMinutes: 30 }]);
  await prisma.doctorScheduleException.create({ data: { doctorId: doctor.id, date: monday, type: 'FULL_DAY_LEAVE' } });
  assert.deepEqual(await getConfiguredSlots(doctor, monday), []);
  await prisma.doctorScheduleException.deleteMany({ where: { doctorId: doctor.id } });
  await prisma.doctorScheduleException.create({ data: { doctorId: doctor.id, date: monday, type: 'SPECIAL_HOURS', periods: { create: [{ startTime: '12:00', endTime: '13:00', slotDurationMinutes: 20 }, { startTime: '14:00', endTime: '15:00', slotDurationMinutes: 30 }] } } });
  assert.deepEqual(await getConfiguredSlots(doctor, monday, DateTime.fromISO('2035-09-16T08:00', { zone: 'Africa/Khartoum' })), ['12:00', '12:20', '12:40', '14:00', '14:30']);
});

test('normalized presence disables legacy fallback and overlapping versions fail closed', async () => {
  await prisma.doctorScheduleException.deleteMany({ where: { doctorId: doctor.id } });
  await prisma.doctorSchedule.deleteMany({ where: { doctorId: doctor.id } });
  const legacy = await getConfiguredSlots(doctor, monday, DateTime.fromISO('2035-09-16T08:00', { zone: 'Africa/Khartoum' }));
  assert.ok(legacy.length > 0);
  await schedule([]);
  assert.deepEqual(await getConfiguredSlots(doctor, monday, DateTime.fromISO('2035-09-16T08:00', { zone: 'Africa/Khartoum' })), []);
  await schedule([{ startTime: '09:00', endTime: '10:00', slotDurationMinutes: 30 }]);
  assert.deepEqual(await getConfiguredSlots(doctor, monday, DateTime.fromISO('2035-09-16T08:00', { zone: 'Africa/Khartoum' })), []);
});

test('occupied status policy blocks active states and releases cancelled/no-show', async () => {
  await prisma.doctorSchedule.deleteMany({ where: { doctorId: doctor.id } });
  await schedule([{ startTime: '09:00', endTime: '10:00', slotDurationMinutes: 30 }]);
  const patient = await prisma.patient.findFirst();
  for (const status of ['PENDING', 'SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION', 'WAITING_LAB', 'COMPLETED']) {
    const appointment = await prisma.appointment.create({ data: { doctorId: doctor.id, patientId: patient.id, appointmentDate: monday, appointmentTime: '09:00', status } });
    assert.deepEqual(await getAvailableSlots(doctor, monday, DateTime.fromISO('2035-09-16T08:00', { zone: 'Africa/Khartoum' })), ['09:30']);
    await prisma.appointment.delete({ where: { id: appointment.id } });
  }
  for (const status of ['CANCELLED', 'NO_SHOW']) await prisma.appointment.create({ data: { doctorId: doctor.id, patientId: patient.id, appointmentDate: monday, appointmentTime: '09:00', status } });
  assert.deepEqual(await getAvailableSlots(doctor, monday, DateTime.fromISO('2035-09-16T08:00', { zone: 'Africa/Khartoum' })), ['09:00', '09:30']);
});

test('effective schedule boundaries select the applicable version and future/expired versions do not apply', async () => {
  await prisma.doctorSchedule.deleteMany({ where: { doctorId: doctor.id } });
  await schedule([{ dayOfWeek: 'SUNDAY', startTime: '08:00', endTime: '09:00', slotDurationMinutes: 30 }], { effectiveFrom: '2035-01-01', effectiveTo: '2035-09-16' });
  await schedule([{ startTime: '14:00', endTime: '15:00', slotDurationMinutes: 30 }], { effectiveFrom: '2035-09-17' });
  const now = DateTime.fromISO('2034-01-01T08:00', { zone: 'Africa/Khartoum' });
  assert.deepEqual(await getConfiguredSlots(doctor, '2035-09-16', now), ['08:00', '08:30']);
  assert.deepEqual(await getConfiguredSlots(doctor, monday, now), ['14:00', '14:30']);
  assert.deepEqual(await getConfiguredSlots(doctor, '2034-12-31', now), []);
  await prisma.doctorSchedule.create({ data: { doctorId: doctor.id, effectiveFrom: '2035-09-10', active: true, periods: { create: [{ dayOfWeek: 'MONDAY', startTime: '16:00', endTime: '17:00', slotDurationMinutes: 30 }] } } });
  assert.deepEqual(await getConfiguredSlots(doctor, monday, now), []);
});

test('legacy parser fails closed for malformed, duplicate, invalid, and zero-duration data', async () => {
  await prisma.doctorSchedule.deleteMany({ where: { doctorId: doctor.id } });
  const original = doctor.weeklySchedule;
  try {
    await prisma.doctor.update({ where: { id: doctor.id }, data: { weeklySchedule: '[broken' } }); doctor.weeklySchedule = '[broken';
    assert.deepEqual(await getConfiguredSlots(doctor, monday, DateTime.fromISO('2035-09-16T08:00', { zone: 'Africa/Khartoum' })), []);
    doctor.weeklySchedule = JSON.stringify([{ day: 'Monday', startTime: '09:00', endTime: '10:00', slotDurationInMinutes: 30 }, { day: 'Monday', startTime: '11:00', endTime: '12:00', slotDurationInMinutes: 30 }]); await prisma.doctor.update({ where: { id: doctor.id }, data: { weeklySchedule: doctor.weeklySchedule } });
    assert.deepEqual(await getConfiguredSlots(doctor, monday, DateTime.fromISO('2035-09-16T08:00', { zone: 'Africa/Khartoum' })), []);
    doctor.weeklySchedule = JSON.stringify([{ day: 'Monday', startTime: 'bad', endTime: '10:00', slotDurationInMinutes: 0 }]); await prisma.doctor.update({ where: { id: doctor.id }, data: { weeklySchedule: doctor.weeklySchedule } });
    assert.deepEqual(await getConfiguredSlots(doctor, monday, DateTime.fromISO('2035-09-16T08:00', { zone: 'Africa/Khartoum' })), []);
  } finally { await prisma.doctor.update({ where: { id: doctor.id }, data: { weeklySchedule: original } }); }
});

test('public timezone configuration exposes only the safe contract', async () => {
  const response = await request(app).get('/api/public-config');
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body), ['clinicTimeZone']);
  assert.equal(typeof response.body.clinicTimeZone, 'string');
  assert.equal(Object.hasOwn(response.body, 'DATABASE_URL'), false);
});

test('clinic timezone remains authoritative when process TZ changes', async () => {
  await prisma.doctorSchedule.deleteMany({ where: { doctorId: doctor.id } });
  await schedule([{ startTime: '09:00', endTime: '10:00', slotDurationMinutes: 30 }]);
  const instant = new Date('2035-09-15T21:00:00.000Z');
  const original = process.env.TZ;
  const results = [];
  try {
    for (const zone of ['UTC', 'America/New_York']) {
      process.env.TZ = zone;
      results.push(await getConfiguredSlots(doctor, monday, DateTime.fromJSDate(instant).setZone('Africa/Khartoum')));
    }
  } finally {
    if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
  }
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[0], ['09:00', '09:30']);
});

test('public scheduling responses never expose raw schedule records or parser diagnostics', async () => {
  const slots = await request(app).get('/api/appointments/slots').query({ doctorId: doctor.id, date: monday });
  assert.equal(slots.status, 200);
  const serialized = JSON.stringify(slots.body);
  for (const marker of ['weeklySchedule', 'DoctorSchedule', 'DoctorSchedulePeriod', 'DoctorScheduleBreak', 'DoctorScheduleException', 'effectiveFrom', 'effectiveTo', 'scheduling.invalid_configuration']) assert.equal(serialized.includes(marker), false);
  const config = await request(app).get('/api/public-config');
  assert.equal(JSON.stringify(config.body).includes('DoctorSchedule'), false);
});
