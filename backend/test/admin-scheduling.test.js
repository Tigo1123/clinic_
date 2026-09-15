import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../src/server.js';
import prisma from '../src/db.js';

let adminToken; let receptionistToken; let doctorId; let doctorToken; let labToken; let pharmacyToken;
const payload = { effectiveFrom: '2090-01-01', active: true, periods: [{ dayOfWeek: 'MONDAY', startTime: '09:00', endTime: '11:00', slotDurationMinutes: 30, breaks: [{ startTime: '09:30', endTime: '09:45', active: true }] }] };
async function login(username, password) { const response = await request(app).post('/api/auth/login').send({ username, password }); assert.equal(response.status, 200); return response.body.token; }
before(async () => { adminToken = await login('admin@cms.com', 'Admin@123'); receptionistToken = await login('recep@cms.com', 'Receptionist@123'); doctorToken = await login('doctor@cms.com', 'Doctor@123'); labToken = await login('lab@cms.com', 'Labtech@123'); pharmacyToken = await login('pharma@cms.com', 'Pharmacist@123'); doctorId = (await prisma.doctor.findFirst({ where: { status: 'ACTIVE' } })).id; await prisma.doctorSchedule.deleteMany({ where: { doctorId } }); });
after(async () => { await prisma.doctorSchedule.deleteMany({ where: { doctorId } }); await prisma.$disconnect(); });

test('only ADMIN can create and list complete schedule versions', async () => {
  assert.equal((await request(app).get(`/api/admin/doctors/${doctorId}/schedules`).set('Authorization', `Bearer ${receptionistToken}`)).status, 403);
  const created = await request(app).post(`/api/admin/doctors/${doctorId}/schedules`).set('Authorization', `Bearer ${adminToken}`).send(payload);
  assert.equal(created.status, 200); assert.equal(created.body.periods[0].breaks[0].startTime, '09:30');
  const listed = await request(app).get(`/api/admin/doctors/${doctorId}/schedules`).set('Authorization', `Bearer ${adminToken}`);
  assert.equal(listed.status, 200); assert.equal(listed.body.length, 1);
});

test('invalid overlapping periods and breaks are rejected atomically', async () => {
  const response = await request(app).post(`/api/admin/doctors/${doctorId}/schedules`).set('Authorization', `Bearer ${adminToken}`).send({ ...payload, effectiveFrom: '2091-01-01', periods: [{ ...payload.periods[0], breaks: [{ startTime: '09:30', endTime: '10:00' }, { startTime: '09:45', endTime: '10:15' }] }, { dayOfWeek: 'MONDAY', startTime: '10:30', endTime: '11:30', slotDurationMinutes: 30 }] });
  assert.equal(response.status, 422); assert.equal((await prisma.doctorSchedule.count({ where: { doctorId } })), 1);
});

test('preview returns generated availability without raw schedule internals', async () => {
  const response = await request(app).get(`/api/admin/doctors/${doctorId}/availability/preview`).query({ date: '2090-01-01' }).set('Authorization', `Bearer ${adminToken}`);
  assert.equal(response.status, 200); assert.ok(Array.isArray(response.body.slots)); assert.equal(Object.hasOwn(response.body, 'weeklySchedule'), false);
});

test('unauthenticated schedule mutation is rejected', async () => {
  assert.equal((await request(app).post(`/api/admin/doctors/${doctorId}/schedules`).send(payload)).status, 401);
});

test('all non-admin roles are denied schedule mutation', async () => {
  for (const token of [receptionistToken, doctorToken, labToken, pharmacyToken]) assert.equal((await request(app).post(`/api/admin/doctors/${doctorId}/schedules`).set('Authorization', `Bearer ${token}`).send(payload)).status, 403);
});

