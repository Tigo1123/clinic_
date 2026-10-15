import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/server.js';
import prisma from '../src/db.js';

let adminToken; let doctorA; let doctorB; let patient;
const base = { active: true, periods: [{ dayOfWeek: 'MONDAY', startTime: '09:00', endTime: '11:00', slotDurationMinutes: 30, breaks: [] }] };
const auth = (req) => req.set('Authorization', `Bearer ${adminToken}`);

before(async () => {
  const login = await request(app).post('/api/auth/login').send({ username: 'admin@cms.com', password: 'Admin@123' });
  assert.equal(login.status, 200);
  adminToken = login.body.token;
  const doctors = await prisma.doctor.findMany({ where: { status: 'ACTIVE' }, take: 2 });
  assert.ok(doctors.length >= 2, 'The seed must provide at least two active doctors.');
  [doctorA, doctorB] = doctors.map((d) => d.id);
  for (const id of [doctorA, doctorB]) {
    await prisma.doctorScheduleException.deleteMany({ where: { doctorId: id } });
    await prisma.doctorSchedule.deleteMany({ where: { doctorId: id } });
  }
  const state = await prisma.state.findFirst();
  patient = await prisma.patient.create({ data: { fullNameAr: 'اختبار', fullNameEn: 'Regression', gender: 'MALE', dateOfBirth: '1990-01-01', phone: `+2507${Date.now().toString().slice(-8)}`, addressStateId: state.id, emergencyContact: 'None' } });
});

after(async () => {
  for (const id of [doctorA, doctorB]) {
    await prisma.appointment.deleteMany({ where: { doctorId: id, appointmentDate: { gte: '2110-01-01' } } });
    await prisma.doctorScheduleException.deleteMany({ where: { doctorId: id } });
    await prisma.doctorSchedule.deleteMany({ where: { doctorId: id } });
  }
  await prisma.patient.delete({ where: { id: patient.id } });
  await prisma.$disconnect();
});

test('#5 a schedule belonging to another doctor cannot be replaced through this doctor URL', async () => {
  const forB = await auth(request(app).post(`/api/admin/doctors/${doctorB}/schedules`)).send({ ...base, effectiveFrom: '2110-01-01' });
  assert.equal(forB.status, 200);
  const hijack = await auth(request(app).put(`/api/admin/doctors/${doctorA}/schedules/${forB.body.id}`)).send({
    effectiveFrom: '2110-01-01', active: true,
    periods: [{ dayOfWeek: 'TUESDAY', startTime: '13:00', endTime: '15:00', slotDurationMinutes: 20, breaks: [] }]
  });
  assert.equal(hijack.status, 404);
  assert.equal(hijack.body.error.code, 'SCHEDULE_NOT_FOUND');
  const untouched = await prisma.doctorSchedule.findUnique({ where: { id: forB.body.id }, include: { periods: true } });
  assert.equal(untouched.doctorId, doctorB);
  assert.equal(untouched.periods[0].dayOfWeek, 'MONDAY');
});

test('#6 special hours that still contain an existing appointment are accepted', async () => {
  const date = '2111-01-04';
  await prisma.appointment.create({ data: { patientId: patient.id, doctorId: doctorA, appointmentDate: date, appointmentTime: '10:00', status: 'SCHEDULED' } });
  const accepted = await auth(request(app).put(`/api/admin/doctors/${doctorA}/schedule-exceptions/${date}`)).send({
    type: 'SPECIAL_HOURS', periods: [{ startTime: '09:00', endTime: '12:00', slotDurationMinutes: 30 }]
  });
  assert.equal(accepted.status, 200);
});

test('#6 special hours that exclude an existing appointment are still rejected', async () => {
  const date = '2111-01-11';
  await prisma.appointment.create({ data: { patientId: patient.id, doctorId: doctorA, appointmentDate: date, appointmentTime: '10:00', status: 'SCHEDULED' } });
  const rejected = await auth(request(app).put(`/api/admin/doctors/${doctorA}/schedule-exceptions/${date}`)).send({
    type: 'SPECIAL_HOURS', periods: [{ startTime: '14:00', endTime: '16:00', slotDurationMinutes: 30 }]
  });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.error.code, 'SCHEDULE_FUTURE_APPOINTMENT_CONFLICT');
});

test('#7 activating a schedule that overlaps another active version is rejected', async () => {
  await prisma.doctorSchedule.deleteMany({ where: { doctorId: doctorB } });
  const first = await auth(request(app).post(`/api/admin/doctors/${doctorB}/schedules`)).send({ ...base, effectiveFrom: '2112-01-01', effectiveTo: '2112-12-31' });
  assert.equal(first.status, 200);
  // Create an overlapping version directly as inactive, as a stale or imported row could be.
  const dormant = await prisma.doctorSchedule.create({ data: { doctorId: doctorB, effectiveFrom: '2112-06-01', effectiveTo: null, active: false } });
  const activation = await auth(request(app).patch(`/api/admin/doctors/${doctorB}/schedules/${dormant.id}/status`)).send({ active: true });
  assert.equal(activation.status, 409);
  assert.equal(activation.body.error.code, 'SCHEDULE_VERSION_OVERLAP');
  assert.equal((await prisma.doctorSchedule.findUnique({ where: { id: dormant.id } })).active, false);
});

test('#7 activating a non-overlapping schedule still succeeds', async () => {
  await prisma.doctorSchedule.deleteMany({ where: { doctorId: doctorB } });
  const dormant = await prisma.doctorSchedule.create({ data: { doctorId: doctorB, effectiveFrom: '2113-01-01', effectiveTo: null, active: false } });
  const activation = await auth(request(app).patch(`/api/admin/doctors/${doctorB}/schedules/${dormant.id}/status`)).send({ active: true });
  assert.equal(activation.status, 200);
  assert.equal(activation.body.active, true);
});
