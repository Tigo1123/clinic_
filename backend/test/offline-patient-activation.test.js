import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import prisma from '../src/db.js';
import { app, httpServer } from '../src/server.js';

const api = request(app);
const password = 'StrongPass123';
let adminToken, receptionToken, doctorToken;
const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function createPatient(phone, dob = '1980-01-01') {
  return prisma.patient.create({ data: { fullNameAr: 'مريض اختبار', fullNameEn: 'Offline Test', gender: 'MALE', dateOfBirth: dob, phone, addressStateId: 1, emergencyContact: 'Self' } });
}
async function issue(patientId, token = receptionToken) {
  return api.post(`/api/patient-auth/claims/${patientId}/code`).set(auth(token));
}

before(async () => {
  process.env.VERIFICATION_PROVIDER = 'disabled';
  adminToken = (await api.post('/api/auth/login').send({ username: 'admin@cms.com', password: 'Admin@123' })).body.token;
  receptionToken = (await api.post('/api/auth/login').send({ username: 'recep@cms.com', password: 'Receptionist@123' })).body.token;
  doctorToken = (await api.post('/api/auth/login').send({ username: 'doctor@cms.com', password: 'Doctor@123' })).body.token;
});
after(async () => { process.env.VERIFICATION_PROVIDER = 'development'; await prisma.$disconnect(); if (httpServer.listening) await new Promise((resolve) => httpServer.close(resolve)); });

test('offline public registration and password recovery fail closed without creating a pending account or pretending delivery', async () => {
  const registration = await api.post('/api/patient-auth/register').send({ fullName: 'Offline User', phone: '+250788200001', email: 'offline-registration@example.com', dateOfBirth: '1990-01-01', gender: 'MALE', password });
  assert.equal(registration.status, 503);
  assert.equal(registration.body.error.code, 'VERIFICATION_UNAVAILABLE');
  assert.equal(await prisma.user.count({ where: { email: 'offline-registration@example.com' } }), 0);
  const recovery = await api.post('/api/patient-auth/forgot-password').send({ email: 'offline-registration@example.com' });
  assert.equal(recovery.status, 503);
  assert.equal(recovery.body.error.code, 'VERIFICATION_UNAVAILABLE');
  assert.equal(Object.hasOwn(recovery.body, 'challengeId'), false);
  assert.equal(Object.hasOwn(recovery.body, 'developmentCode'), false);
});

test('only receptionist or admin may issue an offline activation credential', async () => {
  const patient = await createPatient('+250788200002');
  assert.equal((await issue(patient.id, doctorToken)).status, 403);
  assert.equal((await api.post(`/api/patient-auth/claims/${patient.id}/code`)).status, 401);
  const issued = await issue(patient.id, receptionToken);
  assert.equal(issued.status, 201);
  assert.match(issued.body.code, /^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{32}$/);
  const row = await prisma.patientClaimCode.findFirst({ where: { patientId: patient.id } });
  assert.equal(row.codeHash.includes(issued.body.code), false);
  assert.equal(row.attemptCount, 0);
});

test('the shared credential format accepts a fresh issued code for claim and activation, and rejects malformed input', async () => {
  const claimPatient = await createPatient('+250788200005', '1983-04-04');
  const claimIssued = await issue(claimPatient.id);
  const claimant = await prisma.user.create({ data: { username: '+250788200005', phoneNormalized: '+250788200005', passwordHash: await bcrypt.hash(password, 4), role: 'PATIENT', status: 'ACTIVE' } });
  const claimantToken = (await api.post('/api/auth/login').send({ username: claimant.phoneNormalized, password })).body.token;
  assert.equal((await api.post('/api/patient-auth/claim').set(auth(claimantToken)).send({ code: claimIssued.body.code, dateOfBirth: '1983-04-04' })).status, 200);

  const activationPatient = await createPatient('+250788200006', '1984-05-05');
  const activationIssued = await issue(activationPatient.id);
  assert.equal((await api.post('/api/patient-auth/offline-activation').send({ code: activationIssued.body.code, dateOfBirth: '1984-05-05', password })).status, 201);
  assert.equal((await api.post('/api/patient-auth/offline-activation').send({ code: 'short', dateOfBirth: '1984-05-05', password })).status, 422);
  assert.equal((await api.post('/api/patient-auth/claim').set(auth(claimantToken)).send({ code: 'short', dateOfBirth: '1984-05-05' })).status, 422);
});

test('offline activation is single-use, does not silently verify phone/email, and preserves local login', async () => {
  const patient = await createPatient('+250788200003', '1981-02-02');
  const issued = await issue(patient.id, adminToken);
  const payload = { code: issued.body.code, dateOfBirth: '1981-02-02', email: 'offline-active@example.com', password };
  const results = await Promise.all([api.post('/api/patient-auth/offline-activation').send(payload), api.post('/api/patient-auth/offline-activation').send(payload)]);
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  const user = await prisma.user.findUnique({ where: { email: payload.email }, include: { patient: true } });
  assert.equal(user.patient.id, patient.id);
  assert.equal(user.phoneVerifiedAt, null);
  assert.equal(user.emailVerifiedAt, null);
  assert.equal((await api.post('/api/auth/login').send({ username: patient.phone, password })).status, 200);
  const used = await api.post('/api/patient-auth/offline-activation').send(payload);
  assert.equal(used.status, 422);
});

test('wrong and expired activation credentials fail without attaching another patient', async () => {
  const patient = await createPatient('+250788200004', '1982-03-03');
  const issued = await issue(patient.id);
  const wrong = `${issued.body.code.slice(0, -1)}${issued.body.code.endsWith('A') ? 'B' : 'A'}`;
  const rejected = await api.post('/api/patient-auth/offline-activation').send({ code: wrong, dateOfBirth: '1982-03-03', password });
  assert.equal(rejected.status, 422);
  assert.equal((await prisma.patient.findUnique({ where: { id: patient.id } })).userId, null);
  const replacement = await issue(patient.id);
  const claim = await prisma.patientClaimCode.findUnique({ where: { publicId: replacement.body.code.split('.')[0] } });
  await prisma.patientClaimCode.update({ where: { id: claim.id }, data: { expiresAt: new Date(0) } });
  assert.equal((await api.post('/api/patient-auth/offline-activation').send({ code: replacement.body.code, dateOfBirth: '1982-03-03', password })).status, 422);
});
