import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { DateTime, Settings } from 'luxon';
import prisma from '../src/db.js';
import { app } from '../src/server.js';
import { signAccessToken } from '../src/services/accessTokens.js';
import { getConfiguredSlots, getAvailableSlots } from '../src/utils/scheduling.js';
import { isolatedDatabaseUrl } from './helpers/testRunner.js';

const schema = new URL(process.env.DATABASE_URL).searchParams.get('schema');
assert.equal(isolatedDatabaseUrl(process.env.TEST_DATABASE_URL, schema, process.env.TEST_DATABASE_PORT), process.env.DATABASE_URL);
let adminToken; let patient; let patientToken;
const period = { dayOfWeek: 'MONDAY', startTime: '09:00', endTime: '11:00', slotDurationMinutes: 30, breaks: [] };
const base = { effectiveFrom: '2190-01-01', effectiveTo: null, active: true, periods: [period] };
const monday = '2190-01-04';
const auth = req => req.set('Authorization', `Bearer ${adminToken}`);
const create = (id, body) => auth(request(app).post(`/api/admin/doctors/${id}/schedules`)).send(body);
const edit = (id, scheduleId, body) => auth(request(app).put(`/api/admin/doctors/${id}/schedules/${scheduleId}`)).send(body);
async function doctor() {
  return prisma.doctor.create({ data: { fullNameAr: 'اختبار', fullNameEn: 'Schedule safety', specialtyAr: 'اختبار', specialtyEn: 'Test', consultationFee: 10, weeklySchedule: '[]', user: { create: { username: `schedule-${crypto.randomUUID()}`, passwordHash: 'unused', role: 'DOCTOR' } } } });
}
const booking = (doctorId, appointmentDate = monday, appointmentTime = '09:00') => request(app).post('/api/patient/appointments').set('Authorization', `Bearer ${patientToken}`).send({ doctorId, appointmentDate, appointmentTime });
before(async () => {
  adminToken = signAccessToken(await prisma.user.create({ data: { username: `admin-${crypto.randomUUID()}`, passwordHash: 'unused', role: 'ADMIN' } }));
  const user = await prisma.user.create({ data: { username: `patient-${crypto.randomUUID()}`, passwordHash: 'unused', role: 'PATIENT' } });
  const state = await prisma.state.findFirstOrThrow();
  patient = await prisma.patient.create({ data: { userId: user.id, fullNameAr: 'اختبار', fullNameEn: 'Schedule safety', gender: 'MALE', dateOfBirth: '1990-01-01', phone: '+250788000001', addressStateId: state.id, emergencyContact: 'Test' } });
  patientToken = signAccessToken(user);
});
after(async () => prisma.$disconnect());

test('recurring edits honor special hours instead of rejecting an unaffected exception booking', async () => {
  const d = await doctor(); const initial = await create(d.id, base); assert.equal(initial.status, 200);
  const exception = await auth(request(app).put(`/api/admin/doctors/${d.id}/schedule-exceptions/${monday}`)).send({ type: 'SPECIAL_HOURS', periods: [{ startTime: '14:00', endTime: '15:00', slotDurationMinutes: 30 }] });
  assert.equal(exception.status, 200); assert.equal((await booking(d.id, monday, '14:00')).status, 201);
  const response = await edit(d.id, initial.body.id, { ...base, periods: [{ ...period, endTime: '12:00' }] });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(await getAvailableSlots(d, monday), ['14:30']);
});

test('inactive overlapping drafts neither truncate current hours nor conflict with active versions', async () => {
  const d = await doctor(); const current = await create(d.id, { ...base, effectiveFrom: '2020-01-01' }); assert.equal(current.status, 200);
  const draft = await create(d.id, { ...base, active: false }); assert.equal(draft.status, 200, JSON.stringify(draft.body));
  assert.equal((await prisma.doctorSchedule.findUnique({ where: { id: current.body.id } })).effectiveTo, null);
  const updated = await edit(d.id, draft.body.id, { ...base, active: false, periods: [{ ...period, startTime: '10:00' }] });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.deepEqual(await getConfiguredSlots(d, monday), ['09:00', '09:30', '10:00', '10:30']);
});

