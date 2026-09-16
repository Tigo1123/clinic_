import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import prisma from '../src/db.js';
import { app, shutdown } from '../src/server.js';
import { signAccessToken } from '../src/services/accessTokens.js';
import { STRUCTURED_PATIENT_NAME_FIELDS } from '../src/utils/patientName.js';
import { REFERENCE_BOOTSTRAP_STATES } from '../src/services/referenceBootstrap.js';

const api = request(app);
const password = `${randomBytes(20).toString('hex')}Aa1`;
const names = { firstNameAr: '  محمد ', fatherNameAr: ' أحمد ', grandfatherNameAr: ' علي ', familyNameAr: ' النور ', firstNameEn: ' José ', fatherNameEn: ' Ahmed ', grandfatherNameEn: ' Ali ', familyNameEn: " O’Neill " };
let sequence = 600000;
const phone = () => `+250788${++sequence}`;
const email = () => `ob-${randomUUID()}@example.test`;
const patientPayload = () => ({ ...names, dateOfBirth: '1990-01-02', gender: 'MALE', phone: phone(), addressStateId: 1 });
const portalPayload = () => ({ ...patientPayload(), email: email(), password });
const tokens = {};
const auth = (role = 'RECEPTIONIST') => ({ Authorization: `Bearer ${tokens[role]}` });
const safe = (summary) => assert.doesNotMatch(JSON.stringify(summary), /password|hash|token|authVersion|userId|mfa|verificationChallenges/i);
const verify = (registration) => api.post('/api/patient-auth/verify').send({ challengeId: registration.body.challengeId, code: registration.body.developmentCode });
async function registeredPatient() {
  const payload = portalPayload();
  const registration = await api.post('/api/patient-auth/register').send(payload);
  assert.equal(registration.status, 201);
  const verified = await verify(registration);
  assert.equal(verified.status, 200);
  const login = await api.post('/api/auth/login').send({ username: payload.email, password });
  assert.equal(login.status, 200);
  return { payload, registration, patient: verified.body.patient, token: login.body.token, userId: login.body.user.id };
}
before(async () => {
  for (const role of ['ADMIN', 'RECEPTIONIST', 'DOCTOR', 'LAB_TECH', 'PHARMACIST']) {
    const user = await prisma.user.findFirst({ where: { role } });
    tokens[role] = signAccessToken(user);
  }
});
after(async () => shutdown());

test('reception onboarding normalizes four Arabic and four Unicode Latin parts and returns a safe MRN summary', async () => {
  const response = await api.post('/api/patients').set(auth()).send(patientPayload());
  assert.equal(response.status, 201);
  assert.equal(response.body.fullNameAr, 'محمد أحمد علي النور');
  assert.equal(response.body.fullNameEn, 'José Ahmed Ali O’Neill');
  assert.equal(response.body.firstNameEn, 'José');
  assert.match(response.body.fileNumber, /^SHF-\d+$/);
  safe(response.body);
});

test('every name component is mandatory and whitespace-only parts are rejected on both onboarding paths', async () => {
  for (const field of STRUCTURED_PATIENT_NAME_FIELDS) {
    for (const value of [undefined, ' \t\n ']) {
      const body = patientPayload();
      body[field] = value;
      for (const [path, payload, headers] of [
        ['/api/patients', body, auth()],
        ['/api/patient-auth/register', { ...body, email: email(), password }, {}]
      ]) {
        const response = await api.post(path).set(headers).send(payload);
        assert.equal(response.status, 422, `${path}: ${field}`);
        assert.ok(response.body.error.details.some((issue) => issue.field === field));
      }
    }
  }
});

