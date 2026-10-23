import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import prisma from '../src/db.js';
import appointmentRoutes from '../src/routes/appointments.js';
import patientRoutes from '../src/routes/patient.js';
import billingRoutes from '../src/routes/billing.js';
import adminDoctorRoutes from '../src/routes/adminDoctors.js';
import { signAccessToken } from '../src/services/accessTokens.js';
import { corsMiddleware } from '../src/utils/edgeSecurity.js';
import { createBucketCleanup, PrismaRateLimitStore } from '../src/services/rateLimitStore.js';
import { assertDestructiveStaging, assertLoadTarget, assertLoadTargetMarker, DESTRUCTIVE_CONFIRMATION } from '../../tests/production-readiness/safety-guards.mjs';

const app = express();
app.use(express.json(), corsMiddleware(['http://localhost:5173']));
app.use('/api/appointments', appointmentRoutes);
app.use('/api/patient', patientRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/admin', adminDoctorRoutes);
const api = request(app);
let admin, patient, doctor, patientUser;
const auth = (user) => ({ Authorization: `Bearer ${signAccessToken({ ...user, authVersion: user.authVersion })}` });
before(async () => {
  admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
  doctor = await prisma.doctor.findFirstOrThrow();
  patientUser = await prisma.user.create({ data: { username: 'pagination@example.invalid', role: 'PATIENT', passwordHash: 'not-a-login', emailVerifiedAt: new Date() } });
  patient = await prisma.patient.create({ data: { userId: patientUser.id, fullNameAr: 'مريض اصطناعي', fullNameEn: 'Synthetic Pagination Patient', gender: 'MALE', dateOfBirth: '1990-01-01', phone: '+249000000001', addressStateId: 1, emergencyContact: 'Synthetic' } });
});
after(() => prisma.$disconnect());

test('emergency queue page membership is prioritized in PostgreSQL before the 50-row boundary', async () => {
  const date = '2098-01-01';
  const rows = Array.from({ length: 55 }, (_, i) => ({ id: crypto.randomUUID(), patientId: patient.id, doctorId: doctor.id, appointmentDate: date, appointmentTime: `${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`, status: 'CHECKED_IN' }));
  await prisma.appointment.createMany({ data: rows });
  await prisma.emergencyOverride.create({ data: { appointmentId: rows[54].id, justification: 'Synthetic emergency regression fixture', authorizedById: admin.id } });
  const first = await api.get(`/api/appointments/queue/${doctor.id}?date=${date}&page=1&pageSize=50`).set(auth(admin));
  const second = await api.get(`/api/appointments/queue/${doctor.id}?date=${date}&page=2&pageSize=50`).set(auth(admin));
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  assert.equal(first.body[0].id, rows[54].id);
  const ids = [...first.body, ...second.body].map((row) => row.id);
  assert.equal(ids.length, 55); assert.equal(new Set(ids).size, 55);
  assert.deepEqual(ids.slice(1), rows.slice(0, 54).map((row) => row.id));
  assert.equal(first.headers['x-has-more'], 'true'); assert.equal(second.headers['x-has-more'], 'false');
});

test('patient lab pages use a unique tie-breaker when every orderDate is equal', async () => {
  const appointment = await prisma.appointment.create({ data: { patientId: patient.id, doctorId: doctor.id, appointmentDate: '2098-02-01', appointmentTime: '09:00', status: 'COMPLETED' } });
  const record = await prisma.medicalRecord.create({ data: { patientId: patient.id, doctorId: doctor.id, appointmentId: appointment.id, symptomsEncrypted: '', diagnosisEncrypted: '', treatmentEncrypted: '', clinicalNotesEncrypted: '', vitalSignsJson: '{}' } });
  const rows = Array.from({ length: 55 }, () => ({ id: crypto.randomUUID(), medicalRecordId: record.id, patientId: patient.id, doctorId: doctor.id, status: 'COMPLETED', orderDate: new Date('2026-01-01T00:00:00Z'), releasedToPatientAt: new Date() }));
  await prisma.labOrder.createMany({ data: rows });
  const ids = [];
  for (let page = 1; page <= 3; page++) {
    const response = await api.get(`/api/patient/lab-results?page=${page}&pageSize=25`).set(auth(patientUser));
    assert.equal(response.status, 200); ids.push(...response.body.map((row) => row.id));
  }
  assert.equal(new Set(ids).size, 55);
  assert.deepEqual(ids, rows.map((row) => row.id).sort().reverse());
});

test('analytics returns workload for every doctor beyond 100 and configuration pages reach doctor 101', async () => {
  const users = Array.from({ length: 105 }, (_, i) => ({ id: crypto.randomUUID(), username: `workload-${i}@example.invalid`, role: 'DOCTOR', passwordHash: 'not-a-login' }));
  await prisma.user.createMany({ data: users });
  const doctors = users.map((user, i) => ({ id: crypto.randomUUID(), userId: user.id, fullNameAr: 'طبيب اصطناعي', fullNameEn: `ZZ Synthetic ${String(i).padStart(3, '0')}`, specialtyAr: 'اختبار', specialtyEn: 'Synthetic', consultationFee: 100, weeklySchedule: '[]' }));
  await prisma.doctor.createMany({ data: doctors });
  await prisma.appointment.create({ data: { patientId: patient.id, doctorId: doctors[104].id, appointmentDate: '2098-03-01', appointmentTime: '09:00', status: 'COMPLETED' } });
  const response = await api.get('/api/billing/analytics').set(auth(admin));
  assert.equal(response.status, 200);
  assert.equal(response.body.doctorWorkload.length, await prisma.doctor.count());
  assert.equal(response.body.doctorWorkload.find((row) => row.id === doctors[104].id).completedAppointments, 1);
  const ids = [];
  for (let page = 1; page <= 3; page++) {
    const res = await api.get(`/api/admin/doctors?page=${page}&pageSize=50`).set(auth(admin)).set('Origin', 'http://localhost:5173');
    assert.equal(res.status, 200); ids.push(...res.body.map((row) => row.id));
    assert.match(res.headers['access-control-expose-headers'], /X-Has-More/);
  }
  assert.equal(new Set(ids).size, await prisma.doctor.count());
  const filtered = await api.get('/api/admin/doctors?search=ZZ%20Synthetic%20104&pageSize=12').set(auth(admin));
  assert.equal(filtered.body[0].id, doctors[104].id); assert.equal(filtered.headers['x-total-count'], '1');
});

test('destructive scripts require a separate environment marker, exact confirmation and guarded target', () => {
  const target = 'postgresql://localhost:55439/shifa_stage';
  const valid = { STAGING_TOOL_ENV: 'isolated-local-staging', CONFIRM_STAGING_DESTRUCTIVE_ACTION: DESTRUCTIVE_CONFIRMATION };
  assert.throws(() => assertDestructiveStaging({}, target, 'shifa_stage'));
  assert.throws(() => assertDestructiveStaging({ ...valid, CONFIRM_STAGING_DESTRUCTIVE_ACTION: 'yes' }, target, 'shifa_stage'));
  assert.throws(() => assertDestructiveStaging(valid, 'postgresql://ep-production.neon.tech:55439/shifa_stage', 'shifa_stage'));
  assert.throws(() => assertDestructiveStaging({ ...valid, NODE_ENV: 'production' }, target, 'shifa_stage'));
  assert.throws(() => assertDestructiveStaging(valid, `${target}?host=production`, 'shifa_stage'));
  assert.doesNotThrow(() => assertDestructiveStaging(valid, target, 'shifa_stage'));
});

test('load guards refuse unknown/production/local targets and independently verify server identity', () => {
  const valid = { BASE_URL: 'https://isolated.example.test', LOAD_TEST_ENV: 'staging', EXPECTED_STAGING_HOST: 'isolated.example.test', LOAD_TEST_PRODUCTION_HOSTS: 'live.example.test', CONFIRM_LOAD_TEST: 'I_CONFIRM_ISOLATED_STAGING_LOAD', EXPECTED_LOAD_TEST_TARGET_ID: 'disposable_test_2026' };
  for (const overrides of [{ CONFIRM_LOAD_TEST: '' }, { CONFIRM_LOAD_TEST: 'yes' }, { BASE_URL: 'https://live.example.test', EXPECTED_STAGING_HOST: 'live.example.test' }, { BASE_URL: 'https://clinic-api.onrender.com', EXPECTED_STAGING_HOST: 'clinic-api.onrender.com' }, { BASE_URL: 'http://localhost:5000' }, { EXPECTED_STAGING_HOST: 'unknown.test' }, { LOAD_TEST_ENV: 'production' }, { BASE_URL: 'https://user:password@isolated.example.test' }]) assert.throws(() => assertLoadTarget({ ...valid, ...overrides }));
  const target = assertLoadTarget(valid);
  assert.throws(() => assertLoadTargetMarker(target, { environment: 'production', targetId: target.targetId }));
  assert.throws(() => assertLoadTargetMarker(target, { environment: 'staging', targetId: 'wrong-marker' }));
  assert.doesNotThrow(() => assertLoadTargetMarker(target, { environment: 'staging', targetId: target.targetId }));
  assert.throws(() => assertLoadTarget(valid, { writes: true }));
  assert.doesNotThrow(() => assertLoadTarget({ ...valid, CONFIRM_LOAD_TEST_WRITES: 'I_CONFIRM_DISPOSABLE_LOAD_TEST_WRITES' }, { writes: true }));
  assert.doesNotThrow(() => assertLoadTarget({ ...valid, BASE_URL: 'http://127.0.0.1:5000', LOAD_TEST_ENV: 'local', ENABLE_LOCAL_LOAD_TEST: 'true', CONFIRM_LOAD_TEST: 'I_CONFIRM_LOCAL_LOAD' }));
});

test('cleanup failures warn at most once per five minutes and never block enforcement', async () => {
  let now = 0, attempts = 0, warnings = 0;
  const cleanup = createBucketCleanup({ now: () => now, execute: async () => { attempts++; throw new Error('sensitive SQL details'); }, warn: () => warnings++ });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  assert.equal(cleanup(), undefined); await flush();
  assert.equal(attempts, 1); assert.equal(warnings, 1);
  now = 60_000; cleanup(); await flush(); assert.equal(attempts, 2); assert.equal(warnings, 1);
  now = 300_000; cleanup(); await flush(); assert.equal(warnings, 2);
});

test('shared PostgreSQL rate limits count concurrent workers atomically and expire', async () => {
  const prefix = `regression-${crypto.randomUUID()}`;
  const first = new PrismaRateLimitStore({ prefix, windowMs: 60_000 });
  const second = new PrismaRateLimitStore({ prefix, windowMs: 60_000 });
  const results = await Promise.all(Array.from({ length: 30 }, (_, i) => (i % 2 ? first : second).increment('same-client')));
  assert.equal(Math.max(...results.map((row) => row.totalHits)), 30);
  await prisma.rateLimitBucket.update({ where: { key: `${prefix}:same-client` }, data: { resetTime: new Date(0) } });
  assert.equal((await second.increment('same-client')).totalHits, 1);
  await first.resetAll();
});