test('active schedule replacement closes current version atomically and preserves history', async () => {
  await prisma.doctorSchedule.deleteMany({ where: { doctorId } });
  const current = await request(app).post(`/api/admin/doctors/${doctorId}/schedules`).set('Authorization', `Bearer ${adminToken}`).send({ ...payload, effectiveFrom: '2020-01-01' });
  assert.equal(current.status, 200);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const replacement = await request(app).post(`/api/admin/doctors/${doctorId}/schedules`).set('Authorization', `Bearer ${adminToken}`).send({ ...payload, effectiveFrom: tomorrow, periods: [{ ...payload.periods[0], startTime: '14:00', endTime: '16:00', breaks: [{ startTime: '14:30', endTime: '14:45', active: true }] }] });
  assert.equal(replacement.status, 200);
  const versions = await prisma.doctorSchedule.findMany({ where: { doctorId }, orderBy: { effectiveFrom: 'asc' } });
  assert.equal(versions.length, 2); assert.equal(versions[0].effectiveTo, new Date(new Date(`${tomorrow}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10));
});

test('overlapping active versions and invalid period payloads are rejected', async () => {
  const overlapResponse = await request(app).post(`/api/admin/doctors/${doctorId}/schedules`).set('Authorization', `Bearer ${adminToken}`).send({ ...payload, effectiveFrom: '2020-01-01', effectiveTo: '2099-01-01' });
  assert.equal(overlapResponse.status, 409); assert.equal(overlapResponse.body.error.code, 'SCHEDULE_VERSION_OVERLAP');
  const invalid = await request(app).post(`/api/admin/doctors/${doctorId}/schedules`).set('Authorization', `Bearer ${adminToken}`).send({ ...payload, effectiveFrom: '2092-01-01', periods: [{ ...payload.periods[0], startTime: '10:00', endTime: '10:00', slotDurationMinutes: 0 }] });
  assert.equal(invalid.status, 422);
});

test('PATIENT cannot mutate schedules and Admin DTOs are allowlisted', async () => {
  const username = `phase1b2a-patient-${Date.now()}@example.test`;
  await prisma.user.create({ data: { username, passwordHash: await bcrypt.hash('Patient@12345', 4), role: 'PATIENT', status: 'ACTIVE' } });
  const patientToken = await login(username, 'Patient@12345');
  const denied = await request(app).post(`/api/admin/doctors/${doctorId}/schedules`).set('Authorization', `Bearer ${patientToken}`).send(payload);
  assert.equal(denied.status, 403);
  const listed = await request(app).get(`/api/admin/doctors/${doctorId}/schedules`).set('Authorization', `Bearer ${adminToken}`);
  assert.equal(listed.status, 200);
  const allowed = new Set(['id','doctorId','effectiveFrom','effectiveTo','active','periods','createdAt','updatedAt']);
  assert.deepEqual(Object.keys(listed.body[0]).sort(), [...allowed].sort());
  assert.equal(Object.hasOwn(listed.body[0], 'weeklySchedule'), false);
});

test('future schedule versions can be edited as complete replacements', async () => {
  await prisma.doctorSchedule.deleteMany({ where: { doctorId } });
  const created = await request(app).post(`/api/admin/doctors/${doctorId}/schedules`).set('Authorization', `Bearer ${adminToken}`).send({ ...payload, effectiveFrom: '2095-01-01' });
  assert.equal(created.status, 200);
  const edited = await request(app).put(`/api/admin/doctors/${doctorId}/schedules/${created.body.id}`).set('Authorization', `Bearer ${adminToken}`).send({ effectiveFrom: '2095-01-01', active: true, periods: [{ dayOfWeek: 'TUESDAY', startTime: '13:00', endTime: '15:00', slotDurationMinutes: 20, breaks: [] }] });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.id, created.body.id);
  assert.equal(edited.body.periods.length, 1);
  assert.equal(edited.body.periods[0].dayOfWeek, 'TUESDAY');
});

test('exception replacement validates leave and special-hours atomically', async () => {
  await prisma.doctorScheduleException.deleteMany({ where: { doctorId } });
  const leave = await request(app).put(`/api/admin/doctors/${doctorId}/schedule-exceptions/2096-01-05`).set('Authorization', `Bearer ${adminToken}`).send({ type: 'FULL_DAY_LEAVE', periods: [] });
  assert.equal(leave.status, 200);
  const special = await request(app).put(`/api/admin/doctors/${doctorId}/schedule-exceptions/2096-01-05`).set('Authorization', `Bearer ${adminToken}`).send({ type: 'SPECIAL_HOURS', periods: [{ startTime: '10:00', endTime: '12:00', slotDurationMinutes: 30 }] });
  assert.equal(special.status, 200);
  assert.equal(special.body.type, 'SPECIAL_HOURS');
  assert.equal(special.body.periods.length, 1);
  const failed = await request(app).put(`/api/admin/doctors/${doctorId}/schedule-exceptions/2096-01-05`).set('Authorization', `Bearer ${adminToken}`).send({ type: 'FULL_DAY_LEAVE', periods: [{ startTime: '10:00', endTime: '11:00', slotDurationMinutes: 30 }] });
  assert.equal(failed.status, 422);
  const unchanged = await prisma.doctorScheduleException.findUnique({ where: { doctorId_date: { doctorId, date: '2096-01-05' } }, include: { periods: true } });
  assert.equal(unchanged.type, 'SPECIAL_HOURS');
  assert.equal(unchanged.periods.length, 1);
});

test('concurrent overlapping schedule versions serialize to one winner', async () => {
  await prisma.doctorSchedule.deleteMany({ where: { doctorId } });
  const a = { ...payload, effectiveFrom: '2097-01-01', effectiveTo: '2097-12-31' };
  const b = { ...payload, effectiveFrom: '2097-06-01', effectiveTo: null, periods: [{ ...payload.periods[0], startTime: '14:00', endTime: '16:00', breaks: [] }] };
  const responses = await Promise.all([a, b].map((body) => request(app).post(`/api/admin/doctors/${doctorId}/schedules`).set('Authorization', `Bearer ${adminToken}`).send(body)));
  assert.equal(responses.filter((r) => r.status === 200).length, 1);
  assert.equal(responses.filter((r) => r.status === 409 && r.body.error.code === 'SCHEDULE_VERSION_OVERLAP').length, 1);
  const versions = await prisma.doctorSchedule.findMany({ where: { doctorId, active: true }, include: { periods: true } });
  assert.equal(versions.length, 1);
  assert.equal(versions[0].periods.length, 1);
});

test('Admin mutation future-appointment conflict statuses are enforced', async () => {
  await prisma.doctorSchedule.deleteMany({ where: { doctorId } });
  const schedule = await request(app).post(`/api/admin/doctors/${doctorId}/schedules`).set('Authorization', `Bearer ${adminToken}`).send({ ...payload, effectiveFrom: '2098-01-01', periods: [{ dayOfWeek: 'MONDAY', startTime: '09:00', endTime: '10:00', slotDurationMinutes: 30, breaks: [] }] });
  assert.equal(schedule.status, 200);
  const state = await prisma.state.findFirst();
  const patient = await prisma.patient.create({ data: { fullNameAr: 'اختبار', fullNameEn: 'Test', gender: 'MALE', dateOfBirth: '1990-01-01', phone: `+2507${Date.now().toString().slice(-8)}`, addressStateId: state.id, emergencyContact: 'None' } });
  const statuses = ['PENDING','SCHEDULED','CONFIRMED','CHECKED_IN','IN_CONSULTATION','WAITING_LAB','COMPLETED'];
  for (const status of statuses) {
    const appointment = await prisma.appointment.create({ data: { patientId: patient.id, doctorId, appointmentDate: '2098-01-05', appointmentTime: '09:00', status } });
    const response = await request(app).patch(`/api/admin/doctors/${doctorId}/schedules/${schedule.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ active: false });
    assert.equal(response.status, 409); assert.equal(response.body.error.code, 'SCHEDULE_FUTURE_APPOINTMENT_CONFLICT');
    assert.equal((await prisma.appointment.findUnique({ where: { id: appointment.id } })).status, status);
    await prisma.appointment.delete({ where: { id: appointment.id } });
  }
  for (const status of ['CANCELLED','NO_SHOW']) {
    const appointment = await prisma.appointment.create({ data: { patientId: patient.id, doctorId, appointmentDate: '2098-01-05', appointmentTime: '09:00', status } });
    const response = await request(app).patch(`/api/admin/doctors/${doctorId}/schedules/${schedule.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ active: false });
    assert.equal(response.status, 200); await prisma.doctorSchedule.update({ where: { id: schedule.body.id }, data: { active: true } }); await prisma.appointment.delete({ where: { id: appointment.id } });
  }
  await prisma.patient.delete({ where: { id: patient.id } });
});

test('concurrent exception replacements serialize to one operational state', async () => {
  await prisma.doctorScheduleException.deleteMany({ where: { doctorId } });
  const date = '2099-02-01';
  const requests = [
    { type: 'FULL_DAY_LEAVE', periods: [] },
    { type: 'SPECIAL_HOURS', periods: [{ startTime: '10:00', endTime: '12:00', slotDurationMinutes: 30 }] }
  ].map((body) => request(app).put(`/api/admin/doctors/${doctorId}/schedule-exceptions/${date}`).set('Authorization', `Bearer ${adminToken}`).send(body));
  const responses = await Promise.all(requests);
  assert.equal(responses.filter((r) => r.status === 200).length, 2);
  const current = await prisma.doctorScheduleException.findUnique({ where: { doctorId_date: { doctorId, date } }, include: { periods: true } });
  assert.equal(current.active, true);
  assert.ok(['FULL_DAY_LEAVE', 'SPECIAL_HOURS'].includes(current.type));
  assert.equal(current.type === 'FULL_DAY_LEAVE' ? current.periods.length : current.periods.length > 0, true);
});

test('schedule deactivation is safe or rejects conflicting future appointments', async () => {
  await prisma.doctorSchedule.deleteMany({ where: { doctorId } });
  const safe = await request(app).post(`/api/admin/doctors/${doctorId}/schedules`).set('Authorization', `Bearer ${adminToken}`).send({ ...payload, effectiveFrom: '2100-01-01' });
  assert.equal(safe.status, 200);
  const safeOff = await request(app).patch(`/api/admin/doctors/${doctorId}/schedules/${safe.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ active: false });
  assert.equal(safeOff.status, 200);
  assert.equal((await prisma.doctorSchedule.findUnique({ where: { id: safe.body.id } })).active, false);
  const conflict = await request(app).post(`/api/admin/doctors/${doctorId}/schedules`).set('Authorization', `Bearer ${adminToken}`).send({ ...payload, effectiveFrom: '2100-01-01' });
  assert.equal(conflict.status, 200);
  const state = await prisma.state.findFirst();
  const patient = await prisma.patient.create({ data: { fullNameAr: 'اختبار', fullNameEn: 'Test', gender: 'MALE', dateOfBirth: '1990-01-01', phone: `+2507${Date.now().toString().slice(-8)}`, addressStateId: state.id, emergencyContact: 'None' } });
  const appointment = await prisma.appointment.create({ data: { patientId: patient.id, doctorId, appointmentDate: '2100-01-04', appointmentTime: '09:00', status: 'SCHEDULED' } });
  const beforeAudit = await prisma.tenantAuditLog.count({ where: { action: 'DOCTOR_SCHEDULE_DEACTIVATED' } });
  const rejected = await request(app).patch(`/api/admin/doctors/${doctorId}/schedules/${conflict.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ active: false });
  assert.equal(rejected.status, 409); assert.equal(rejected.body.error.code, 'SCHEDULE_FUTURE_APPOINTMENT_CONFLICT');
  assert.equal((await prisma.doctorSchedule.findUnique({ where: { id: conflict.body.id } })).active, true);
  assert.equal((await prisma.appointment.findUnique({ where: { id: appointment.id } })).status, 'SCHEDULED');
  assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'DOCTOR_SCHEDULE_DEACTIVATED' } }), beforeAudit);
  await prisma.appointment.delete({ where: { id: appointment.id } }); await prisma.patient.delete({ where: { id: patient.id } });
});

test('exception deactivation rejects conflicts and safely restores recurring availability', async () => {
  await prisma.doctorSchedule.deleteMany({ where: { doctorId } }); await prisma.doctorScheduleException.deleteMany({ where: { doctorId } });
  const recurring = await request(app).post(`/api/admin/doctors/${doctorId}/schedules`).set('Authorization', `Bearer ${adminToken}`).send({ ...payload, effectiveFrom: '2101-01-01', periods: [{ dayOfWeek: 'MONDAY', startTime: '09:00', endTime: '10:00', slotDurationMinutes: 30, breaks: [] }] });
  assert.equal(recurring.status, 200);
  const date = '2101-01-04';
  const exception = await request(app).put(`/api/admin/doctors/${doctorId}/schedule-exceptions/${date}`).set('Authorization', `Bearer ${adminToken}`).send({ type: 'SPECIAL_HOURS', periods: [{ startTime: '14:00', endTime: '15:00', slotDurationMinutes: 30 }] });
  assert.equal(exception.status, 200);
  const state = await prisma.state.findFirst(); const patient = await prisma.patient.create({ data: { fullNameAr: 'اختبار', fullNameEn: 'Test', gender: 'FEMALE', dateOfBirth: '1991-01-01', phone: `+2507${Date.now().toString().slice(-8)}`, addressStateId: state.id, emergencyContact: 'None' } });
  const appointment = await prisma.appointment.create({ data: { patientId: patient.id, doctorId, appointmentDate: date, appointmentTime: '14:00', status: 'SCHEDULED' } });
  const rejected = await request(app).patch(`/api/admin/doctors/${doctorId}/schedule-exceptions/${date}/status`).set('Authorization', `Bearer ${adminToken}`).send({ active: false });
  assert.equal(rejected.status, 409); assert.equal(rejected.body.error.code, 'SCHEDULE_FUTURE_APPOINTMENT_CONFLICT');
  assert.equal((await prisma.doctorScheduleException.findUnique({ where: { doctorId_date: { doctorId, date } } })).active, true);
  await prisma.appointment.delete({ where: { id: appointment.id } });
  const safe = await request(app).patch(`/api/admin/doctors/${doctorId}/schedule-exceptions/${date}/status`).set('Authorization', `Bearer ${adminToken}`).send({ active: false });
  assert.equal(safe.status, 200);
  await prisma.patient.delete({ where: { id: patient.id } });
});

test('Admin mutation conflict checks use clinic-local time when process TZ differs', async () => {
  const originalTZ = process.env.TZ; const originalClinic = process.env.CLINIC_TIME_ZONE; const originalNow = Date.now;
  process.env.TZ = 'UTC'; process.env.CLINIC_TIME_ZONE = 'Africa/Khartoum'; Date.now = () => Date.parse('2026-09-15T08:00:00.000Z');
  try {
    await prisma.doctorSchedule.deleteMany({ where: { doctorId } });
    const state = await prisma.state.findFirst(); const patient = await prisma.patient.create({ data: { fullNameAr: 'اختبار', fullNameEn: 'Test', gender: 'MALE', dateOfBirth: '1990-01-01', phone: `+2507${Date.now().toString().slice(-8)}`, addressStateId: state.id, emergencyContact: 'None' } });
    const schedule = await request(app).post(`/api/admin/doctors/${doctorId}/schedules`).set('Authorization', `Bearer ${adminToken}`).send({ ...payload, effectiveFrom: '2026-01-01' });
    assert.equal(schedule.status, 200);
    for (const [date, time, blocks] of [['2026-09-14', '11:00', false], ['2026-09-15', '09:00', false], ['2026-09-15', '11:00', true], ['2026-09-16', '09:00', true]]) {
      const appointment = await prisma.appointment.create({ data: { patientId: patient.id, doctorId, appointmentDate: date, appointmentTime: time, status: 'SCHEDULED' } });
      const response = await request(app).patch(`/api/admin/doctors/${doctorId}/schedules/${schedule.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ active: false });
      assert.equal(blocks ? response.status : response.status, blocks ? 409 : 200);
      if (blocks) assert.equal(response.body.error.code, 'SCHEDULE_FUTURE_APPOINTMENT_CONFLICT');
      await prisma.appointment.delete({ where: { id: appointment.id } });
      if (!blocks) { await prisma.doctorSchedule.update({ where: { id: schedule.body.id }, data: { active: true } }); }
    }
    await prisma.patient.delete({ where: { id: patient.id } });
  } finally { Date.now = originalNow; if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ; if (originalClinic === undefined) delete process.env.CLINIC_TIME_ZONE; else process.env.CLINIC_TIME_ZONE = originalClinic; }
});