test('DOB calendar validation, name limits, phone validation and portal email requirement reject invalid input', async () => {
  for (const change of [
    { dateOfBirth: '1990-02-30' }, { dateOfBirth: '2023-02-29' }, { dateOfBirth: '1990-13-01' },
    { dateOfBirth: '0000-01-01' }, { dateOfBirth: '2999-01-01' }, { dateOfBirth: 'yesterday' },
    { firstNameAr: 'م'.repeat(81) }, { firstNameEn: 'A\u0000B' }, { phone: 'not-a-phone' }
  ]) {
    assert.equal((await api.post('/api/patients').set(auth()).send({ ...patientPayload(), ...change })).status, 422);
    assert.equal((await api.post('/api/patient-auth/register').send({ ...portalPayload(), ...change })).status, 422);
  }
  for (const invalid of ['', 'bad-address', undefined]) {
    assert.equal((await api.post('/api/patient-auth/register').send({ ...portalPayload(), email: invalid })).status, 422);
  }
});

test('self-registration waits for verification, creates one MRN, and repeated verification/login creates no second record', async () => {
  const payload = portalPayload();
  const registration = await api.post('/api/patient-auth/register').send(payload);
  assert.equal(registration.status, 201); assert.equal(registration.body.state, 'VERIFICATION_REQUIRED');
  assert.equal(Object.hasOwn(registration.body.identity, 'fileNumber'), false); safe(registration.body.identity);
  const user = await prisma.user.findUnique({ where: { email: payload.email } });
  assert.equal(user.status, 'PENDING_VERIFICATION');
  assert.equal(await prisma.patient.count({ where: { userId: user.id } }), 0);
  const verified = await verify(registration);
  assert.equal(verified.status, 200); assert.equal(verified.body.state, 'CLAIMED'); safe(verified.body.patient);
  assert.match(verified.body.patient.fileNumber, /^SHF-\d+$/);
  assert.equal((await verify(registration)).status, 422);
  for (let i = 0; i < 2; i++) assert.equal((await api.post('/api/auth/login').send({ username: payload.email, password })).status, 200);
  const records = await prisma.patient.findMany({ where: { userId: user.id } });
  assert.equal(records.length, 1); assert.equal(records[0].fileNumber, verified.body.patient.fileNumber);
  assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'PATIENT_FILE_CREATED', details: { contains: records[0].id } } }), 1);
});

test('address states are resolved before registration and retrying verification after reference recovery creates one Patient', async () => {
  const state = REFERENCE_BOOTSTRAP_STATES.find((candidate) => candidate.id === 18);
  await prisma.state.delete({ where: { id: state.id } });
  try {
    const rejectedPayload = { ...portalPayload(), addressStateId: state.id };
    const rejected = await api.post('/api/patient-auth/register').send(rejectedPayload);
    assert.equal(rejected.status, 422); assert.equal(rejected.body.error.code, 'INVALID_ADDRESS_STATE');
    assert.equal(await prisma.user.count({ where: { email: rejectedPayload.email } }), 0);

    await prisma.state.create({ data: state });
    const payload = { ...portalPayload(), addressStateId: state.id };
    const registration = await api.post('/api/patient-auth/register').send(payload);
    assert.equal(registration.status, 201);
    await prisma.state.delete({ where: { id: state.id } });

    const failedVerification = await verify(registration);
    assert.equal(failedVerification.status, 422); assert.equal(failedVerification.body.error.code, 'INVALID_ADDRESS_STATE');
    const pendingUser = await prisma.user.findUnique({ where: { email: payload.email } });
    const pendingChallenge = await prisma.verificationChallenge.findUnique({ where: { id: registration.body.challengeId } });
    assert.equal(pendingUser.status, 'PENDING_VERIFICATION'); assert.equal(pendingChallenge.usedAt, null);
    assert.equal(await prisma.patient.count({ where: { userId: pendingUser.id } }), 0);

    await prisma.state.create({ data: state });
    const retried = await verify(registration);
    assert.equal(retried.status, 200); assert.equal(retried.body.state, 'CLAIMED');
    const patients = await prisma.patient.findMany({ where: { userId: pendingUser.id } });
    assert.equal(patients.length, 1); assert.equal(patients[0].addressStateId, state.id);
    assert.match(patients[0].fileNumber, /^SHF-\d+$/);
    assert.equal((await verify(registration)).status, 422);
  } finally {
    await prisma.state.upsert({ where: { id: state.id }, update: {}, create: state });
  }
});