for (const [name, patch] of [['shortened date range', { effectiveTo: '2190-01-03' }], ['moved start date', { effectiveFrom: '2190-01-05' }], ['inactive PUT', { active: false }]]) {
  test(`${name} cannot strand an existing future appointment`, async () => {
    const d = await doctor(); const initial = await create(d.id, base); assert.equal(initial.status, 200);
    assert.equal((await booking(d.id)).status, 201);
    const before = await prisma.doctorSchedule.findUnique({ where: { id: initial.body.id }, include: { periods: true } });
    const response = await edit(d.id, initial.body.id, { ...base, ...patch });
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal(response.body.error.code, 'SCHEDULE_FUTURE_APPOINTMENT_CONFLICT');
    assert.deepEqual(await prisma.doctorSchedule.findUnique({ where: { id: initial.body.id }, include: { periods: true } }), before);
  });
}

test('PUT cannot rewrite a schedule that has already started, even by moving it to a future date', async () => {
  const d = await doctor(); const initial = await create(d.id, { ...base, effectiveFrom: '2020-01-01' });
  const response = await edit(d.id, initial.body.id, base);
  assert.equal(response.status, 409); assert.equal(response.body.error.code, 'SCHEDULE_CURRENT_IMMUTABLE');
  assert.equal((await prisma.doctorSchedule.findUnique({ where: { id: initial.body.id } })).effectiveFrom, '2020-01-01');
});

test('a later replacement never extends a previously finite current schedule', async () => {
  const d = await doctor(); const end = DateTime.now().setZone('Africa/Khartoum').plus({ days: 2 }).toISODate();
  const current = await create(d.id, { ...base, effectiveFrom: '2020-01-01', effectiveTo: end }); assert.equal(current.status, 200);
  assert.equal((await create(d.id, base)).status, 200);
  assert.equal((await prisma.doctorSchedule.findUnique({ where: { id: current.body.id } })).effectiveTo, end);
});

for (const [name, periods] of [['empty', []], ['duration longer than period', [{ ...period, slotDurationMinutes: 121 }]], ['overlap', [period, { ...period, startTime: '10:00' }]], ['break outside period', [{ ...period, breaks: [{ startTime: '08:00', endTime: '09:30' }] }]], ['zero duration', [{ ...period, slotDurationMinutes: 0 }]]]) {
  test(`invalid ${name} schedule is rejected without persisting a version`, async () => {
    const d = await doctor(); const response = await create(d.id, { ...base, periods });
    assert.equal(response.status, 422, JSON.stringify(response.body));
    assert.equal(await prisma.doctorSchedule.count({ where: { doctorId: d.id } }), 0);
  });
}

test('weekday mapping does not depend on Luxon display locale', async () => {
  const d = await doctor(); assert.equal((await create(d.id, base)).status, 200);
  const original = Settings.defaultLocale;
  try { Settings.defaultLocale = 'ar'; assert.deepEqual(await getConfiguredSlots(d, monday), ['09:00', '09:30', '10:00', '10:30']); }
  finally { Settings.defaultLocale = original; }
});

test('DST spring gap never advertises normalized nonexistent times or slots crossing the gap', async () => {
  const d = await doctor(); const original = process.env.CLINIC_TIME_ZONE;
  try {
    process.env.CLINIC_TIME_ZONE = 'America/New_York';
    assert.equal((await create(d.id, { ...base, effectiveFrom: '2035-01-01', periods: [{ ...period, dayOfWeek: 'SUNDAY', startTime: '01:30', endTime: '04:00' }] })).status, 200);
    assert.deepEqual(await getConfiguredSlots(d, '2035-03-11'), ['03:00', '03:30']);
  } finally { process.env.CLINIC_TIME_ZONE = original; }
});

test('admin preview and public slots match; patient backend revalidates and concurrent bookings have one winner', async () => {
  const d = await doctor(); assert.equal((await create(d.id, { ...base, periods: [period, { ...period, startTime: '14:00', endTime: '15:00', breaks: [{ startTime: '14:30', endTime: '15:00' }] }] })).status, 200);
  const publicSlots = await request(app).get('/api/appointments/slots').query({ doctorId: d.id, date: monday });
  const preview = await auth(request(app).get(`/api/admin/doctors/${d.id}/availability/preview`)).query({ date: monday });
  assert.deepEqual(preview.body.slots, publicSlots.body);
  assert.equal((await booking(d.id, monday, '14:30')).status, 422);
  const responses = await Promise.all([booking(d.id), booking(d.id)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
  assert.equal(await prisma.appointment.count({ where: { doctorId: d.id, appointmentDate: monday, appointmentTime: '09:00', status: 'PENDING' } }), 1);
  assert.ok(!(await getAvailableSlots(d, monday)).includes('09:00'));
  await prisma.appointment.updateMany({ where: { doctorId: d.id }, data: { status: 'CANCELLED' } });
  assert.ok((await getAvailableSlots(d, monday)).includes('09:00'));
  assert.equal((await booking(d.id)).status, 201);
});
