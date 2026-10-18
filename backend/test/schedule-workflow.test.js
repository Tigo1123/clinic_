import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import prisma from '../src/db.js';
import router from '../src/routes/adminScheduling.js';
import { signAccessToken } from '../src/services/accessTokens.js';

// Dedicated isolated schema only; no seeds, shared records, or fixture deletion.
assert.equal(process.env.NODE_ENV, 'test');
const database = new URL(process.env.DATABASE_URL);
assert.equal(database.pathname, '/clinic_test');
assert.match(database.searchParams.get('schema'), /^schedule_workflow_/);
const app = express(); app.use(express.json()); app.use('/api/admin', router);
let token; let nonAdminToken; let doctorA; let doctorB;
const basePeriod = { dayOfWeek: 'MONDAY', startTime: '09:00', endTime: '11:00', slotDurationMinutes: 30, breaks: [] };
const base = { effectiveFrom: '2190-01-01', effectiveTo: '2191-01-01', active: true, periods: [basePeriod] };
const auth = r => r.set('Authorization', `Bearer ${token}`);
async function makeDoctor() {
 return prisma.doctor.create({ data: { fullNameAr: 'اختبار', fullNameEn: 'Workflow test', specialtyAr: 'اختبار', specialtyEn: 'Test', consultationFee: 10, weeklySchedule: '{}', user: { create: { username: `schedule-${crypto.randomUUID()}`, passwordHash: 'test-unused', role: 'DOCTOR' } } } });
}
before(async () => {
 const admin = await prisma.user.create({ data: { username: `schedule-admin-${crypto.randomUUID()}`, passwordHash: 'test-unused', role: 'ADMIN' } });
 token = signAccessToken(admin);
 doctorA = (await makeDoctor()).id; const b = await makeDoctor(); doctorB = b.id;
 nonAdminToken = signAccessToken(await prisma.user.findUnique({ where: { id: b.userId } }));
});
after(async () => prisma.$disconnect());