test('duplicate account phone/email conflicts are explicit, including concurrent registration', async () => {
  const payload = portalPayload();
  const results = await Promise.all([1, 2].map(() => api.post('/api/patient-auth/register').send(payload)));
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const byPhone = await api.post('/api/patient-auth/register').send({ ...payload, email: email() });
  assert.equal(byPhone.status, 409); assert.equal(byPhone.body.error.code, 'PHONE_ALREADY_REGISTERED');
  const byEmail = await api.post('/api/patient-auth/register').send({ ...payload, phone: phone(), email: ` ${payload.email.toUpperCase()} ` });
  assert.equal(byEmail.status, 409); assert.equal(byEmail.body.error.code, 'EMAIL_ALREADY_REGISTERED');
  assert.equal(await prisma.user.count({ where: { email: payload.email } }), 1);
});

test('concurrent reception duplicates are rejected without merging; shared phone with different DOB and same-name patients remain distinct', async () => {
  const body = patientPayload();
  const results = await Promise.all([1, 2].map(() => api.post('/api/patients').set(auth()).send(body)));
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(await prisma.patient.count({ where: { phone: body.phone, dateOfBirth: body.dateOfBirth } }), 1);
  const familyMember = await api.post('/api/patients').set(auth()).send({ ...body, dateOfBirth: '1991-01-02' });
  const sameName = await api.post('/api/patients').set(auth()).send({ ...body, phone: phone() });
  assert.equal(familyMember.status, 201); assert.equal(sameName.status, 201);
  assert.equal(new Set([results.find((r) => r.status === 201).body.fileNumber, familyMember.body.fileNumber, sameName.body.fileNumber]).size, 3);
});

test('simultaneous reception registration and portal verification reuse or reject one identity without a second Patient', async () => {
  const payload = portalPayload();
  const registration = await api.post('/api/patient-auth/register').send(payload);
  const { email: unusedEmail, password: unusedPassword, ...receptionBody } = payload;
  const [reception, verified] = await Promise.all([api.post('/api/patients').set(auth()).send(receptionBody), verify(registration)]);
  assert.ok([201, 409].includes(reception.status)); assert.equal(verified.status, 200);
  assert.equal(await prisma.patient.count({ where: { phone: payload.phone, dateOfBirth: payload.dateOfBirth } }), 1);
});