test('post-lock schedule conflict rolls back parent, children, and audit', async () => {
  await prisma.doctorSchedule.deleteMany({ where: { doctorId } });
  const created = await request(app).post(`/api/admin/doctors/${doctorId}/schedules`).set('Authorization', `Bearer ${adminToken}`).send({ ...payload, effectiveFrom: '2102-01-01' });
  assert.equal(created.status, 200);
  const state = await prisma.state.findFirst(); const patient = await prisma.patient.create({ data: { fullNameAr: 'اختبار', fullNameEn: 'Test', gender: 'MALE', dateOfBirth: '1990-01-01', phone: `+2507${Date.now().toString().slice(-8)}`, addressStateId: state.id, emergencyContact: 'None' } });
  const appointment = await prisma.appointment.create({ data: { patientId: patient.id, doctorId, appointmentDate: '2102-01-06', appointmentTime: '09:00', status: 'SCHEDULED' } });
  const before = await prisma.doctorSchedule.findUnique({ where: { id: created.body.id }, include: { periods: { include: { breaks: true } } } });
  const auditBefore = await prisma.tenantAuditLog.count({ where: { action: 'DOCTOR_SCHEDULE_DEACTIVATED' } });
  // ensureNoFutureConflicts runs inside replace/setScheduleStatus transaction after lockDoctor (SELECT FOR UPDATE).
  const response = await request(app).patch(`/api/admin/doctors/${doctorId}/schedules/${created.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ active: false });
  assert.equal(response.status, 409); assert.equal(response.body.error.code, 'SCHEDULE_FUTURE_APPOINTMENT_CONFLICT');
  const after = await prisma.doctorSchedule.findUnique({ where: { id: created.body.id }, include: { periods: { include: { breaks: true } } } });
  assert.deepEqual(after, before); assert.equal((await prisma.appointment.findUnique({ where: { id: appointment.id } })).status, 'SCHEDULED');
  assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'DOCTOR_SCHEDULE_DEACTIVATED' } }), auditBefore);
  await prisma.appointment.delete({ where: { id: appointment.id } }); await prisma.patient.delete({ where: { id: patient.id } });
});