test('all seven days persist, adjacent periods are valid, and editing excludes its own version', async () => {
 const periods = ['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY'].map(dayOfWeek => ({ ...basePeriod, dayOfWeek }));
 periods.push({ ...basePeriod, startTime: '11:00', endTime: '12:00' });
 const created = await auth(request(app).post(`/api/admin/doctors/${doctorA}/schedules`)).send({ ...base, periods });
 assert.equal(created.status, 200);
 const updated = await auth(request(app).put(`/api/admin/doctors/${doctorA}/schedules/${created.body.id}`)).send({ ...base, periods: periods.map(p => ({ ...p, slotDurationMinutes: 20 })) });
 assert.equal(updated.status, 200);
 const persisted = await prisma.doctorSchedule.findUnique({ where: { id: created.body.id }, include: { periods: true } });
 assert.equal(persisted.periods.length, 8); assert.equal(persisted.effectiveTo, base.effectiveTo);
 assert.ok(persisted.periods.every(p => p.slotDurationMinutes === 20));
 const activated = await auth(request(app).patch(`/api/admin/doctors/${doctorA}/schedules/${created.body.id}/status`)).send({ active: true });
 assert.equal(activated.status, 200);
 const list = await auth(request(app).get(`/api/admin/doctors/${doctorA}/schedules`));
 assert.equal(list.body.length, 1); assert.equal(list.body[0].periods.length, 8);
});
test('real within-payload overlaps explain day and intervals and persist nothing', async () => {
 const beforeCount = await prisma.doctorSchedule.count();
 const rejected = await auth(request(app).post(`/api/admin/doctors/${doctorB}/schedules`)).send({ ...base, periods: [basePeriod, { ...basePeriod, startTime: '10:00' }] });
 assert.equal(rejected.status, 422); assert.equal(rejected.body.error.code, 'SCHEDULE_PERIOD_OVERLAP');
 assert.match(rejected.body.error.message, /MONDAY.*10:00.*09:00/);
 assert.equal(await prisma.doctorSchedule.count(), beforeCount);
});
test('version overlap, invalid weekdays, and cross-doctor ownership remain enforced', async () => {
 const existing = await prisma.doctorSchedule.findFirst({ where: { doctorId: doctorA } });
 const overlap = await auth(request(app).post(`/api/admin/doctors/${doctorA}/schedules`)).send(base);
 assert.equal(overlap.status, 409); assert.equal(overlap.body.error.code, 'SCHEDULE_VERSION_OVERLAP');
 const hijack = await auth(request(app).put(`/api/admin/doctors/${doctorB}/schedules/${existing.id}`)).send(base);
 assert.equal(hijack.status, 404);
 const invalid = await auth(request(app).post(`/api/admin/doctors/${doctorB}/schedules`)).send({ ...base, periods: [{ ...basePeriod, dayOfWeek: 'INVALID' }] });
 assert.equal(invalid.status, 422);
 const denied = await request(app).post(`/api/admin/doctors/${doctorB}/schedules`).set('Authorization', `Bearer ${nonAdminToken}`).send(base);
 assert.equal(denied.status, 403);
});
test('activation rejects other active versions while allowing itself', async () => {
 const dormant = await prisma.doctorSchedule.create({ data: { doctorId: doctorA, effectiveFrom: base.effectiveFrom, effectiveTo: base.effectiveTo, active: false } });
 const rejected = await auth(request(app).patch(`/api/admin/doctors/${doctorA}/schedules/${dormant.id}/status`)).send({ active: true });
 assert.equal(rejected.status, 409); assert.equal(rejected.body.error.code, 'SCHEDULE_VERSION_OVERLAP');
 assert.equal((await prisma.doctorSchedule.findUnique({ where: { id: dormant.id } })).active, false);
});
test('replacing current hours creates a tomorrow version and permits editing it repeatedly', async () => {
 const today = new Date().toISOString().slice(0, 10);
 const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
 const current = await auth(request(app).post(`/api/admin/doctors/${doctorB}/schedules`)).send({ ...base, effectiveFrom: today, effectiveTo: null });
 assert.equal(current.status, 200);
 const replacement = await auth(request(app).post(`/api/admin/doctors/${doctorB}/schedules`)).send({ ...base, effectiveFrom: tomorrow, effectiveTo: null });
 assert.equal(replacement.status, 200);
 const update = await auth(request(app).put(`/api/admin/doctors/${doctorB}/schedules/${replacement.body.id}`)).send({ ...base, effectiveFrom: tomorrow, effectiveTo: null });
 assert.equal(update.status, 200);
 const previous = await prisma.doctorSchedule.findUnique({ where: { id: current.body.id } });
 assert.equal(previous.effectiveTo, today);
});

test('future appointment conflicts still reject replacement atomically', async () => {
 const doctor = await makeDoctor();
 const created = await auth(request(app).post(`/api/admin/doctors/${doctor.id}/schedules`)).send(base);
 assert.equal(created.status, 200);
 const state = await prisma.state.create({ data: { id: 987654, labelAr: 'اختبار', labelEn: 'Workflow test' } });
 const patient = await prisma.patient.create({ data: { fullNameAr: 'اختبار', fullNameEn: 'Workflow test', gender: 'MALE', dateOfBirth: '1990-01-01', phone: '+250788000001', addressStateId: state.id, emergencyContact: 'Test' } });
 await prisma.appointment.create({ data: { patientId: patient.id, doctorId: doctor.id, appointmentDate: '2190-01-04', appointmentTime: '09:00', status: 'SCHEDULED' } });
 const auditBefore = await prisma.tenantAuditLog.count();
 const rejected = await auth(request(app).put(`/api/admin/doctors/${doctor.id}/schedules/${created.body.id}`)).send({ ...base, periods: [] });
 assert.equal(rejected.status, 409); assert.equal(rejected.body.error.code, 'SCHEDULE_FUTURE_APPOINTMENT_CONFLICT');
 assert.equal(rejected.body.error.details[0].appointmentTime, '09:00');
 const persisted = await prisma.doctorSchedule.findUnique({ where: { id: created.body.id }, include: { periods: true } });
 assert.equal(persisted.periods.length, 1); assert.equal(await prisma.tenantAuditLog.count(), auditBefore);
});