test('legacy duplicate lookup scans beyond the first 200 patients with the same DOB', async () => {
  const body = { ...patientPayload(), dateOfBirth: '1910-01-02' };
  await prisma.patient.createMany({ data: Array.from({ length: 205 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, fullNameAr: 'سابق', fullNameEn: 'OB1 Dense Fixture', gender: 'MALE', dateOfBirth: body.dateOfBirth, phone: phone(), addressStateId: 1, emergencyContact: 'Self' })) });
  const existing = await prisma.patient.create({ data: { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', fullNameAr: 'سابق', fullNameEn: 'OB1 Dense Fixture Match', gender: body.gender, dateOfBirth: body.dateOfBirth, phone: body.phone, addressStateId: 1, emergencyContact: 'Self' } });
  const response = await api.post('/api/patients').set(auth()).send(body);
  assert.equal(response.status, 409); assert.equal(response.body.error.details[0].id, existing.id);
});

test('staff name corrections preserve MRN, ownership and clinical history; legacy names stay unsplit until explicitly corrected', async () => {
  const fixture = await registeredPatient();
  const doctor = await prisma.doctor.findFirst();
  const appointment = await prisma.appointment.create({ data: { patientId: fixture.patient.id, doctorId: doctor.id, appointmentDate: '2020-01-01', appointmentTime: '09:00', status: 'COMPLETED' } });
  const record = await prisma.medicalRecord.create({ data: { patientId: fixture.patient.id, doctorId: doctor.id, appointmentId: appointment.id, symptomsEncrypted: 'test', diagnosisEncrypted: 'test', treatmentEncrypted: 'test', clinicalNotesEncrypted: 'test', vitalSignsJson: '{}' } });
  for (const role of ['RECEPTIONIST', 'ADMIN']) {
    const updated = await api.patch(`/api/patients/${fixture.patient.id}`).set(auth(role)).send({ ...names, firstNameEn: 'Corrected' });
    assert.equal(updated.status, 200); assert.equal(updated.body.fileNumber, fixture.patient.fileNumber);
    assert.equal(updated.body.fullNameEn, 'Corrected Ahmed Ali O’Neill'); safe(updated.body);
  }
  assert.equal((await prisma.patient.findUnique({ where: { id: fixture.patient.id } })).userId, fixture.userId);
  assert.deepEqual(await prisma.appointment.findUnique({ where: { id: appointment.id } }), appointment);
  assert.deepEqual(await prisma.medicalRecord.findUnique({ where: { id: record.id } }), record);
  const legacy = await prisma.patient.create({ data: { fullNameAr: 'اسم سابق', fullNameEn: 'Legacy Name', gender: 'MALE', dateOfBirth: '1980-01-01', phone: phone(), addressStateId: 1, emergencyContact: 'Self' } });
  const contactUpdate = await api.patch(`/api/patients/${legacy.id}`).set(auth()).send({ emergencyContact: 'Family' });
  assert.equal(contactUpdate.status, 200); assert.equal(contactUpdate.body.firstNameAr, null); assert.equal(contactUpdate.body.fullNameEn, 'Legacy Name');
  assert.equal((await api.patch(`/api/patients/${legacy.id}`).set(auth()).send({ firstNameEn: 'Partial' })).status, 422);
  const corrected = await api.patch(`/api/patients/${legacy.id}`).set(auth()).send(names);
  assert.equal(corrected.status, 200); assert.equal(corrected.body.fileNumber, legacy.fileNumber);
});

test('registration/correction roles, IDOR and protected field mass assignment fail closed', async () => {
  const fixture = await registeredPatient();
  tokens.PATIENT = fixture.token;
  for (const role of ['DOCTOR', 'LAB_TECH', 'PHARMACIST', 'PATIENT']) {
    assert.equal((await api.post('/api/patients').set(auth(role)).send(patientPayload())).status, 403);
    assert.equal((await api.patch(`/api/patients/${fixture.patient.id}`).set(auth(role)).send(names)).status, 403);
  }
  assert.equal((await api.post('/api/patients').send(patientPayload())).status, 401);
  assert.equal((await api.patch(`/api/patients/${fixture.patient.id}`).send(names)).status, 401);
  assert.equal((await api.patch('/api/patients/invalid').set(auth()).send(names)).status, 422);
  assert.equal((await api.patch(`/api/patients/${randomUUID()}`).set(auth()).send(names)).status, 404);
  for (const key of ['fileNumber', 'mrn', 'userId', 'patientId', 'role', 'status', 'passwordHash', 'authVersion', 'emailVerifiedAt', 'fullNameEn']) {
    const forbidden = { [key]: 'client-value' };
    assert.equal((await api.post('/api/patients').set(auth()).send({ ...patientPayload(), ...forbidden })).status, 422, key);
    assert.equal((await api.post('/api/patient-auth/register').send({ ...portalPayload(), ...forbidden })).status, 422, key);
    assert.equal((await api.patch(`/api/patients/${fixture.patient.id}`).set(auth()).send({ ...names, ...forbidden })).status, 422, key);
    assert.equal((await api.patch('/api/patient/me').set(auth('PATIENT')).send({ emergencyContact: 'Attack', ...forbidden })).status, 422, key);
  }
  const me = await api.get('/api/patient/me').set(auth('PATIENT'));
  assert.equal(me.status, 200); assert.equal(me.body.fileNumber, fixture.patient.fileNumber); safe(me.body);
  assert.equal((await api.patch('/api/patient/me').set(auth('PATIENT')).send(names)).status, 422);
});
