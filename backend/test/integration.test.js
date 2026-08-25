import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import * as OTPAuth from 'otpauth';
import prisma from '../src/db.js';
import { app, httpServer } from '../src/server.js';
import { validateEnvironment } from '../src/config.js';
import { emitQueueUpdate } from '../src/utils/socketEvents.js';
import { encrypt } from '../src/utils/encryption.js';
import { authenticateSocketAccessToken } from '../src/middleware/auth.js';
import {
  ACCESS_TOKEN_ALGORITHM,
  accessTokenAudience,
  accessTokenIssuer,
  signAccessToken,
  verifyAccessToken
} from '../src/services/accessTokens.js';
import { decryptMfaSecret, encryptMfaSecret } from '../src/services/mfaCrypto.js';
import { buildMedicineIdentityKey, normalizeBatchNumber } from '../src/utils/medicineManagement.js';
import {
  consumeMfaChallenge,
  createMfaChallenge,
  findMfaChallenge,
  recordMfaChallengeFailure
} from '../src/services/mfa.js';

const api = request(app);
const tokens = {};
let doctor1;
let doctor2;
let patient1;
let patient2;
let relatedAppointment;
let unrelatedAppointment;
let service;
let drug;
let fixtureCounter = 0;

async function login(username, password) {
  const response = await api.post('/api/auth/login').send({ username, password });
  assert.equal(response.status, 200);
  return response.body.token;
}

function auth(role) { return { Authorization: `Bearer ${tokens[role]}` }; }
function signTestToken(payload, options = {}) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    algorithm: ACCESS_TOKEN_ALGORITHM,
    audience: accessTokenAudience(),
    issuer: accessTokenIssuer(),
    subject: payload.id,
    expiresIn: '5m',
    ...options
  });
}
async function checkSocketToken(token) {
  const socket = { handshake: { auth: { token } } };
  const error = await new Promise((resolve) => {
    authenticateSocketAccessToken(socket, (result) => resolve(result || null));
  });
  return { socket, error };
}
function paymentAuth(role, key = `payment-test-${Date.now()}-${++fixtureCounter}`) {
  return { ...auth(role), 'Idempotency-Key': key };
}

async function createLabReviewFixture(customName, { includeStandard = true } = {}) {
  fixtureCounter += 1;
  const appointment = await prisma.appointment.create({
    data: {
      patientId: patient1.id,
      doctorId: doctor1.id,
      appointmentDate: `2035-04-${String((fixtureCounter % 27) + 1).padStart(2, '0')}`,
      appointmentTime: '14:00',
      status: 'WAITING_LAB'
    }
  });
  const record = await prisma.medicalRecord.create({
    data: {
      patientId: patient1.id,
      doctorId: doctor1.id,
      appointmentId: appointment.id,
      symptomsEncrypted: '', diagnosisEncrypted: '', treatmentEncrypted: '', vitalSignsJson: '{}', clinicalNotesEncrypted: ''
    }
  });
  const order = await prisma.labOrder.create({
    data: {
      medicalRecordId: record.id,
      patientId: patient1.id,
      doctorId: doctor1.id,
      status: 'PENDING_BILLING',
      items: {
        create: [
          ...(includeStandard ? [{ serviceId: service.id, labReviewStatus: 'NOT_REQUIRED' }] : []),
          { customTestName: customName, labReviewStatus: 'PENDING_REVIEW' }
        ]
      }
    },
    include: { items: true }
  });
  return { appointment, order, customItem: order.items.find((item) => item.customTestName === customName) };
}

async function createResultConcurrencyFixture(itemCount = 2) {
  fixtureCounter += 1;
  const appointment = await prisma.appointment.create({
    data: {
      patientId: patient1.id,
      doctorId: doctor1.id,
      appointmentDate: `2042-06-${String((fixtureCounter % 27) + 1).padStart(2, '0')}`,
      appointmentTime: `${String(8 + (fixtureCounter % 10)).padStart(2, '0')}:30`,
      status: 'WAITING_LAB'
    }
  });
  const record = await prisma.medicalRecord.create({
    data: {
      patientId: patient1.id,
      doctorId: doctor1.id,
      appointmentId: appointment.id,
      symptomsEncrypted: '', diagnosisEncrypted: '', treatmentEncrypted: '', vitalSignsJson: '{}', clinicalNotesEncrypted: ''
    }
  });
  const order = await prisma.labOrder.create({
    data: {
      medicalRecordId: record.id,
      patientId: patient1.id,
      doctorId: doctor1.id,
      status: 'SAMPLE_COLLECTED',
      items: { create: Array.from({ length: itemCount }, () => ({ serviceId: service.id })) }
    },
    include: { items: true }
  });
  return { appointment, order };
}

async function createCrossDoctorRecordFixture(label) {
  fixtureCounter += 1;
  const appointmentDate = new Date(Date.UTC(2040, 0, 1 + fixtureCounter))
    .toISOString()
    .slice(0, 10);
  const patient = await prisma.patient.create({
    data: {
      fullNameAr: `مريض صلاحيات ${label}`,
      fullNameEn: `Record Access ${label}`,
      gender: 'MALE',
      dateOfBirth: '1985-05-05',
      phone: `0992${String(fixtureCounter).padStart(6, '0')}`,
      addressStateId: 1,
      emergencyContact: 'Self'
    }
  });
  const [ownAppointment, otherAppointment] = await Promise.all([
    prisma.appointment.create({
      data: { patientId: patient.id, doctorId: doctor1.id, appointmentDate, appointmentTime: '09:00', status: 'COMPLETED' }
    }),
    prisma.appointment.create({
      data: { patientId: patient.id, doctorId: doctor2.id, appointmentDate, appointmentTime: '10:00', status: 'COMPLETED' }
    })
  ]);
  const createRecord = (doctorId, appointmentId, marker) => prisma.medicalRecord.create({
    data: {
      patientId: patient.id,
      doctorId,
      appointmentId,
      symptomsEncrypted: encrypt(`${marker} symptoms`),
      diagnosisEncrypted: encrypt(`${marker} diagnosis`),
      treatmentEncrypted: encrypt(`${marker} treatment`),
      clinicalNotesEncrypted: encrypt(`${marker} notes`),
      vitalSignsJson: '{}'
    }
  });
  const [ownRecord, otherRecord] = await Promise.all([
    createRecord(doctor1.id, ownAppointment.id, `${label}-own`),
    createRecord(doctor2.id, otherAppointment.id, `${label}-other`)
  ]);
  return { patient, ownRecord, otherRecord };
}

test('queue socket updates target operational staff rooms only', () => {
  const rooms = [];
  let emitted;
  const io = {
    to(room) { rooms.push(room); return this; },
    emit(event, payload) { emitted = { event, payload }; }
  };
  emitQueueUpdate(io, { type: 'STATUS_UPDATE' }, ['doctor-1', 'doctor-1']);
  assert.deepEqual(rooms, ['role_ADMIN', 'role_RECEPTIONIST', 'doctor_doctor-1']);
  assert.deepEqual(emitted, { event: 'queueUpdated', payload: { type: 'STATUS_UPDATE' } });
  assert.ok(!rooms.some((room) => room.startsWith('user_') || room === 'role_PATIENT'));
});

before(async () => {
  tokens.admin = await login('admin@cms.com', 'Admin@123');
  tokens.reception = await login('recep@cms.com', 'Receptionist@123');
  tokens.doctor = await login('doctor@cms.com', 'Doctor@123');
  tokens.lab = await login('lab@cms.com', 'Labtech@123');
  tokens.pharmacy = await login('pharma@cms.com', 'Pharmacist@123');
  doctor1 = await prisma.doctor.findFirst({ where: { user: { username: 'doctor@cms.com' } } });
  doctor2 = await prisma.doctor.findFirst({ where: { user: { username: 'doctor_cardio@cms.com' } } });
  service = await prisma.clinicalService.findFirst({ where: { category: 'LABORATORY' } });
  drug = await prisma.drugFormulary.findFirst();
  patient1 = await prisma.patient.create({ data: { fullNameAr: 'مريض اختبار أ', fullNameEn: 'Test Patient A', gender: 'MALE', dateOfBirth: '1990-01-01', phone: '0991000001', addressStateId: 1, emergencyContact: 'Self' } });
  patient2 = await prisma.patient.create({ data: { fullNameAr: 'مريض اختبار ب', fullNameEn: 'Test Patient B', gender: 'FEMALE', dateOfBirth: '1992-02-02', phone: '0991000002', addressStateId: 1, emergencyContact: 'Self' } });
  relatedAppointment = await prisma.appointment.create({ data: { patientId: patient1.id, doctorId: doctor1.id, appointmentDate: '2030-01-06', appointmentTime: '09:00', status: 'IN_CONSULTATION' } });
  unrelatedAppointment = await prisma.appointment.create({ data: { patientId: patient2.id, doctorId: doctor2.id, appointmentDate: '2030-01-06', appointmentTime: '09:15', status: 'IN_CONSULTATION' } });
});

after(async () => {
  await prisma.$disconnect();
  if (httpServer.listening) await new Promise((resolve) => httpServer.close(resolve));
});

test('staff login succeeds with valid credentials', async () => {
  const response = await api.post('/api/auth/login').send({ username: 'admin@cms.com', password: 'Admin@123' });
  assert.equal(response.status, 200);
  assert.equal(response.body.user.role, 'ADMIN');
  const claims = verifyAccessToken(response.body.token);
  assert.equal(claims.typ, 'access');
  assert.equal(claims.iss, accessTokenIssuer());
  assert.equal(claims.aud, accessTokenAudience());
  assert.equal(claims.sub, response.body.user.id);
  assert.equal(claims.av, 0);
});

test('strict access-token contract protects HTTP authentication', async () => {
  const admin = await prisma.user.findUnique({ where: { username: 'admin@cms.com' } });
  const baseClaims = { id: admin.id, username: admin.username, role: admin.role, av: admin.authVersion };
  const protectedPath = '/api/auth/users';

  assert.equal((await api.get(protectedPath).set(auth('admin'))).status, 200);

  const invalidTokens = [
    signTestToken({ ...baseClaims, typ: 'mfa_challenge' }),
    signTestToken({ id: baseClaims.id, username: baseClaims.username, role: baseClaims.role }),
    signTestToken({ id: baseClaims.id, username: baseClaims.username, role: baseClaims.role, typ: 'access' }),
    ...[null, '0', -1, 0.5, Number.MAX_SAFE_INTEGER + 1].map((av) => signTestToken({ ...baseClaims, typ: 'access', av })),
    signTestToken({ ...baseClaims, typ: 'access' }, { issuer: 'wrong-issuer' }),
    signTestToken({ ...baseClaims, typ: 'access' }, { audience: 'wrong-audience' }),
    signTestToken({ ...baseClaims, typ: 'access' }, { expiresIn: -1 }),
    jwt.sign(
      { ...baseClaims, typ: 'access' },
      process.env.JWT_SECRET,
      { algorithm: 'HS384', issuer: accessTokenIssuer(), audience: accessTokenAudience(), subject: admin.id, expiresIn: '5m' }
    )
  ];

  for (const token of invalidTokens) {
    const response = await api.get(protectedPath).set({ Authorization: `Bearer ${token}` });
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'INVALID_TOKEN');
  }

  const tampered = `${tokens.admin.slice(0, -2)}aa`;
  assert.equal((await api.get(protectedPath).set({ Authorization: `Bearer ${tampered}` })).status, 401);
});

test('active-user and role consistency remain enforced for access tokens', async () => {
  const reception = await prisma.user.findUnique({ where: { username: 'recep@cms.com' } });
  const roleMismatch = signAccessToken({ id: reception.id, username: reception.username, role: 'ADMIN', authVersion: reception.authVersion });
  let response = await api.get('/api/auth/users').set({ Authorization: `Bearer ${roleMismatch}` });
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'SESSION_REVOKED');

  await prisma.user.update({ where: { id: reception.id }, data: { status: 'INACTIVE' } });
  try {
    response = await api.get('/api/patients').set(auth('reception'));
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'SESSION_REVOKED');
  } finally {
    await prisma.user.update({ where: { id: reception.id }, data: { status: 'ACTIVE' } });
  }

  const deleted = await prisma.user.create({
    data: {
      username: `deleted-token-${Date.now()}@example.test`,
      passwordHash: await bcrypt.hash('DeletedUserPass123', 10),
      role: 'RECEPTIONIST'
    }
  });
  const deletedToken = signAccessToken({
    id: deleted.id, username: deleted.username, role: deleted.role, authVersion: deleted.authVersion
  });
  await prisma.user.delete({ where: { id: deleted.id } });
  const deletedResponse = await api.get('/api/patients').set({ Authorization: `Bearer ${deletedToken}` });
  assert.equal(deletedResponse.status, 401);
  assert.equal(deletedResponse.body.error.code, 'SESSION_REVOKED');
});

test('authVersion revokes every prior HTTP token and permits only the current generation', async () => {
  const user = await prisma.user.create({
    data: {
      username: `versioned-${Date.now()}@example.test`,
      passwordHash: await bcrypt.hash('VersionedPass123', 10),
      role: 'RECEPTIONIST',
      status: 'ACTIVE',
      authVersion: 7
    }
  });
  const identity = { id: user.id, username: user.username, role: user.role, authVersion: user.authVersion };
  const oldTokens = [signAccessToken(identity), signAccessToken(identity)];
  for (const token of oldTokens) {
    assert.equal((await api.get('/api/patients').set({ Authorization: `Bearer ${token}` })).status, 200);
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { authVersion: { increment: 1 } }
  });
  for (const token of oldTokens) {
    const rejected = await api.get('/api/patients').set({ Authorization: `Bearer ${token}` });
    assert.equal(rejected.status, 401);
    assert.equal(rejected.body.error.code, 'SESSION_REVOKED');
  }
  for (const authVersion of [updated.authVersion - 1, updated.authVersion + 1]) {
    const mismatched = signAccessToken({ ...identity, authVersion });
    const rejected = await api.get('/api/patients').set({ Authorization: `Bearer ${mismatched}` });
    assert.equal(rejected.status, 401);
    assert.equal(rejected.body.error.code, 'SESSION_REVOKED');
  }
  const currentToken = signAccessToken({ ...identity, authVersion: updated.authVersion });
  assert.equal((await api.get('/api/patients').set({ Authorization: `Bearer ${currentToken}` })).status, 200);
});

test('WebSocket authentication uses the strict access-token contract', async () => {
  const valid = await checkSocketToken(tokens.doctor);
  assert.equal(valid.error, null);
  assert.equal(valid.socket.user.typ, 'access');
  assert.equal(valid.socket.user.role, 'DOCTOR');

  const doctor = await prisma.user.findUnique({ where: { username: 'doctor@cms.com' } });
  const baseClaims = { id: doctor.id, username: doctor.username, role: doctor.role, av: doctor.authVersion };
  for (const token of [
    signTestToken({ ...baseClaims, typ: 'mfa_challenge' }),
    signTestToken({ id: baseClaims.id, username: baseClaims.username, role: baseClaims.role, typ: 'access' }),
    signTestToken({ ...baseClaims, typ: 'access' }, { issuer: 'wrong-issuer' }),
    signTestToken({ ...baseClaims, typ: 'access' }, { audience: 'wrong-audience' })
  ]) {
    const rejected = await checkSocketToken(token);
    assert.ok(rejected.error instanceof Error);
    assert.equal(rejected.socket.user, undefined);
  }

  const staleToken = signAccessToken({
    id: doctor.id, username: doctor.username, role: doctor.role, authVersion: doctor.authVersion
  });
  await prisma.user.update({ where: { id: doctor.id }, data: { authVersion: { increment: 1 } } });
  try {
    assert.ok((await checkSocketToken(staleToken)).error instanceof Error);
    // Existing sockets retain their already-authenticated in-memory identity;
    // distributed active-socket revocation remains SEC-FINAL-003B.
    assert.equal(valid.socket.user.av, doctor.authVersion);
    const currentDoctor = await prisma.user.findUnique({ where: { id: doctor.id } });
    const currentToken = signAccessToken({
      id: currentDoctor.id, username: currentDoctor.username, role: currentDoctor.role, authVersion: currentDoctor.authVersion
    });
    assert.equal((await checkSocketToken(currentToken)).error, null);
  } finally {
    await prisma.user.update({ where: { id: doctor.id }, data: { authVersion: doctor.authVersion } });
  }
});

test('staff MFA enrollment, enforced login, recovery, challenge, and disable lifecycle is secure', async () => {
  const username = `mfa-staff-${Date.now()}@example.test`;
  const password = 'MfaFoundationPass123';
  const passwordHash = await bcrypt.hash(password, 10);
  const staff = await prisma.user.create({
    data: { username, passwordHash, role: 'RECEPTIONIST', status: 'ACTIVE', preferredLanguage: 'en' }
  });
  const patient = await prisma.user.create({
    data: { username: `mfa-patient-${Date.now()}@example.test`, passwordHash, role: 'PATIENT', status: 'ACTIVE', preferredLanguage: 'en' }
  });
  let staffToken = signAccessToken({ id: staff.id, username: staff.username, role: staff.role, authVersion: staff.authVersion });
  const patientToken = signAccessToken({ id: patient.id, username: patient.username, role: patient.role, authVersion: patient.authVersion });

  assert.equal((await api.post('/api/auth/mfa/enroll').send({ currentPassword: password })).status, 401);
  assert.equal((await api.post('/api/auth/mfa/enroll').set({ Authorization: `Bearer ${patientToken}` }).send({ currentPassword: password })).status, 403);
  assert.equal((await api.post('/api/auth/mfa/enroll').set({ Authorization: `Bearer ${staffToken}` }).send({ currentPassword: 'wrong-password' })).status, 401);

  const firstEnrollment = await api.post('/api/auth/mfa/enroll')
    .set({ Authorization: `Bearer ${staffToken}` }).send({ currentPassword: password });
  assert.equal(firstEnrollment.status, 201);
  assert.equal(firstEnrollment.body.state, 'PENDING');
  let configuration = await prisma.mfaConfiguration.findUnique({ where: { userId: staff.id } });
  assert.equal(configuration.state, 'PENDING');
  assert.equal((await prisma.user.findUnique({ where: { id: staff.id } })).mfaEnabled, false);
  assert.notEqual(configuration.secretEncrypted, firstEnrollment.body.secret);
  assert.equal(configuration.secretEncrypted.includes(firstEnrollment.body.secret), false);
  assert.equal(decryptMfaSecret(configuration.secretEncrypted, staff.id), firstEnrollment.body.secret);

  const totpFor = (secret) => new OTPAuth.TOTP({
    issuer: process.env.MFA_TOTP_ISSUER || 'Clinic Management System',
    label: username, algorithm: 'SHA1', digits: 6, period: 30,
    secret: OTPAuth.Secret.fromBase32(secret)
  });
  await prisma.mfaConfiguration.update({
    where: { userId: staff.id }, data: { enrollmentExpiresAt: new Date(Date.now() - 1) }
  });
  let confirmation = await api.post('/api/auth/mfa/enroll/confirm')
    .set({ Authorization: `Bearer ${staffToken}` }).send({ code: totpFor(firstEnrollment.body.secret).generate() });
  assert.equal(confirmation.status, 422);
  assert.equal(confirmation.body.error.code, 'MFA_ENROLLMENT_EXPIRED');

  const secondEnrollment = await api.post('/api/auth/mfa/enroll')
    .set({ Authorization: `Bearer ${staffToken}` }).send({ currentPassword: password });
  assert.equal(secondEnrollment.status, 201);
  assert.notEqual(secondEnrollment.body.secret, firstEnrollment.body.secret);

  const duplicateEnrollments = await Promise.all([
    api.post('/api/auth/mfa/enroll').set({ Authorization: `Bearer ${staffToken}` }).send({ currentPassword: password }),
    api.post('/api/auth/mfa/enroll').set({ Authorization: `Bearer ${staffToken}` }).send({ currentPassword: password })
  ]);
  for (const duplicate of duplicateEnrollments) {
    assert.equal(duplicate.status, 201);
    assert.equal(duplicate.body.secret, secondEnrollment.body.secret);
    assert.equal(duplicate.body.otpauthUri, secondEnrollment.body.otpauthUri);
    assert.equal(duplicate.body.expiresAt, secondEnrollment.body.expiresAt);
  }
  configuration = await prisma.mfaConfiguration.findUnique({ where: { userId: staff.id } });
  assert.equal(decryptMfaSecret(configuration.secretEncrypted, staff.id), secondEnrollment.body.secret);

  confirmation = await api.post('/api/auth/mfa/enroll/confirm')
    .set({ Authorization: `Bearer ${staffToken}` }).send({ code: totpFor(firstEnrollment.body.secret).generate() });
  assert.equal(confirmation.status, 422);
  assert.equal((await prisma.user.findUnique({ where: { id: staff.id } })).mfaEnabled, false);

  confirmation = await api.post('/api/auth/mfa/enroll/confirm')
    .set({ Authorization: `Bearer ${staffToken}` }).send({ code: totpFor(secondEnrollment.body.secret).generate() });
  assert.equal(confirmation.status, 200);
  assert.equal(confirmation.body.state, 'ENABLED');
  assert.equal(confirmation.body.recoveryCodes.length, 10);
  assert.equal(Object.hasOwn(confirmation.body, 'secret'), false);
  configuration = await prisma.mfaConfiguration.findUnique({ where: { userId: staff.id } });
  assert.equal(configuration.state, 'ACTIVE');
  assert.equal((await prisma.user.findUnique({ where: { id: staff.id } })).mfaEnabled, true);

  const storedRecovery = await prisma.mfaRecoveryCode.findMany({ where: { userId: staff.id } });
  assert.equal(storedRecovery.length, 10);
  for (const record of storedRecovery) {
    assert.equal(confirmation.body.recoveryCodes.includes(record.codeHash), false);
    assert.equal(confirmation.body.recoveryCodes.some((code) => record.codeHash.includes(code.replaceAll('-', ''))), false);
  }

  await prisma.mfaConfiguration.update({ where: { userId: staff.id }, data: { lastTotpStep: null } });
  const loginWithMfaEnabled = await api.post('/api/auth/login').send({ username, password });
  assert.equal(loginWithMfaEnabled.status, 200);
  assert.equal(loginWithMfaEnabled.body.mfaRequired, true);
  assert.equal(Object.hasOwn(loginWithMfaEnabled.body, 'token'), false);
  assert.equal(Object.hasOwn(loginWithMfaEnabled.body, 'user'), false);

  const loginChallenge = await findMfaChallenge(loginWithMfaEnabled.body.challengeToken);
  assert.equal(loginChallenge.userId, staff.id);
  assert.throws(() => verifyAccessToken(loginWithMfaEnabled.body.challengeToken));
  assert.equal((await api.get('/api/auth/users').set({ Authorization: `Bearer ${loginWithMfaEnabled.body.challengeToken}` })).status, 401);
  assert.ok((await checkSocketToken(loginWithMfaEnabled.body.challengeToken)).error instanceof Error);

  const validLoginCode = totpFor(secondEnrollment.body.secret).generate();
  const invalidLoginCode = validLoginCode === '000000' ? '000001' : '000000';
  let verification = await api.post('/api/auth/mfa/verify').send({
    challengeToken: loginWithMfaEnabled.body.challengeToken,
    code: invalidLoginCode
  });
  assert.equal(verification.status, 401);
  assert.equal(Object.hasOwn(verification.body, 'token'), false);
  assert.equal((await prisma.mfaChallenge.findUnique({ where: { id: loginChallenge.id } })).attemptCount, 1);

  verification = await api.post('/api/auth/mfa/verify').send({
    challengeToken: loginWithMfaEnabled.body.challengeToken,
    code: validLoginCode
  });
  assert.equal(verification.status, 200);
  assert.equal(verifyAccessToken(verification.body.token).typ, 'access');
  assert.equal((await api.get('/api/patients').set({ Authorization: `Bearer ${verification.body.token}` })).status, 200);
  assert.equal((await api.get('/api/auth/users').set({ Authorization: `Bearer ${verification.body.token}` })).status, 403);
  assert.notEqual((await prisma.mfaChallenge.findUnique({ where: { id: loginChallenge.id } })).usedAt, null);
  assert.equal((await api.post('/api/auth/mfa/verify').send({
    challengeToken: loginWithMfaEnabled.body.challengeToken,
    code: validLoginCode
  })).status, 401);

  const concurrentLogin = await api.post('/api/auth/login').send({ username, password });
  await prisma.mfaConfiguration.update({ where: { userId: staff.id }, data: { lastTotpStep: null } });
  const concurrentCode = totpFor(secondEnrollment.body.secret).generate();
  const concurrentResults = await Promise.all([
    api.post('/api/auth/mfa/verify').send({ challengeToken: concurrentLogin.body.challengeToken, code: concurrentCode }),
    api.post('/api/auth/mfa/verify').send({ challengeToken: concurrentLogin.body.challengeToken, code: concurrentCode })
  ]);
  assert.deepEqual(concurrentResults.map((response) => response.status).sort(), [200, 401]);

  const attemptLimitedLogin = await api.post('/api/auth/login').send({ username, password });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const failedAttempt = await api.post('/api/auth/mfa/verify').send({
      challengeToken: attemptLimitedLogin.body.challengeToken,
      code: invalidLoginCode
    });
    assert.equal(failedAttempt.status, 401);
    assert.equal(failedAttempt.body.error.code, attempt === 4 ? 'MFA_CHALLENGE_INVALID' : 'MFA_CODE_INVALID');
  }
  assert.equal(await findMfaChallenge(attemptLimitedLogin.body.challengeToken), null);

  const expiredLogin = await api.post('/api/auth/login').send({ username, password });
  const expiredLoginChallenge = await findMfaChallenge(expiredLogin.body.challengeToken);
  await prisma.mfaChallenge.update({ where: { id: expiredLoginChallenge.id }, data: { expiresAt: new Date(Date.now() - 1) } });
  assert.equal((await api.post('/api/auth/mfa/verify').send({
    challengeToken: expiredLogin.body.challengeToken,
    code: validLoginCode
  })).status, 401);

  const inactiveLogin = await api.post('/api/auth/login').send({ username, password });
  await prisma.user.update({ where: { id: staff.id }, data: { status: 'INACTIVE' } });
  try {
    assert.equal((await api.post('/api/auth/mfa/verify').send({
      challengeToken: inactiveLogin.body.challengeToken,
      code: validLoginCode
    })).status, 401);
  } finally {
    await prisma.user.update({ where: { id: staff.id }, data: { status: 'ACTIVE' } });
  }

  const changedRoleLogin = await api.post('/api/auth/login').send({ username, password });
  await prisma.user.update({ where: { id: staff.id }, data: { role: 'PHARMACIST' } });
  await prisma.mfaConfiguration.update({ where: { userId: staff.id }, data: { lastTotpStep: null } });
  try {
    const changedRoleVerification = await api.post('/api/auth/mfa/verify').send({
      challengeToken: changedRoleLogin.body.challengeToken,
      code: totpFor(secondEnrollment.body.secret).generate()
    });
    assert.equal(changedRoleVerification.status, 200);
    assert.equal(verifyAccessToken(changedRoleVerification.body.token).role, 'PHARMACIST');
  } finally {
    await prisma.user.update({ where: { id: staff.id }, data: { role: 'RECEPTIONIST' } });
  }

  assert.equal((await api.post('/api/auth/mfa/verify').send({
    challengeToken: 'A'.repeat(43),
    code: validLoginCode
  })).status, 401);
  const tamperedChallenge = `${changedRoleLogin.body.challengeToken.slice(0, -1)}${changedRoleLogin.body.challengeToken.endsWith('A') ? 'B' : 'A'}`;
  assert.equal((await api.post('/api/auth/mfa/verify').send({
    challengeToken: tamperedChallenge,
    code: validLoginCode
  })).status, 401);

  const recoveryChallengeFor = async () => {
    const response = await api.post('/api/auth/login').send({ username, password });
    assert.equal(response.status, 200);
    assert.equal(response.body.mfaRequired, true);
    assert.equal(Object.hasOwn(response.body, 'token'), false);
    return response;
  };
  const verifyRecovery = (loginResponse, recoveryCode) => api.post('/api/auth/mfa/recovery/verify').send({
    challengeToken: loginResponse.body.challengeToken,
    recoveryCode
  });

  const recoveryLogin = await recoveryChallengeFor();
  let recoveryVerification = await verifyRecovery(recoveryLogin, confirmation.body.recoveryCodes[2]);
  assert.equal(recoveryVerification.status, 200);
  assert.equal(recoveryVerification.body.authenticationMethod, 'RECOVERY_CODE');
  assert.equal(verifyAccessToken(recoveryVerification.body.token).typ, 'access');
  assert.equal((await api.get('/api/patients').set({ Authorization: `Bearer ${recoveryVerification.body.token}` })).status, 200);
  assert.notEqual((await prisma.mfaChallenge.findUnique({ where: { tokenHash: crypto.createHash('sha256').update(recoveryLogin.body.challengeToken).digest('hex') } })).usedAt, null);
  assert.equal((await verifyRecovery(recoveryLogin, confirmation.body.recoveryCodes[2])).status, 401);

  const reusedCodeLogin = await recoveryChallengeFor();
  const usedBefore = await prisma.mfaRecoveryCode.count({ where: { userId: staff.id, usedAt: { not: null } } });
  recoveryVerification = await verifyRecovery(reusedCodeLogin, confirmation.body.recoveryCodes[2]);
  assert.equal(recoveryVerification.status, 401);
  assert.equal(Object.hasOwn(recoveryVerification.body, 'token'), false);
  assert.equal(await prisma.mfaRecoveryCode.count({ where: { userId: staff.id, usedAt: { not: null } } }), usedBefore);

  const concurrentRecoveryLogin = await recoveryChallengeFor();
  const concurrentRecoveryResults = await Promise.all([
    verifyRecovery(concurrentRecoveryLogin, confirmation.body.recoveryCodes[3]),
    verifyRecovery(concurrentRecoveryLogin, confirmation.body.recoveryCodes[3])
  ]);
  assert.deepEqual(concurrentRecoveryResults.map((response) => response.status).sort(), [200, 401]);

  const crossChallengeA = await createMfaChallenge(staff.id, staff.authVersion);
  const crossChallengeBToken = crypto.randomBytes(32).toString('base64url');
  const crossChallengeB = await prisma.mfaChallenge.create({
    data: {
      userId: staff.id,
      purpose: 'LOGIN',
      authVersion: staff.authVersion,
      tokenHash: crypto.createHash('sha256').update(crossChallengeBToken).digest('hex'),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      maxAttempts: 5
    }
  });
  const crossChallengeCode = confirmation.body.recoveryCodes[8];
  const usedBeforeCrossChallengeRace = await prisma.mfaRecoveryCode.count({
    where: { userId: staff.id, usedAt: { not: null } }
  });
  const crossChallengeResults = await Promise.all([
    verifyRecovery({ body: { challengeToken: crossChallengeA.token } }, crossChallengeCode),
    verifyRecovery({ body: { challengeToken: crossChallengeBToken } }, crossChallengeCode)
  ]);
  assert.deepEqual(crossChallengeResults.map((response) => response.status).sort(), [200, 401]);
  assert.equal(crossChallengeResults.filter((response) => typeof response.body.token === 'string').length, 1);
  assert.equal(crossChallengeResults.filter((response) => response.status === 401 && !Object.hasOwn(response.body, 'token')).length, 1);
  assert.equal(await prisma.mfaRecoveryCode.count({ where: { userId: staff.id, usedAt: { not: null } } }), usedBeforeCrossChallengeRace + 1);
  assert.equal(await prisma.mfaChallenge.count({
    where: { id: { in: [crossChallengeA.challengeId, crossChallengeB.id] }, usedAt: { not: null } }
  }), 1);

  for (const recoveryCode of confirmation.body.recoveryCodes.slice(4, 6)) {
    const distinctCodeLogin = await recoveryChallengeFor();
    assert.equal((await verifyRecovery(distinctCodeLogin, recoveryCode)).status, 200);
  }

  const invalidRecoveryLogin = await recoveryChallengeFor();
  const invalidRecoveryChallenge = await findMfaChallenge(invalidRecoveryLogin.body.challengeToken);
  recoveryVerification = await verifyRecovery(invalidRecoveryLogin, 'not-a-valid-recovery-code');
  assert.equal(recoveryVerification.status, 401);
  assert.equal(Object.hasOwn(recoveryVerification.body, 'token'), false);
  assert.equal((await prisma.mfaChallenge.findUnique({ where: { id: invalidRecoveryChallenge.id } })).attemptCount, 1);

  const expiredRecoveryLogin = await recoveryChallengeFor();
  const expiredRecoveryChallenge = await findMfaChallenge(expiredRecoveryLogin.body.challengeToken);
  await prisma.mfaChallenge.update({ where: { id: expiredRecoveryChallenge.id }, data: { expiresAt: new Date(Date.now() - 1) } });
  assert.equal((await verifyRecovery(expiredRecoveryLogin, confirmation.body.recoveryCodes[6])).status, 401);
  const recoveryAfterExpiry = await recoveryChallengeFor();
  assert.equal((await verifyRecovery(recoveryAfterExpiry, confirmation.body.recoveryCodes[6])).status, 200);

  const exhaustedRecoveryLogin = await recoveryChallengeFor();
  const exhaustedRecoveryChallenge = await findMfaChallenge(exhaustedRecoveryLogin.body.challengeToken);
  await prisma.mfaChallenge.update({ where: { id: exhaustedRecoveryChallenge.id }, data: { attemptCount: 5 } });
  assert.equal((await verifyRecovery(exhaustedRecoveryLogin, confirmation.body.recoveryCodes[7])).status, 401);

  const disabledRecoveryLogin = await recoveryChallengeFor();
  await prisma.user.update({ where: { id: staff.id }, data: { mfaEnabled: false } });
  try {
    assert.equal((await verifyRecovery(disabledRecoveryLogin, confirmation.body.recoveryCodes[7])).status, 401);
  } finally {
    await prisma.user.update({ where: { id: staff.id }, data: { mfaEnabled: true } });
  }

  const inactiveRecoveryLogin = await recoveryChallengeFor();
  await prisma.user.update({ where: { id: staff.id }, data: { status: 'INACTIVE' } });
  try {
    assert.equal((await verifyRecovery(inactiveRecoveryLogin, confirmation.body.recoveryCodes[7])).status, 401);
  } finally {
    await prisma.user.update({ where: { id: staff.id }, data: { status: 'ACTIVE' } });
  }

  const roleChangedRecoveryLogin = await recoveryChallengeFor();
  await prisma.user.update({ where: { id: staff.id }, data: { role: 'PHARMACIST' } });
  try {
    recoveryVerification = await verifyRecovery(roleChangedRecoveryLogin, confirmation.body.recoveryCodes[7]);
    assert.equal(recoveryVerification.status, 200);
    assert.equal(verifyAccessToken(recoveryVerification.body.token).role, 'PHARMACIST');
  } finally {
    await prisma.user.update({ where: { id: staff.id }, data: { role: 'RECEPTIONIST' } });
  }

  const mfaStateBeforeVersionChange = await prisma.mfaConfiguration.findUnique({ where: { userId: staff.id } });
  const recoveryCountBeforeVersionChange = await prisma.mfaRecoveryCode.count({ where: { userId: staff.id } });
  const legacyChallengeToken = crypto.randomBytes(32).toString('base64url');
  const legacyChallenge = await prisma.mfaChallenge.create({
    data: {
      userId: staff.id,
      purpose: 'LOGIN',
      authVersion: null,
      tokenHash: crypto.createHash('sha256').update(legacyChallengeToken).digest('hex'),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      maxAttempts: 5
    }
  });
  const legacyVerification = await api.post('/api/auth/mfa/verify').send({
    challengeToken: legacyChallengeToken,
    code: totpFor(secondEnrollment.body.secret).generate()
  });
  assert.equal(legacyVerification.status, 401);
  assert.equal(Object.hasOwn(legacyVerification.body, 'token'), false);
  assert.notEqual((await prisma.mfaChallenge.findUnique({ where: { id: legacyChallenge.id } })).usedAt, null);

  const preVersionTotpChallenge = await recoveryChallengeFor();
  const preVersionRecoveryToken = crypto.randomBytes(32).toString('base64url');
  const preVersionRecoveryChallenge = await prisma.mfaChallenge.create({
    data: {
      userId: staff.id,
      purpose: 'LOGIN',
      authVersion: staff.authVersion,
      tokenHash: crypto.createHash('sha256').update(preVersionRecoveryToken).digest('hex'),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      maxAttempts: 5
    }
  });
  const staleRecoveryCode = confirmation.body.recoveryCodes[0];
  const staleRecoveryRecord = await prisma.mfaRecoveryCode.findMany({
    where: { userId: staff.id, usedAt: null },
    select: { id: true, codeHash: true }
  }).then(async (records) => {
    for (const record of records) if (await bcrypt.compare(staleRecoveryCode.replaceAll('-', ''), record.codeHash)) return record;
    return null;
  });
  assert.ok(staleRecoveryRecord);
  const versionedStaff = await prisma.user.update({
    where: { id: staff.id },
    data: { authVersion: { increment: 1 } }
  });
  for (const staleMfaToken of [verification.body.token, recoveryVerification.body.token]) {
    assert.equal((await api.get('/api/patients').set({ Authorization: `Bearer ${staleMfaToken}` })).status, 401);
  }
  assert.equal((await prisma.mfaConfiguration.findUnique({ where: { userId: staff.id } })).secretEncrypted, mfaStateBeforeVersionChange.secretEncrypted);
  assert.equal(await prisma.mfaRecoveryCode.count({ where: { userId: staff.id } }), recoveryCountBeforeVersionChange);

  await prisma.mfaConfiguration.update({ where: { userId: staff.id }, data: { lastTotpStep: null } });
  const staleVersionVerification = await api.post('/api/auth/mfa/verify').send({
    challengeToken: preVersionTotpChallenge.body.challengeToken,
    code: totpFor(secondEnrollment.body.secret).generate()
  });
  assert.equal(staleVersionVerification.status, 401);
  assert.equal(Object.hasOwn(staleVersionVerification.body, 'token'), false);
  const staleRecoveryVerification = await api.post('/api/auth/mfa/recovery/verify').send({
    challengeToken: preVersionRecoveryToken,
    recoveryCode: staleRecoveryCode
  });
  assert.equal(staleRecoveryVerification.status, 401);
  assert.equal(Object.hasOwn(staleRecoveryVerification.body, 'token'), false);
  assert.equal((await prisma.mfaRecoveryCode.findUnique({ where: { id: staleRecoveryRecord.id } })).usedAt, null);
  assert.notEqual((await prisma.mfaChallenge.findUnique({ where: { id: preVersionRecoveryChallenge.id } })).usedAt, null);

  await assert.rejects(
    createMfaChallenge(staff.id, staff.authVersion),
    (error) => error?.code === 'MFA_CREDENTIALS_CHANGED'
  );

  const currentVersionLogin = await recoveryChallengeFor();
  const currentVersionChallenge = await findMfaChallenge(currentVersionLogin.body.challengeToken);
  assert.equal(currentVersionChallenge.authVersion, versionedStaff.authVersion);
  const currentVersionVerification = await api.post('/api/auth/mfa/verify').send({
    challengeToken: currentVersionLogin.body.challengeToken,
    code: totpFor(secondEnrollment.body.secret).generate()
  });
  assert.equal(currentVersionVerification.status, 200);
  assert.equal(verifyAccessToken(currentVersionVerification.body.token).av, versionedStaff.authVersion);
  assert.equal((await api.get('/api/patients').set({ Authorization: `Bearer ${currentVersionVerification.body.token}` })).status, 200);
  staffToken = currentVersionVerification.body.token;

  const currentVersionRecoveryLogin = await recoveryChallengeFor();
  const currentVersionRecovery = await verifyRecovery(currentVersionRecoveryLogin, confirmation.body.recoveryCodes[0]);
  assert.equal(currentVersionRecovery.status, 200);
  assert.equal(verifyAccessToken(currentVersionRecovery.body.token).av, versionedStaff.authVersion);
  assert.equal((await api.get('/api/patients').set({ Authorization: `Bearer ${currentVersionRecovery.body.token}` })).status, 200);

  const challenge = await createMfaChallenge(staff.id, versionedStaff.authVersion);
  assert.equal((await findMfaChallenge(challenge.token)).userId, staff.id);
  assert.throws(() => verifyAccessToken(challenge.token));
  assert.equal((await api.get('/api/auth/users').set({ Authorization: `Bearer ${challenge.token}` })).status, 401);
  assert.ok((await checkSocketToken(challenge.token)).error instanceof Error);
  assert.equal(await consumeMfaChallenge(challenge.challengeId, patient.id), false);
  const consumed = await Promise.all([
    consumeMfaChallenge(challenge.challengeId, staff.id),
    consumeMfaChallenge(challenge.challengeId, staff.id)
  ]);
  assert.deepEqual(consumed.sort(), [false, true]);

  const limited = await createMfaChallenge(staff.id, versionedStaff.authVersion);
  const limitedRecord = await findMfaChallenge(limited.token);
  for (let attempt = 0; attempt < 5; attempt += 1) await recordMfaChallengeFailure(limitedRecord.id);
  assert.equal(await findMfaChallenge(limited.token), null);

  const expired = await createMfaChallenge(staff.id, versionedStaff.authVersion);
  await prisma.mfaChallenge.update({ where: { id: expired.challengeId }, data: { expiresAt: new Date(Date.now() - 1) } });
  assert.equal(await findMfaChallenge(expired.token), null);

  let regenerate = await api.post('/api/auth/mfa/recovery/regenerate')
    .set({ Authorization: `Bearer ${staffToken}` })
    .send({ currentPassword: 'wrong-password', recoveryCode: confirmation.body.recoveryCodes[1] });
  assert.equal(regenerate.status, 401);
  regenerate = await api.post('/api/auth/mfa/recovery/regenerate')
    .set({ Authorization: `Bearer ${staffToken}` })
    .send({ currentPassword: password, recoveryCode: 'AAAAA-AAAAA-AAAAA-AAAAA' });
  assert.equal(regenerate.status, 401);
  regenerate = await api.post('/api/auth/mfa/recovery/regenerate')
    .set({ Authorization: `Bearer ${staffToken}` })
    .send({ currentPassword: password, recoveryCode: confirmation.body.recoveryCodes[1] });
  assert.equal(regenerate.status, 200);
  assert.equal(regenerate.body.recoveryCodes.length, 10);

  const invalidatedRecoveryLogin = await recoveryChallengeFor();
  assert.equal((await verifyRecovery(invalidatedRecoveryLogin, confirmation.body.recoveryCodes[9])).status, 401);

  let disable = await api.delete('/api/auth/mfa').set({ Authorization: `Bearer ${staffToken}` })
    .send({ currentPassword: 'wrong-password', recoveryCode: regenerate.body.recoveryCodes[0] });
  assert.equal(disable.status, 401);
  disable = await api.delete('/api/auth/mfa').set({ Authorization: `Bearer ${staffToken}` })
    .send({ currentPassword: password, recoveryCode: 'AAAAA-AAAAA-AAAAA-AAAAA' });
  assert.equal(disable.status, 401);
  disable = await api.delete('/api/auth/mfa').set({ Authorization: `Bearer ${staffToken}` })
    .send({ currentPassword: password, recoveryCode: regenerate.body.recoveryCodes[0] });
  assert.equal(disable.status, 200);
  assert.equal((await prisma.user.findUnique({ where: { id: staff.id } })).mfaEnabled, false);
  assert.equal(await prisma.mfaConfiguration.findUnique({ where: { userId: staff.id } }), null);
  assert.equal(await prisma.mfaRecoveryCode.count({ where: { userId: staff.id } }), 0);

  const audits = await prisma.tenantAuditLog.findMany({
    where: { userId: staff.id, action: { startsWith: 'MFA_' } },
    select: { action: true, details: true }
  });
  for (const action of ['MFA_ENROLLMENT_STARTED', 'MFA_ENABLED', 'MFA_ENROLLMENT_FAILED', 'MFA_CHALLENGE_CREATED', 'MFA_VERIFICATION_FAILED', 'MFA_VERIFICATION_SUCCEEDED', 'MFA_RECOVERY_LOGIN_FAILED', 'MFA_RECOVERY_LOGIN_SUCCEEDED', 'MFA_RECOVERY_CODES_REGENERATED', 'MFA_DISABLED']) {
    assert.ok(audits.some((entry) => entry.action === action));
  }
  const forbiddenValues = [firstEnrollment.body.secret, secondEnrollment.body.secret, ...confirmation.body.recoveryCodes, ...regenerate.body.recoveryCodes];
  assert.equal(audits.some((entry) => forbiddenValues.some((value) => entry.details.includes(value))), false);

  const userList = await api.get('/api/auth/users').set(auth('admin'));
  const serialized = JSON.stringify(userList.body);
  assert.equal(serialized.includes('secretEncrypted'), false);
  assert.equal(serialized.includes('codeHash'), false);
  assert.equal(serialized.includes('mfaSecret'), false);
});

test('staff login rejects invalid credentials', async () => {
  const response = await api.post('/api/auth/login').send({ username: 'admin@cms.com', password: 'wrong-password' });
  assert.equal(response.status, 401);
});

test('admin can list staff and pharmacist cannot', async () => {
  assert.equal((await api.get('/api/auth/users').set(auth('admin'))).status, 200);
  assert.equal((await api.get('/api/auth/users').set(auth('pharmacy'))).status, 403);
});

test('staff creation rejects a length-compliant password that violates the centralized policy', async () => {
  const response = await api.post('/api/auth/users').set(auth('admin')).send({
    username: 'weak-staff@cms.com',
    password: 'alllowercase1',
    role: 'RECEPTIONIST'
  });
  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.ok(response.body.error.details.some((detail) => detail.field === 'password' && /uppercase/i.test(detail.message)));
  assert.equal(await prisma.user.count({ where: { username: 'weak-staff@cms.com' } }), 0);
});

test('strong staff password is accepted and receptionist creation succeeds', async () => {
  const response = await api.post('/api/auth/users').set(auth('admin')).send({
    username: 'new-reception@cms.com',
    password: 'StrongReception1',
    role: 'RECEPTIONIST'
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.user.role, 'RECEPTIONIST');
  assert.equal(await prisma.user.count({ where: { username: 'new-reception@cms.com', role: 'RECEPTIONIST' } }), 1);
});

test('pharmacist staff creation succeeds', async () => {
  const response = await api.post('/api/auth/users').set(auth('admin')).send({
    username: 'new-pharmacist@cms.com',
    password: 'StrongPharmacy1',
    role: 'PHARMACIST'
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.user.role, 'PHARMACIST');
});

test('laboratory technician staff creation succeeds', async () => {
  const response = await api.post('/api/auth/users').set(auth('admin')).send({
    username: 'new-lab-tech@cms.com',
    password: 'StrongLabTech1',
    role: 'LAB_TECH'
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.user.role, 'LAB_TECH');
});

test('staff creation canonicalizes email usernames for every supported staff role', async () => {
  const cases = [
    ['ADMIN', ' Canonical.Admin@EXAMPLE.TEST '],
    ['RECEPTIONIST', ' Canonical.Reception@EXAMPLE.TEST '],
    ['DOCTOR', ' Canonical.Doctor@EXAMPLE.TEST '],
    ['PHARMACIST', ' Canonical.Pharmacy@EXAMPLE.TEST '],
    ['LAB_TECH', ' Canonical.Lab@EXAMPLE.TEST ']
  ];

  for (const [role, suppliedUsername] of cases) {
    const expectedUsername = suppliedUsername.trim().toLowerCase();
    const response = await api.post('/api/auth/users').set(auth('admin')).send({
      username: suppliedUsername,
      password: 'CanonicalStaff1',
      role,
      ...(role === 'DOCTOR' ? { consultationFee: 25000 } : {})
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.user.username, expectedUsername);
    assert.equal(await prisma.user.count({ where: { username: expectedUsername, role } }), 1);
    assert.equal(await prisma.tenantAuditLog.count({
      where: { action: 'USER_CREATION', details: { contains: expectedUsername } }
    }), 1);
  }
});

test('new mixed-case Doctor authenticates using canonical or supplied email casing', async () => {
  const suppliedUsername = 'Immediate.Doctor@EXAMPLE.TEST';
  const username = suppliedUsername.toLowerCase();
  const password = 'ImmediateDoctor1';
  const created = await api.post('/api/auth/users').set(auth('admin')).send({
    username: suppliedUsername,
    password,
    role: 'DOCTOR',
    consultationFee: 25000
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.username, username);
  assert.equal((await api.post('/api/auth/login').send({ username, password })).status, 200);
  assert.equal((await api.post('/api/auth/login').send({ username: suppliedUsername, password })).status, 200);
});

test('legacy case-insensitive username duplicate is rejected safely', async () => {
  const legacyUsername = 'Legacy.Duplicate@Example.Test';
  await prisma.user.create({
    data: {
      username: legacyUsername,
      passwordHash: await bcrypt.hash('LegacyDuplicate1', 10),
      role: 'RECEPTIONIST',
      status: 'ACTIVE'
    }
  });
  const response = await api.post('/api/auth/users').set(auth('admin')).send({
    username: legacyUsername.toLowerCase(),
    password: 'NewDuplicateAttempt1',
    role: 'RECEPTIONIST'
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'USERNAME_ALREADY_REGISTERED');
  assert.equal(await prisma.user.count({
    where: { username: { equals: legacyUsername, mode: 'insensitive' } }
  }), 1);
});

test('concurrent case variants create exactly one canonical staff identity', async () => {
  const mixedCase = 'Concurrent.Case@Example.Test';
  const canonical = mixedCase.toLowerCase();
  const responses = await Promise.all([
    api.post('/api/auth/users').set(auth('admin')).send({
      username: mixedCase,
      password: 'ConcurrentCase1',
      role: 'RECEPTIONIST'
    }),
    api.post('/api/auth/users').set(auth('admin')).send({
      username: canonical,
      password: 'ConcurrentCase2',
      role: 'RECEPTIONIST'
    })
  ]);
  assert.deepEqual(responses.map(({ status }) => status).sort(), [201, 409]);
  assert.equal(responses.find(({ status }) => status === 409).body.error.code, 'USERNAME_ALREADY_REGISTERED');
  assert.equal(await prisma.user.count({ where: { username: canonical } }), 1);
  assert.equal(await prisma.user.count({
    where: { username: { equals: canonical, mode: 'insensitive' } }
  }), 1);
});

test('unique legacy mixed-case staff accounts authenticate case-insensitively', async () => {
  for (const [role, username, password] of [
    ['DOCTOR', 'Legacy.Login.Doctor@Example.Test', 'LegacyDoctorLogin1'],
    ['RECEPTIONIST', 'Legacy.Login.Reception@Example.Test', 'LegacyReceptionLogin1']
  ]) {
    const user = await prisma.user.create({
      data: { username, passwordHash: await bcrypt.hash(password, 10), role, status: 'ACTIVE' }
    });
    if (role === 'DOCTOR') {
      await prisma.doctor.create({
        data: {
          userId: user.id,
          fullNameAr: 'د. حساب قديم',
          fullNameEn: 'Legacy Login Doctor',
          specialtyAr: 'طب عام',
          specialtyEn: 'General Medicine',
          consultationFee: 25000,
          weeklySchedule: '[]',
          status: 'ACTIVE'
        }
      });
    }
    assert.equal((await api.post('/api/auth/login').send({
      username: username.toLowerCase(),
      password
    })).status, 200);
  }
});

test('one User matching multiple login identifier branches remains one identity', async () => {
  const username = 'multi.branch@example.test';
  const password = 'MultipleBranches1';
  await prisma.user.create({
    data: {
      username,
      email: username,
      passwordHash: await bcrypt.hash(password, 10),
      role: 'RECEPTIONIST',
      status: 'ACTIVE'
    }
  });
  assert.equal((await api.post('/api/auth/login').send({
    username: username.toUpperCase(),
    password
  })).status, 200);
});

test('three ambiguous legacy case variants authenticate no identity through the bounded lookup', async () => {
  const lowercase = 'ambiguous.staff@example.test';
  const variants = [lowercase, 'Ambiguous.Staff@Example.Test', 'AMBIGUOUS.STAFF@EXAMPLE.TEST'];
  const password = 'AmbiguousStaff1';
  const passwordHash = await bcrypt.hash(password, 10);
  const users = await Promise.all(variants.map((username) => prisma.user.create({
    data: { username, passwordHash, role: 'RECEPTIONIST', status: 'ACTIVE' }
  })));
  const response = await api.post('/api/auth/login').send({ username: lowercase, password });
  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { error: 'Invalid username or password.' });
  const serialized = JSON.stringify(response.body);
  for (const user of users) assert.equal(serialized.includes(user.id), false);
  for (const username of variants) assert.equal(serialized.includes(username), false);
});

test('unique legacy username still rejects wrong passwords and nonexistent identifiers generically', async () => {
  const username = 'Legacy.Wrong.Password@Example.Test';
  await prisma.user.create({
    data: {
      username,
      passwordHash: await bcrypt.hash('LegacyCorrectPassword1', 10),
      role: 'RECEPTIONIST',
      status: 'ACTIVE'
    }
  });
  const wrong = await api.post('/api/auth/login').send({
    username: username.toLowerCase(),
    password: 'LegacyWrongPassword1'
  });
  const missing = await api.post('/api/auth/login').send({
    username: 'no-such-staff@example.test',
    password: 'LegacyWrongPassword1'
  });
  assert.equal(wrong.status, 401);
  assert.equal(missing.status, 401);
  assert.deepEqual(wrong.body, { error: 'Invalid username or password.' });
  assert.deepEqual(missing.body, { error: 'Invalid username or password.' });
});

test('non-doctor creation ignores empty doctor-only fields', async () => {
  const username = 'irrelevant-empty-fields@cms.com';
  const response = await api.post('/api/auth/users').set(auth('admin')).send({
    username,
    password: 'StrongIrrelevant1',
    role: 'RECEPTIONIST',
    fullNameAr: '',
    fullNameEn: '',
    specialtyAr: '',
    specialtyEn: '',
    consultationFee: ''
  });
  assert.equal(response.status, 201);
  const user = await prisma.user.findUnique({ where: { username }, include: { doctor: true } });
  assert.equal(user?.role, 'RECEPTIONIST');
  assert.equal(user?.doctor, null);
});

test('doctor creation rejects empty doctor profile fields with field-specific validation', async () => {
  const response = await api.post('/api/auth/users').set(auth('admin')).send({
    username: 'doctor-empty-fields@cms.com',
    password: 'StrongDoctor1',
    role: 'DOCTOR',
    fullNameAr: '',
    fullNameEn: '',
    specialtyAr: 'طب عام',
    specialtyEn: 'General Medicine',
    consultationFee: 25000
  });
  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.deepEqual(response.body.error.details.map(({ field }) => field).sort(), ['fullNameAr', 'fullNameEn']);
  assert.equal(response.body.error.details.some(({ message }) => message.startsWith('Too small:')), false);
  assert.equal(await prisma.user.count({ where: { username: 'doctor-empty-fields@cms.com' } }), 0);
});

test('doctor creation requires a valid consultation fee', async () => {
  const response = await api.post('/api/auth/users').set(auth('admin')).send({
    username: 'doctor-no-fee@cms.com',
    password: 'StrongDoctor1',
    role: 'DOCTOR'
  });
  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, 'CONSULTATION_FEE_REQUIRED');
  assert.equal(await prisma.user.count({ where: { username: 'doctor-no-fee@cms.com' } }), 0);
});

test('valid doctor creation atomically creates the user, profile, and audit entry', async () => {
  const username = 'new-doctor@cms.com';
  const response = await api.post('/api/auth/users').set(auth('admin')).send({
    username,
    password: 'StrongDoctor1',
    role: 'DOCTOR',
    fullNameAr: 'د. طبيب الاختبار',
    fullNameEn: 'Dr. Integration Test',
    specialtyAr: 'طب عام',
    specialtyEn: 'General Medicine',
    consultationFee: 25000
  });
  assert.equal(response.status, 201);
  const user = await prisma.user.findUnique({ where: { username }, include: { doctor: true } });
  assert.ok(user?.doctor);
  assert.equal(Number(user.doctor.consultationFee), 25000);
  assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'USER_CREATION', details: { contains: username } } }), 1);
});

test('duplicate staff username returns the standard conflict response', async () => {
  const response = await api.post('/api/auth/users').set(auth('admin')).send({
    username: 'new-reception@cms.com',
    password: 'AnotherStrong1',
    role: 'RECEPTIONIST'
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'USERNAME_ALREADY_REGISTERED');
  assert.equal(await prisma.user.count({ where: { username: 'new-reception@cms.com' } }), 1);
});

test('concurrent duplicate staff creation commits once and returns one conflict', async () => {
  const username = 'concurrent-staff@cms.com';
  const payload = { username, password: 'ConcurrentStrong1', role: 'RECEPTIONIST' };
  const responses = await Promise.all([
    api.post('/api/auth/users').set(auth('admin')).send(payload),
    api.post('/api/auth/users').set(auth('admin')).send(payload)
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  const conflict = responses.find((response) => response.status === 409);
  assert.equal(conflict.body.error.code, 'USERNAME_ALREADY_REGISTERED');
  assert.equal(await prisma.user.count({ where: { username } }), 1);
  assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'USER_CREATION', details: { contains: username } } }), 1);
});

test('an unrelated P2002 is not mislabeled as a duplicate username and rolls back', async () => {
  const existingUsername = 'unique-doctor-field-owner@cms.com';
  const attemptedUsername = 'unrelated-p2002@cms.com';
  const fullNameEn = 'Force Unrelated Unique Failure';
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX test_doctor_full_name_unique ON "Doctor" ("fullNameEn") WHERE "fullNameEn" = '${fullNameEn}'`);
  try {
    const existing = await api.post('/api/auth/users').set(auth('admin')).send({
      username: existingUsername,
      password: 'StrongUniqueOwner1',
      role: 'DOCTOR',
      fullNameEn,
      consultationFee: 25000
    });
    assert.equal(existing.status, 201);

    const response = await api.post('/api/auth/users').set(auth('admin')).send({
      username: attemptedUsername,
      password: 'StrongUniqueAttempt1',
      role: 'DOCTOR',
      fullNameEn,
      consultationFee: 25000
    });
    assert.equal(response.status, 500);
    assert.equal(response.body.error.code, 'STAFF_CREATION_FAILED');
    assert.notEqual(response.body.error.code, 'USERNAME_ALREADY_REGISTERED');
    assert.equal(await prisma.user.count({ where: { username: attemptedUsername } }), 0);
    assert.equal(await prisma.doctor.count({ where: { fullNameEn } }), 1);
    assert.equal(await prisma.tenantAuditLog.count({ where: { details: { contains: attemptedUsername } } }), 0);
  } finally {
    await prisma.$executeRawUnsafe('DROP INDEX IF EXISTS test_doctor_full_name_unique');
  }
});

test('forced doctor-profile failure rolls back the staff user', async () => {
  const username = 'rollback-doctor@cms.com';
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION fail_test_doctor_insert() RETURNS trigger AS $$
    BEGIN
      IF NEW."fullNameEn" = 'Force Doctor Failure' THEN
        RAISE EXCEPTION 'forced doctor profile failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe('CREATE TRIGGER fail_test_doctor_insert_trigger BEFORE INSERT ON "Doctor" FOR EACH ROW EXECUTE FUNCTION fail_test_doctor_insert()');
  try {
    const response = await api.post('/api/auth/users').set(auth('admin')).send({
      username,
      password: 'StrongDoctor1',
      role: 'DOCTOR',
      fullNameEn: 'Force Doctor Failure',
      consultationFee: 25000
    });
    assert.equal(response.status, 500);
    assert.equal(response.body.error.code, 'STAFF_CREATION_FAILED');
    assert.equal(await prisma.user.count({ where: { username } }), 0);
    assert.equal(await prisma.tenantAuditLog.count({ where: { details: { contains: username } } }), 0);
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_test_doctor_insert_trigger ON "Doctor"');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_test_doctor_insert()');
  }
});

test('forced audit-log failure rolls back the entire staff account', async () => {
  const username = 'rollback-audit@cms.com';
  const fullNameEn = 'Dr. Audit Rollback';
  const password = 'StrongAuditFailure1';
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION fail_test_staff_audit_insert() RETURNS trigger AS $$
    BEGIN
      IF NEW."action" = 'USER_CREATION' AND NEW."details" LIKE '%rollback-audit@cms.com%' THEN
        RAISE EXCEPTION 'forced staff audit failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe('CREATE TRIGGER fail_test_staff_audit_insert_trigger BEFORE INSERT ON "TenantAuditLog" FOR EACH ROW EXECUTE FUNCTION fail_test_staff_audit_insert()');
  try {
    const response = await api.post('/api/auth/users').set(auth('admin')).send({
      username,
      password,
      role: 'DOCTOR',
      fullNameAr: 'د. اختبار تراجع التدقيق',
      fullNameEn,
      specialtyAr: 'طب عام',
      specialtyEn: 'General Medicine',
      consultationFee: 25000
    });
    assert.equal(response.status, 500);
    assert.equal(response.body.error.code, 'STAFF_CREATION_FAILED');
    const serialized = JSON.stringify(response.body);
    assert.equal(serialized.includes(password), false);
    assert.equal(serialized.includes('passwordHash'), false);
    assert.equal(await prisma.user.count({ where: { username } }), 0);
    assert.equal(await prisma.doctor.count({ where: { fullNameEn } }), 0);
    assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'USER_CREATION', details: { contains: username } } }), 0);
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_test_staff_audit_insert_trigger ON "TenantAuditLog"');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_test_staff_audit_insert()');
  }
});

test('staff creation response and audit do not expose password material', async () => {
  const username = 'response-safe-admin@cms.com';
  const password = 'StrongResponse1';
  const response = await api.post('/api/auth/users').set(auth('admin')).send({ username, password, role: 'ADMIN' });
  assert.equal(response.status, 201);
  const serialized = JSON.stringify(response.body);
  assert.equal(serialized.includes(password), false);
  assert.equal(serialized.includes('password'), false);
  assert.equal(serialized.includes('passwordHash'), false);
  const audit = await prisma.tenantAuditLog.findFirst({ where: { action: 'USER_CREATION', details: { contains: username } } });
  assert.ok(audit);
  assert.equal(audit.details.includes(password), false);
});

test('staff creation remains restricted to authenticated administrators', async () => {
  const payload = { username: 'forbidden-staff@cms.com', password: 'StrongForbidden1', role: 'RECEPTIONIST' };
  const unauthenticated = await api.post('/api/auth/users').send(payload);
  const nonAdmin = await api.post('/api/auth/users').set(auth('pharmacy')).send(payload);
  assert.equal(unauthenticated.status, 401);
  assert.equal(nonAdmin.status, 403);
  assert.equal(await prisma.user.count({ where: { username: payload.username } }), 0);
});

test('staff password reset is ADMIN-only, rejects self-reset, missing users, and PATIENT targets', async () => {
  const target = await prisma.user.findUnique({ where: { username: 'new-reception@cms.com' } });
  const payload = { newPassword: 'ResetAuthorization1', currentAdminPassword: 'Admin@123' };
  assert.equal((await api.post(`/api/auth/users/${target.id}/reset-password`).send(payload)).status, 401);
  for (const role of ['reception', 'doctor', 'pharmacy', 'lab']) {
    assert.equal((await api.post(`/api/auth/users/${target.id}/reset-password`).set(auth(role)).send(payload)).status, 403);
  }

  const admin = await prisma.user.findUnique({ where: { username: 'admin@cms.com' } });
  const selfReset = await api.post(`/api/auth/users/${admin.id}/reset-password`).set(auth('admin')).send(payload);
  assert.equal(selfReset.status, 409);
  assert.equal(selfReset.body.error.code, 'ADMIN_SELF_RESET_UNSUPPORTED');

  const missing = await api.post('/api/auth/users/00000000-0000-4000-8000-000000000099/reset-password')
    .set(auth('admin')).send(payload);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'STAFF_USER_NOT_FOUND');

  const patient = await prisma.user.create({
    data: {
      username: 'staff-reset-patient@example.test',
      passwordHash: await bcrypt.hash('PatientResetSource1', 10),
      role: 'PATIENT',
      status: 'ACTIVE'
    }
  });
  const patientReset = await api.post(`/api/auth/users/${patient.id}/reset-password`).set(auth('admin')).send(payload);
  assert.equal(patientReset.status, 422);
  assert.equal(patientReset.body.error.code, 'STAFF_PASSWORD_RESET_UNSUPPORTED');
});

test('ADMIN reset preserves Doctor identity, replaces the hash, and revokes prior sessions', async () => {
  const username = 'password-reset-doctor@example.test';
  const oldPassword = 'StrongDoctor1';
  const newPassword = 'ResetDoctorSecure2';
  const creation = await api.post('/api/auth/users').set(auth('admin')).send({
    username,
    password: oldPassword,
    role: 'DOCTOR',
    fullNameAr: 'د. اختبار إعادة التعيين',
    fullNameEn: 'Dr. Password Reset Test',
    specialtyAr: 'طب عام',
    specialtyEn: 'General Medicine',
    consultationFee: 25000
  });
  assert.equal(creation.status, 201);
  const before = await prisma.user.findUnique({ where: { username }, include: { doctor: true } });
  const oldLogin = await api.post('/api/auth/login').send({ username, password: oldPassword });
  assert.equal(oldLogin.status, 200);

  const weak = await api.post(`/api/auth/users/${before.id}/reset-password`).set(auth('admin')).send({
    newPassword: 'alllowercase1', currentAdminPassword: 'Admin@123'
  });
  assert.equal(weak.status, 422);
  assert.equal(weak.body.error.code, 'VALIDATION_ERROR');

  const wrongProof = await api.post(`/api/auth/users/${before.id}/reset-password`).set(auth('admin')).send({
    newPassword, currentAdminPassword: 'WrongAdminPassword1'
  });
  assert.equal(wrongProof.status, 401);
  assert.equal(wrongProof.body.error.code, 'ADMIN_REAUTHENTICATION_FAILED');

  const reset = await api.post(`/api/auth/users/${before.id}/reset-password`).set(auth('admin')).send({
    newPassword, currentAdminPassword: 'Admin@123'
  });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.user.id, before.id);
  assert.equal(reset.body.user.role, 'DOCTOR');
  const serialized = JSON.stringify(reset.body);
  assert.equal(serialized.includes(newPassword), false);
  assert.equal(serialized.includes('passwordHash'), false);

  const after = await prisma.user.findUnique({ where: { id: before.id }, include: { doctor: true } });
  assert.equal(after.id, before.id);
  assert.equal(after.doctor.id, before.doctor.id);
  assert.equal(after.doctor.userId, before.id);
  assert.equal(after.authVersion, before.authVersion + 1);
  assert.ok(after.lastPasswordChange instanceof Date);
  assert.notEqual(after.passwordHash, before.passwordHash);
  assert.equal(await bcrypt.compare(newPassword, after.passwordHash), true);
  assert.equal(await prisma.doctor.count({ where: { userId: before.id } }), 1);
  assert.equal(await prisma.tenantAuditLog.count({
    where: { userId: (await prisma.user.findUnique({ where: { username: 'admin@cms.com' } })).id, action: 'STAFF_PASSWORD_RESET_BY_ADMIN', details: { contains: before.id } }
  }), 1);

  assert.equal((await api.post('/api/auth/login').send({ username, password: oldPassword })).status, 401);
  assert.equal((await api.post('/api/auth/login').send({ username, password: newPassword })).status, 200);
  const revoked = await api.post('/api/auth/mfa/enroll')
    .set({ Authorization: `Bearer ${oldLogin.body.token}` }).send({ currentPassword: newPassword });
  assert.equal(revoked.status, 401);
  assert.equal(revoked.body.error.code, 'SESSION_REVOKED');
});

test('ADMIN password reset preserves and restores lowercase login for a legacy mixed-case Doctor identity', async () => {
  const username = 'Legacy.Reset.Doctor@Example.Test';
  const oldPassword = 'LegacyResetOld1';
  const newPassword = 'LegacyResetNew1';
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: await bcrypt.hash(oldPassword, 10),
      role: 'DOCTOR',
      status: 'ACTIVE'
    }
  });
  const doctor = await prisma.doctor.create({
    data: {
      userId: user.id,
      fullNameAr: 'د. إعادة تعيين قديم',
      fullNameEn: 'Legacy Reset Doctor',
      specialtyAr: 'طب عام',
      specialtyEn: 'General Medicine',
      consultationFee: 25000,
      weeklySchedule: '[]',
      status: 'ACTIVE'
    }
  });

  const response = await api.post(`/api/auth/users/${user.id}/reset-password`)
    .set(auth('admin'))
    .send({ newPassword, currentAdminPassword: 'Admin@123' });
  assert.equal(response.status, 200);
  assert.equal((await api.post('/api/auth/login').send({
    username: username.toLowerCase(),
    password: newPassword
  })).status, 200);

  const preservedUser = await prisma.user.findUnique({ where: { id: user.id } });
  const preservedDoctor = await prisma.doctor.findUnique({ where: { userId: user.id } });
  assert.equal(preservedUser.username, username);
  assert.equal(preservedDoctor.id, doctor.id);
  assert.equal(await prisma.user.count({ where: { id: user.id } }), 1);
  assert.equal(await prisma.doctor.count({ where: { userId: user.id } }), 1);
});

test('ADMIN can reset an existing receptionist without replacing the account', async () => {
  const username = 'new-reception@cms.com';
  const before = await prisma.user.findUnique({ where: { username } });
  const response = await api.post(`/api/auth/users/${before.id}/reset-password`).set(auth('admin')).send({
    newPassword: 'ResetReceptionSecure2', currentAdminPassword: 'Admin@123'
  });
  assert.equal(response.status, 200);
  const after = await prisma.user.findUnique({ where: { username } });
  assert.equal(after.id, before.id);
  assert.equal(after.role, 'RECEPTIONIST');
  assert.equal(await prisma.user.count({ where: { username } }), 1);
  assert.equal((await api.post('/api/auth/login').send({ username, password: 'ResetReceptionSecure2' })).status, 200);
});

test('active ADMIN MFA requires and consumes a valid TOTP for staff password reset', async () => {
  const actorPassword = 'MfaResetAdministrator1';
  const actor = await prisma.user.create({
    data: {
      username: 'mfa-reset-admin@example.test',
      passwordHash: await bcrypt.hash(actorPassword, 10),
      role: 'ADMIN',
      status: 'ACTIVE',
      mfaEnabled: true
    }
  });
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  await prisma.mfaConfiguration.create({
    data: { userId: actor.id, secretEncrypted: encryptMfaSecret(secret, actor.id), state: 'ACTIVE', lastTotpStep: null }
  });
  const actorToken = signAccessToken({
    id: actor.id, username: actor.username, role: actor.role, authVersion: actor.authVersion
  });
  const target = await prisma.user.findUnique({ where: { username: 'new-lab-tech@cms.com' } });
  const endpoint = `/api/auth/users/${target.id}/reset-password`;
  const basePayload = { newPassword: 'ResetLabSecure2', currentAdminPassword: actorPassword };
  const missingProof = await api.post(endpoint).set({ Authorization: `Bearer ${actorToken}` }).send(basePayload);
  assert.equal(missingProof.status, 401);
  assert.equal(missingProof.body.error.code, 'ADMIN_REAUTHENTICATION_FAILED');
  const invalidProof = await api.post(endpoint).set({ Authorization: `Bearer ${actorToken}` }).send({ ...basePayload, mfaCode: '000000' });
  assert.equal(invalidProof.status, 401);
  assert.equal(invalidProof.body.error.code, 'ADMIN_REAUTHENTICATION_FAILED');

  const totp = new OTPAuth.TOTP({
    issuer: process.env.MFA_TOTP_ISSUER || 'Clinic Management System',
    label: actor.username,
    algorithm: 'SHA1', digits: 6, period: 30,
    secret: OTPAuth.Secret.fromBase32(secret)
  });
  const accepted = await api.post(endpoint).set({ Authorization: `Bearer ${actorToken}` })
    .send({ ...basePayload, mfaCode: totp.generate() });
  assert.equal(accepted.status, 200);
  assert.equal((await prisma.user.findUnique({ where: { id: target.id } })).authVersion, target.authVersion + 1);
});

test('concurrent ADMIN MFA activation aborts staff password reset without credential changes', async () => {
  const actorPassword = 'MfaRaceAdministrator1';
  const actor = await prisma.user.create({
    data: {
      username: 'mfa-race-admin@example.test',
      passwordHash: await bcrypt.hash(actorPassword, 10),
      role: 'ADMIN',
      status: 'ACTIVE',
      mfaEnabled: false
    }
  });
  const actorToken = signAccessToken({
    id: actor.id, username: actor.username, role: actor.role, authVersion: actor.authVersion
  });
  const target = await prisma.user.create({
    data: {
      username: 'mfa-race-reset-target@example.test',
      passwordHash: await bcrypt.hash('MfaRaceTargetOriginal1', 10),
      role: 'RECEPTIONIST',
      status: 'ACTIVE'
    }
  });
  const originalTransaction = prisma.$transaction;
  let injected = false;
  prisma.$transaction = async (...args) => {
    if (!injected) {
      injected = true;
      const secret = new OTPAuth.Secret({ size: 20 }).base32;
      await originalTransaction.call(prisma, async (tx) => {
        await tx.mfaConfiguration.create({
          data: {
            userId: actor.id,
            secretEncrypted: encryptMfaSecret(secret, actor.id),
            state: 'ACTIVE',
            lastTotpStep: null
          }
        });
        await tx.user.update({ where: { id: actor.id }, data: { mfaEnabled: true } });
      });
    }
    return originalTransaction.call(prisma, ...args);
  };
  try {
    const response = await api.post(`/api/auth/users/${target.id}/reset-password`)
      .set({ Authorization: `Bearer ${actorToken}` })
      .send({ newPassword: 'MfaRaceTargetReplacement2', currentAdminPassword: actorPassword });
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'ADMIN_REAUTHENTICATION_FAILED');
    const after = await prisma.user.findUnique({ where: { id: target.id } });
    assert.equal(after.passwordHash, target.passwordHash);
    assert.equal(after.authVersion, target.authVersion);
    assert.equal(after.lastPasswordChange, target.lastPasswordChange);
    assert.equal(await prisma.tenantAuditLog.count({
      where: { action: 'STAFF_PASSWORD_RESET_BY_ADMIN', details: { contains: target.id } }
    }), 0);
  } finally {
    prisma.$transaction = originalTransaction;
  }
});

test('concurrent staff-to-staff role change aborts reset without stale audit metadata', async () => {
  const target = await prisma.user.create({
    data: {
      username: 'role-race-reset-target@example.test',
      passwordHash: await bcrypt.hash('RoleRaceTargetOriginal1', 10),
      role: 'DOCTOR',
      status: 'ACTIVE',
      doctor: {
        create: {
          fullNameAr: 'د. اختبار تعارض الدور',
          fullNameEn: 'Dr. Role Race Test',
          specialtyAr: 'طب عام',
          specialtyEn: 'General Medicine',
          consultationFee: 25000,
          weeklySchedule: '{}'
        }
      }
    }
  });
  const originalTransaction = prisma.$transaction;
  let injected = false;
  prisma.$transaction = async (...args) => {
    if (!injected) {
      injected = true;
      await prisma.user.update({ where: { id: target.id }, data: { role: 'RECEPTIONIST' } });
    }
    return originalTransaction.call(prisma, ...args);
  };
  try {
    const response = await api.post(`/api/auth/users/${target.id}/reset-password`).set(auth('admin')).send({
      newPassword: 'RoleRaceTargetReplacement2', currentAdminPassword: 'Admin@123'
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'STAFF_PASSWORD_RESET_CONFLICT');
    const after = await prisma.user.findUnique({ where: { id: target.id } });
    assert.equal(after.role, 'RECEPTIONIST');
    assert.equal(after.passwordHash, target.passwordHash);
    assert.equal(after.authVersion, target.authVersion);
    assert.equal(after.lastPasswordChange, target.lastPasswordChange);
    assert.equal(await prisma.tenantAuditLog.count({
      where: { action: 'STAFF_PASSWORD_RESET_BY_ADMIN', details: { contains: target.id } }
    }), 0);
  } finally {
    prisma.$transaction = originalTransaction;
  }
});

test('audit failure rolls back staff password hash and authVersion', async () => {
  const username = 'audit-reset-target@example.test';
  const oldPassword = 'AuditResetOriginal1';
  const target = await prisma.user.create({
    data: { username, passwordHash: await bcrypt.hash(oldPassword, 10), role: 'RECEPTIONIST', status: 'ACTIVE' }
  });
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION fail_test_staff_password_reset_audit() RETURNS trigger AS $$
    BEGIN
      IF NEW."action" = 'STAFF_PASSWORD_RESET_BY_ADMIN' THEN
        RAISE EXCEPTION 'forced staff password reset audit failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe('CREATE TRIGGER fail_test_staff_password_reset_audit_trigger BEFORE INSERT ON "TenantAuditLog" FOR EACH ROW EXECUTE FUNCTION fail_test_staff_password_reset_audit()');
  try {
    const response = await api.post(`/api/auth/users/${target.id}/reset-password`).set(auth('admin')).send({
      newPassword: 'AuditResetReplacement2', currentAdminPassword: 'Admin@123'
    });
    assert.equal(response.status, 500);
    assert.equal(response.body.error.code, 'STAFF_PASSWORD_RESET_FAILED');
    const after = await prisma.user.findUnique({ where: { id: target.id } });
    assert.equal(after.passwordHash, target.passwordHash);
    assert.equal(after.authVersion, target.authVersion);
    assert.equal(after.lastPasswordChange, target.lastPasswordChange);
    assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'STAFF_PASSWORD_RESET_BY_ADMIN', details: { contains: target.id } } }), 0);
    assert.equal((await api.post('/api/auth/login').send({ username, password: oldPassword })).status, 200);
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_test_staff_password_reset_audit_trigger ON "TenantAuditLog"');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_test_staff_password_reset_audit()');
  }
});

test('staff status response never exposes password hash', async () => {
  const response = await api.put(`/api/auth/users/${tokens.admin ? (await prisma.user.findUnique({ where: { username: 'recep@cms.com' } })).id : ''}/status`).set(auth('admin')).send({ status: 'ACTIVE' });
  assert.equal(response.status, 200);
  assert.equal(Object.hasOwn(response.body, 'passwordHash'), false);
});

test('production environment validation rejects insecure secrets and wildcard CORS', () => {
  const previous = { ...process.env };
  try {
    Object.assign(process.env, { NODE_ENV: 'production', DATABASE_URL: 'postgresql://clinic.invalid/clinic', JWT_SECRET: 'secret', MEDICAL_ENCRYPTION_KEY: 'secret', CORS_ALLOWED_ORIGINS: '*', VERIFICATION_PROVIDER: 'disabled' });
    assert.throws(() => validateEnvironment(), /Invalid environment configuration/);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test('production environment requires a valid explicit clinic IANA timezone', () => {
  const previous = { ...process.env };
  const secure = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://clinic.invalid/clinic', JWT_SECRET: 'a-secure-jwt-secret-that-is-longer-than-32', MEDICAL_ENCRYPTION_KEY: 'a-distinct-medical-key-that-is-over-32-chars', MFA_ENCRYPTION_KEY: 'a-third-distinct-mfa-key-that-is-over-32-chars', CORS_ALLOWED_ORIGINS: 'https://clinic.example', VERIFICATION_PROVIDER: 'disabled' };
  try {
    Object.assign(process.env, secure);
    delete process.env.CLINIC_TIME_ZONE;
    assert.throws(() => validateEnvironment(), /CLINIC_TIME_ZONE is required/);
    process.env.CLINIC_TIME_ZONE = 'Not/A_Real_Zone';
    assert.throws(() => validateEnvironment(), /valid IANA timezone/);
    process.env.CLINIC_TIME_ZONE = 'Africa/Khartoum';
    assert.equal(validateEnvironment().clinicTimeZone, 'Africa/Khartoum');
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test('untrusted browser origins receive a safe CORS rejection with security headers', async () => {
  const response = await api.get('/api/health').set('Origin', 'https://untrusted.example');
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'CORS_ORIGIN_FORBIDDEN');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.ok(response.headers['x-request-id']);
});

test('patient search is limited to reception and admin', async () => {
  assert.equal((await api.get('/api/patients/search?q=Test').set(auth('reception'))).status, 200);
  assert.equal((await api.get('/api/patients/search?q=Test').set(auth('pharmacy'))).status, 403);
  assert.equal((await api.get('/api/patients/search?q=Test').set(auth('lab'))).status, 403);
});

test('reception profile excludes decrypted clinical fields', async () => {
  const response = await api.get(`/api/patients/${patient1.id}/profile`).set(auth('reception'));
  assert.equal(response.status, 200);
  assert.equal(Object.hasOwn(response.body.visits[0] || {}, 'diagnosis'), false);
});

test('pharmacist cannot retrieve complete patient profile', async () => {
  assert.equal((await api.get(`/api/patients/${patient1.id}/profile`).set(auth('pharmacy'))).status, 403);
});

test('doctor cannot access an unrelated patient', async () => {
  assert.equal((await api.get(`/api/patients/${patient2.id}/history`).set(auth('doctor'))).status, 403);
  assert.equal((await api.get(`/api/patients/${patient2.id}/profile`).set(auth('doctor'))).status, 403);
});

test('a cancelled appointment alone does not grant patient profile access', async () => {
  fixtureCounter += 1;
  const patient = await prisma.patient.create({
    data: {
      fullNameAr: 'مريض موعد ملغي', fullNameEn: 'Cancelled Appointment Patient', gender: 'FEMALE',
      dateOfBirth: '1988-08-08', phone: `0993${String(fixtureCounter).padStart(6, '0')}`,
      addressStateId: 1, emergencyContact: 'Self'
    }
  });
  await prisma.appointment.create({
    data: { patientId: patient.id, doctorId: doctor1.id, appointmentDate: '2036-02-01', appointmentTime: '09:00', status: 'CANCELLED' }
  });

  const response = await api.get(`/api/patients/${patient.id}/profile`).set(auth('doctor'));
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'PATIENT_ACCESS_FORBIDDEN');
});

test('doctor profile and history expose own records but not another doctor records', async () => {
  const fixture = await createCrossDoctorRecordFixture('default');

  const profile = await api.get(`/api/patients/${fixture.patient.id}/profile`).set(auth('doctor'));
  assert.equal(profile.status, 200);
  assert.deepEqual(profile.body.visits.map((visit) => visit.id), [fixture.ownRecord.id]);
  assert.equal(profile.body.visits[0].diagnosis, 'default-own diagnosis');

  const history = await api.get(`/api/patients/${fixture.patient.id}/history`).set(auth('doctor'));
  assert.equal(history.status, 200);
  assert.deepEqual(history.body.history.map((record) => record.id), [fixture.ownRecord.id]);
  assert.equal(history.body.history.some((record) => record.id === fixture.otherRecord.id), false);
});

test('only recent OTP-verified EMR consent permits cross-doctor records', async () => {
  const fixture = await createCrossDoctorRecordFixture('consent');

  await prisma.consent.create({
    data: { patientId: fixture.patient.id, consentType: 'EMR_ACCESS', otpVerified: false }
  });
  let profile = await api.get(`/api/patients/${fixture.patient.id}/profile`).set(auth('doctor'));
  assert.deepEqual(profile.body.visits.map((visit) => visit.id), [fixture.ownRecord.id]);

  await prisma.consent.create({
    data: {
      patientId: fixture.patient.id,
      consentType: 'EMR_ACCESS',
      otpVerified: true,
      timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000)
    }
  });
  profile = await api.get(`/api/patients/${fixture.patient.id}/profile`).set(auth('doctor'));
  assert.deepEqual(profile.body.visits.map((visit) => visit.id), [fixture.ownRecord.id]);

  await prisma.consent.create({
    data: { patientId: fixture.patient.id, consentType: 'EMR_ACCESS', otpVerified: true }
  });
  profile = await api.get(`/api/patients/${fixture.patient.id}/profile`).set(auth('doctor'));
  assert.deepEqual(new Set(profile.body.visits.map((visit) => visit.id)), new Set([fixture.ownRecord.id, fixture.otherRecord.id]));
});

test('break-glass access is patient-scoped, doctor-specific, and time-limited', async () => {
  const fixture = await createCrossDoctorRecordFixture('break-glass');
  const doctorUser = await prisma.user.findUnique({ where: { username: 'doctor@cms.com' } });

  await prisma.tenantAuditLog.create({
    data: {
      userId: doctorUser.id,
      action: `EMR_BREAK_THE_GLASS_BYPASS:${fixture.patient.id}`,
      details: 'Expired test-only emergency access grant.',
      ipAddress: '127.0.0.1',
      timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000)
    }
  });
  let profile = await api.get(`/api/patients/${fixture.patient.id}/profile`).set(auth('doctor'));
  assert.deepEqual(profile.body.visits.map((visit) => visit.id), [fixture.ownRecord.id]);

  await prisma.tenantAuditLog.create({
    data: {
      userId: doctorUser.id,
      action: `EMR_BREAK_THE_GLASS_BYPASS:${fixture.patient.id}`,
      details: 'Active test-only emergency access grant.',
      ipAddress: '127.0.0.1'
    }
  });
  profile = await api.get(`/api/patients/${fixture.patient.id}/profile`).set(auth('doctor'));
  assert.deepEqual(new Set(profile.body.visits.map((visit) => visit.id)), new Set([fixture.ownRecord.id, fixture.otherRecord.id]));
});

test('pending appointments are restricted to reception/admin', async () => {
  assert.equal((await api.get('/api/appointments/pending').set(auth('reception'))).status, 200);
  assert.equal((await api.get('/api/appointments/pending').set(auth('lab'))).status, 403);
});

test('laboratory user cannot modify appointment status', async () => {
  const response = await api.put(`/api/appointments/${relatedAppointment.id}/status`).set(auth('lab')).send({ status: 'COMPLETED' });
  assert.equal(response.status, 403);
});

test('receptionist cannot write consultation notes', async () => {
  const response = await api.post('/api/records').set(auth('reception')).send({ patientId: patient1.id, appointmentId: relatedAppointment.id, diagnosis: 'x' });
  assert.equal(response.status, 403);
});

test('doctor cannot write notes against another doctor appointment', async () => {
  const response = await api.post('/api/records').set(auth('doctor')).send({ patientId: patient2.id, appointmentId: unrelatedAppointment.id, diagnosis: 'x' });
  assert.equal(response.status, 403);
});

test('doctor can complete an assigned consultation atomically', async () => {
  const response = await api.post('/api/records').set(auth('doctor')).send({ patientId: patient1.id, appointmentId: relatedAppointment.id, diagnosis: 'Test diagnosis', symptoms: 'Test symptom', vitalSigns: {} });
  assert.equal(response.status, 201);
  assert.equal((await prisma.appointment.findUnique({ where: { id: relatedAppointment.id } })).status, 'COMPLETED');
});

test('drug inventory is not public and is available to pharmacy', async () => {
  assert.equal((await api.get('/api/records/drugs')).status, 401);
  assert.equal((await api.get('/api/records/drugs').set(auth('pharmacy'))).status, 200);
});

test('legacy pharmacist price endpoint is removed and cannot change official selling prices', async () => {
  assert.ok(drug);

  const before = await prisma.drugFormulary.findUnique({
    where: { id: drug.id }
  });

  const beforePrice =
    before.unitPriceSdg == null
      ? null
      : Number(before.unitPriceSdg);

  const forbiddenRoles = ['admin', 'reception', 'doctor', 'lab', 'pharmacy'];

  for (const role of forbiddenRoles) {
    const response = await api
      .patch(`/api/records/drugs/${drug.id}/price`)
      .set(auth(role))
      .send({
        unitPriceSdg: 9999
      });

    assert.equal(response.status, 404, `${role} must not have a records-route price writer`);
  }

  const after = await prisma.drugFormulary.findUnique({
    where: { id: drug.id }
  });

  const afterPrice =
    after.unitPriceSdg == null
      ? null
      : Number(after.unitPriceSdg);

  assert.equal(afterPrice, beforePrice);
});


test('pharmacy medication review queue is pharmacist-only and lists pending custom medicines', async () => {
  const fixture =
    await createCustomMedicationReviewFixture({
      customDrugName: `Pending Queue Medicine ${Date.now()}`
    });

  const pharmacyResponse = await api
    .get('/api/records/medication-reviews/pending')
    .set(auth('pharmacy'));

  assert.equal(pharmacyResponse.status, 200);
  assert.ok(Array.isArray(pharmacyResponse.body));

  const queuedItem = pharmacyResponse.body.find(
    (item) => item.id === fixture.prescribedDrug.id
  );

  assert.ok(
    queuedItem,
    'Pending custom medication must appear in pharmacy review queue'
  );

  assert.equal(
    queuedItem.pharmacyReviewStatus,
    'PENDING_REVIEW'
  );

  for (const role of [
    'admin',
    'reception',
    'doctor',
    'lab'
  ]) {
    const forbidden = await api
      .get('/api/records/medication-reviews/pending')
      .set(auth(role));

    assert.equal(
      forbidden.status,
      403,
      `${role} must not access pharmacy medication review queue`
    );
  }
});

test('reception cannot bill a prescription while medication review is pending', async () => {
  const fixture =
    await createCustomMedicationReviewFixture();

  const response =
    await requestPharmacyInvoiceForFixture(fixture);

  assert.equal(response.status, 409);
  assert.equal(
    response.body.error?.code,
    'PHARMACY_REVIEW_PENDING'
  );

  const invoiceCount = await prisma.invoice.count({
    where: {
      prescriptionId: fixture.rx.id
    }
  });

  assert.equal(invoiceCount, 0);
});

test('only pharmacist can make a medication review decision', async () => {
  const fixture =
    await createCustomMedicationReviewFixture();

  for (const role of [
    'admin',
    'reception',
    'doctor',
    'lab'
  ]) {
    const response = await api
      .post(
        `/api/records/prescribed-drugs/${fixture.prescribedDrug.id}/pharmacy-review`
      )
      .set(auth(role))
      .send({
        decision: 'EXTERNAL'
      });

    assert.equal(
      response.status,
      403,
      `${role} must not review custom medications`
    );
  }

  const stored = await prisma.prescribedDrug.findUnique({
    where: {
      id: fixture.prescribedDrug.id
    }
  });

  assert.equal(
    stored.pharmacyReviewStatus,
    'PENDING_REVIEW'
  );
});

test('pharmacist can link a custom medication to an existing stocked formulary drug', async () => {
  const fixture =
    await createCustomMedicationReviewFixture();

  const targetDrug = await prisma.drugFormulary.create({
    data: {
      brandName: `Linked Review Drug ${fixture.unique}`,
      labelAr: 'دواء ربط اختبار',
      labelEn: `Linked Review Drug ${fixture.unique}`,
      genericName: `LinkedGeneric-${fixture.unique}`,
      strength: '500mg',
      dosageForm: 'Tablet',
      identityKey: buildMedicineIdentityKey({
        brandName: `Linked Review Drug ${fixture.unique}`,
        genericName: `LinkedGeneric-${fixture.unique}`,
        strength: '500mg',
        dosageForm: 'Tablet'
      }),
      unitPriceSdg: 4500,
      status: 'ACTIVE'
    }
  });

  await prisma.inventoryBatch.create({
    data: {
      drugId: targetDrug.id,
      batchNumber: `LINK-${fixture.unique}`,
      normalizedBatchNumber: normalizeBatchNumber(`LINK-${fixture.unique}`),
      expiryDate: '2035-12-31',
      qtyOnHand: 50,
      minReorderLevel: 10
    }
  });

  const review = await api
    .post(
      `/api/records/prescribed-drugs/${fixture.prescribedDrug.id}/pharmacy-review`
    )
    .set(auth('pharmacy'))
    .send({
      decision: 'LINK_EXISTING',
      drugId: targetDrug.id,
      note: 'Matched to existing stocked medicine.'
    });

  assert.equal(review.status, 200);
  assert.equal(review.body.success, true);
  assert.equal(review.body.decision, 'LINK_EXISTING');

  const stored = await prisma.prescribedDrug.findUnique({
    where: {
      id: fixture.prescribedDrug.id
    }
  });

  assert.equal(stored.drugId, targetDrug.id);
  assert.equal(
    stored.pharmacyReviewStatus,
    'APPROVED'
  );

  assert.ok(stored.pharmacyReviewedAt);

  const billing =
    await requestPharmacyInvoiceForFixture(fixture);

  assert.equal(billing.status, 201);

  const invoice = await prisma.invoice.findFirst({
    where: {
      prescriptionId: fixture.rx.id,
      invoiceType: 'PHARMACY'
    }
  });

  assert.ok(
    invoice,
    'Approved linked medication must become billable'
  );
});

test('pharmacist creates only an unpriced inactive medicine and ADMIN controls its official price', async () => {
  const fixture =
    await createCustomMedicationReviewFixture({
      customDrugName: `Cefixime Review ${Date.now()}`
    });

  const labelEn =
    `Cefixime Review ${fixture.unique}`;

  const genericName =
    `Cefixime-${fixture.unique}`;

  const forged = await api
    .post(
      `/api/records/prescribed-drugs/${fixture.prescribedDrug.id}/pharmacy-review`
    )
    .set(auth('pharmacy'))
    .send({
      decision: 'CREATE_FORMULARY',
      note: 'Approved as a clinic-stocked medication.',

      formulary: {
        labelAr: 'سيفيكسيم اختبار',
        labelEn,
        genericName,
        strength: '400mg',
        dosageForm: 'Tablet',
        unitPriceSdg: 6000
      },

      inventory: {
        batchNumber: `CEF-${fixture.unique}`,
        expiryDate: '2035-12-31',
        qtyOnHand: 40,
        minReorderLevel: 10
      }
    });

  assert.equal(forged.status, 422);
  assert.equal(forged.body.error.code, 'PHARMACY_PRICE_ADMIN_REQUIRED');

  const review = await api
    .post(`/api/records/prescribed-drugs/${fixture.prescribedDrug.id}/pharmacy-review`)
    .set(auth('pharmacy'))
    .send({
      decision: 'CREATE_FORMULARY',
      note: 'Created as inventory identity pending administrator pricing.',
      formulary: {
        labelAr: 'سيفيكسيم اختبار', labelEn, genericName,
        strength: '400mg', dosageForm: 'Tablet'
      },
      inventory: {
        batchNumber: `CEF-${fixture.unique}`, expiryDate: '2035-12-31',
        qtyOnHand: 40, minReorderLevel: 10
      }
    });

  assert.equal(review.status, 200);
  assert.equal(review.body.success, true);
  assert.equal(
    review.body.decision,
    'CREATE_FORMULARY'
  );

  const stored = await prisma.prescribedDrug.findUnique({
    where: {
      id: fixture.prescribedDrug.id
    },
    include: {
      drug: {
        include: {
          inventoryBatches: true
        }
      }
    }
  });

  assert.equal(
    stored.pharmacyReviewStatus,
    'APPROVED'
  );

  assert.ok(stored.drugId);
  assert.ok(stored.pharmacyReviewedAt);

  assert.equal(
    stored.drug.labelEn,
    labelEn
  );

  assert.equal(stored.drug.unitPriceSdg, null);
  assert.equal(stored.drug.status, 'INACTIVE');
  assert.equal(stored.drug.brandName, labelEn);
  assert.equal(stored.drug.identityKey, buildMedicineIdentityKey({
    brandName: labelEn,
    genericName,
    strength: '400mg',
    dosageForm: 'Tablet'
  }));

  assert.equal(
    stored.drug.inventoryBatches.length,
    1
  );

  assert.equal(
    stored.drug.inventoryBatches[0].qtyOnHand,
    40
  );
  assert.equal(stored.drug.inventoryBatches[0].normalizedBatchNumber, normalizeBatchNumber(`CEF-${fixture.unique}`));

  const openingMovement = await prisma.stockMovement.findFirst({
    where: { inventoryBatchId: stored.drug.inventoryBatches[0].id }
  });
  assert.equal(openingMovement.movementType, 'OPENING_BALANCE');
  assert.equal(openingMovement.quantityDelta, 40);
  assert.equal(openingMovement.resultingBalance, 40);

  const audit = await prisma.tenantAuditLog.findFirst({
    where: {
      action:
        `PHARMACY_CUSTOM_MEDICATION_CREATED:${fixture.prescribedDrug.id}`
    }
  });

  assert.ok(
    audit,
    'Creating a formulary medication must be audited'
  );

  const blockedBilling = await requestPharmacyInvoiceForFixture(fixture);
  assert.equal(blockedBilling.status, 409);
  assert.equal(blockedBilling.body.error.code, 'PHARMACY_PRICE_NOT_CONFIGURED');

  const configured = await api.patch(`/api/admin/pricing/medicines/${stored.drug.id}`)
    .set(auth('admin')).send({ priceSdg: 6000, status: 'ACTIVE' });
  assert.equal(configured.status, 200);
  assert.equal(configured.body.unitPriceSdg, 6000);

  const billing = await requestPharmacyInvoiceForFixture(fixture);
  assert.equal(billing.status, 201);

  const invoiceCount = await prisma.invoice.count({
    where: {
      prescriptionId: fixture.rx.id,
      invoiceType: 'PHARMACY'
    }
  });

  assert.equal(invoiceCount, 1);
});

test('concurrent equivalent formulary reviews return one success and one deterministic conflict', async () => {
  const first = await createCustomMedicationReviewFixture({ customDrugName: `Concurrent Custom A ${Date.now()}` });
  const second = await createCustomMedicationReviewFixture({ customDrugName: `Concurrent Custom B ${Date.now()}` });
  const suffix = `${Date.now()}-${Math.random()}`;
  const formulary = {
    brandName: `Concurrent Review Brand ${suffix}`,
    labelAr: 'دواء متزامن',
    labelEn: `Concurrent Review Drug ${suffix}`,
    genericName: `Concurrent Review Generic ${suffix}`,
    strength: '25 mg',
    dosageForm: 'Tablet'
  };
  const submit = (fixture, lot) => api
    .post(`/api/records/prescribed-drugs/${fixture.prescribedDrug.id}/pharmacy-review`)
    .set(auth('pharmacy'))
    .send({
      decision: 'CREATE_FORMULARY',
      formulary,
      inventory: { batchNumber: lot, expiryDate: '2035-12-31', qtyOnHand: 10, minReorderLevel: 1 }
    });

  const responses = await Promise.all([
    submit(first, `CON-A-${suffix}`),
    submit(second, `CON-B-${suffix}`)
  ]);
  const successIndex = responses.findIndex((response) => response.status === 200);
  const conflictIndex = responses.findIndex((response) => response.status === 409);
  assert.notEqual(successIndex, -1);
  assert.notEqual(conflictIndex, -1);
  assert.equal(responses[conflictIndex].body.error.code, 'FORMULARY_MEDICINE_ALREADY_EXISTS');

  const identityKey = buildMedicineIdentityKey(formulary);
  const medicines = await prisma.drugFormulary.findMany({ where: { identityKey }, include: {
    inventoryBatches: { include: { stockMovements: true } }
  } });
  assert.equal(medicines.length, 1);
  assert.equal(medicines[0].inventoryBatches.length, 1);
  assert.equal(medicines[0].inventoryBatches[0].stockMovements.length, 1);

  const fixtures = [first, second];
  const failedFixture = fixtures[conflictIndex];
  const failedItem = await prisma.prescribedDrug.findUnique({ where: { id: failedFixture.prescribedDrug.id } });
  assert.equal(failedItem.drugId, null);
  assert.equal(failedItem.pharmacyReviewStatus, 'PENDING_REVIEW');
  assert.equal(await prisma.tenantAuditLog.count({ where: {
    action: `PHARMACY_CUSTOM_MEDICATION_CREATED:${failedFixture.prescribedDrug.id}`
  } }), 0);
});

test('database identity constraint prevents concurrent equivalent medicine products', async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const canonical = {
    brandName: `Concurrent Brand ${suffix}`,
    genericName: 'Canonical Generic',
    strength: '10 mg',
    dosageForm: 'Tablet'
  };
  const identityKey = buildMedicineIdentityKey(canonical);
  const create = (labelEn) => prisma.drugFormulary.create({
    data: {
      ...canonical,
      labelAr: labelEn,
      labelEn,
      identityKey,
      status: 'INACTIVE',
      unitPriceSdg: null
    }
  });
  const results = await Promise.allSettled([create('Concurrent One'), create('Concurrent Two')]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.equal(rejected.reason.code, 'P2002');
  assert.equal(await prisma.drugFormulary.count({ where: { identityKey } }), 1);
});

test('new formulary rows default to inactive', async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const identity = {
    brandName: `Default Brand ${suffix}`,
    genericName: `Default Generic ${suffix}`,
    strength: '5 mg',
    dosageForm: 'Tablet'
  };
  const created = await prisma.drugFormulary.create({
    data: {
      ...identity,
      labelAr: 'دواء افتراضي',
      labelEn: `Default Drug ${suffix}`,
      identityKey: buildMedicineIdentityKey(identity)
    }
  });
  assert.equal(created.status, 'INACTIVE');
  assert.equal(created.unitPriceSdg, null);
});

test('database batch identity constraint prevents duplicate lot rows', async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const product = {
    brandName: `Batch Brand ${suffix}`,
    genericName: `Batch Generic ${suffix}`,
    strength: '20 mg',
    dosageForm: 'Capsule'
  };
  const drug = await prisma.drugFormulary.create({
    data: {
      ...product,
      labelAr: 'دواء تشغيلة',
      labelEn: `Batch Drug ${suffix}`,
      identityKey: buildMedicineIdentityKey(product),
      status: 'INACTIVE',
      unitPriceSdg: null
    }
  });
  const create = (batchNumber) => prisma.inventoryBatch.create({
    data: {
      drugId: drug.id,
      batchNumber,
      normalizedBatchNumber: normalizeBatchNumber(batchNumber),
      expiryDate: '2035-12-31',
      qtyOnHand: 10,
      minReorderLevel: 1
    }
  });
  const results = await Promise.allSettled([create(' Lot  A-1 '), create('lot a-1')]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.equal(rejected.reason.code, 'P2002');
  assert.equal(await prisma.inventoryBatch.count({ where: {
    drugId: drug.id,
    normalizedBatchNumber: normalizeBatchNumber('lot a-1'),
    expiryDate: '2035-12-31'
  } }), 1);
});

test('pharmacist can mark a custom medication as external without creating a clinic pharmacy invoice', async () => {
  const fixture =
    await createCustomMedicationReviewFixture();

  const review = await api
    .post(
      `/api/records/prescribed-drugs/${fixture.prescribedDrug.id}/pharmacy-review`
    )
    .set(auth('pharmacy'))
    .send({
      decision: 'EXTERNAL',
      note: 'Patient should purchase this medication externally.'
    });

  assert.equal(review.status, 200);
  assert.equal(review.body.success, true);
  assert.equal(review.body.decision, 'EXTERNAL');

  const stored = await prisma.prescribedDrug.findUnique({
    where: {
      id: fixture.prescribedDrug.id
    }
  });

  assert.equal(stored.drugId, null);
  assert.equal(
    stored.pharmacyReviewStatus,
    'EXTERNAL'
  );

  assert.ok(stored.pharmacyReviewedAt);

  const billing =
    await requestPharmacyInvoiceForFixture(fixture);

  assert.equal(billing.status, 409);

  assert.equal(
    billing.body.error?.code,
    'PHARMACY_NO_BILLABLE_ITEMS'
  );

  const invoiceCount = await prisma.invoice.count({
    where: {
      prescriptionId: fixture.rx.id
    }
  });

  assert.equal(invoiceCount, 0);
});

test('concurrent pharmacy review attempts can approve a pending medication only once', async () => {
  const fixture =
    await createCustomMedicationReviewFixture();

  const endpoint =
    `/api/records/prescribed-drugs/${fixture.prescribedDrug.id}/pharmacy-review`;

  const [first, second] = await Promise.all([
    api
      .post(endpoint)
      .set(auth('pharmacy'))
      .send({
        decision: 'EXTERNAL',
        note: 'Concurrent review A'
      }),

    api
      .post(endpoint)
      .set(auth('pharmacy'))
      .send({
        decision: 'EXTERNAL',
        note: 'Concurrent review B'
      })
  ]);

  const statuses = [
    first.status,
    second.status
  ].sort((a, b) => a - b);

  assert.deepEqual(
    statuses,
    [200, 409]
  );

  const stored = await prisma.prescribedDrug.findUnique({
    where: {
      id: fixture.prescribedDrug.id
    }
  });

  assert.equal(
    stored.pharmacyReviewStatus,
    'EXTERNAL'
  );

  const audits = await prisma.tenantAuditLog.count({
    where: {
      action:
        `PHARMACY_CUSTOM_MEDICATION_EXTERNAL:${fixture.prescribedDrug.id}`
    }
  });

  assert.equal(
    audits,
    1,
    'Only one successful pharmacy review may be audited'
  );
});

test('lab queue is lab-only', async () => {
  assert.equal((await api.get('/api/records/lab-orders/pending').set(auth('lab'))).status, 200);
  assert.equal((await api.get('/api/records/lab-orders/pending').set(auth('pharmacy'))).status, 403);
});

test('doctor free-text laboratory requests are created pending review without a price', async () => {
  fixtureCounter += 1;
  const appointment = await prisma.appointment.create({
    data: {
      patientId: patient1.id,
      doctorId: doctor1.id,
      appointmentDate: `2036-05-${String((fixtureCounter % 27) + 1).padStart(2, '0')}`,
      appointmentTime: '10:30',
      status: 'IN_CONSULTATION'
    }
  });
  const response = await api.post('/api/records').set(auth('doctor')).send({
    patientId: patient1.id,
    appointmentId: appointment.id,
    customTests: [`Doctor Custom Test ${fixtureCounter}`]
  });
  assert.equal(response.status, 201);
  const item = await prisma.labOrderItem.findFirst({
    where: { labOrder: { medicalRecord: { appointmentId: appointment.id } } }
  });
  assert.equal(item.serviceId, null);
  assert.equal(item.labReviewStatus, 'PENDING_REVIEW');
});

test('custom lab tests wait for lab review and block reception billing until linked', async () => {
  const fixture = await createLabReviewFixture(`Custom Link ${fixtureCounter}`);
  const queue = await api.get('/api/records/lab-order-items/pending-review').set(auth('lab'));
  assert.equal(queue.status, 200);
  assert.ok(queue.body.some((item) => item.id === fixture.customItem.id));

  const blocked = await api.post('/api/billing/invoice').set(auth('reception')).send({
    patientId: patient1.id, labOrderId: fixture.order.id, invoiceType: 'LABORATORY'
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body?.error?.code || blocked.body?.code, 'LAB_REVIEW_PENDING');

  const linked = await api.post(`/api/records/lab-order-items/${fixture.customItem.id}/review`).set(auth('lab')).send({
    decision: 'LINK_EXISTING', serviceId: service.id
  });
  assert.equal(linked.status, 200);
  assert.equal(linked.body.item.labReviewStatus, 'APPROVED');

  const invoice = await api.post('/api/billing/invoice').set(auth('reception')).send({
    patientId: patient1.id, labOrderId: fixture.order.id, invoiceType: 'LABORATORY',
    items: [{ descriptionEn: 'untrusted', descriptionAr: 'untrusted', qty: 1, unitPriceSdg: 1 }]
  });
  assert.equal(invoice.status, 201);
  assert.equal(Number(invoice.body.invoice.totalAmountSdg), Number(service.baseFeeSdg) * 2);
});

test('lab tech creates only an unpriced inactive service and ADMIN controls its official price', async () => {
  const fixture = await createLabReviewFixture(`Reusable Test ${fixtureCounter}`, { includeStandard: false });
  const labelEn = `Reusable Test ${fixtureCounter}`;
  const forged = await api.post(`/api/records/lab-order-items/${fixture.customItem.id}/review`).set(auth('lab')).send({
    decision: 'CREATE_SERVICE', service: { labelAr: `فحص قابل لإعادة الاستخدام ${fixtureCounter}`, labelEn, baseFeeSdg: 23000 }
  });
  assert.equal(forged.status, 422);
  assert.equal(forged.body.error.code, 'LAB_PRICE_ADMIN_REQUIRED');

  const created = await api.post(`/api/records/lab-order-items/${fixture.customItem.id}/review`).set(auth('lab')).send({
    decision: 'CREATE_SERVICE', service: { labelAr: `فحص قابل لإعادة الاستخدام ${fixtureCounter}`, labelEn }
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.service.category, 'LABORATORY');
  assert.equal(created.body.service.baseFeeSdg, null);
  assert.equal(created.body.service.status, 'INACTIVE');

  const blocked = await api.post('/api/billing/invoice').set(auth('reception')).send({
    patientId: patient1.id, labOrderId: fixture.order.id, invoiceType: 'LABORATORY'
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, 'LAB_SERVICE_PRICE_NOT_CONFIGURED');

  const configured = await api.patch(`/api/admin/pricing/services/${created.body.service.id}`)
    .set(auth('admin')).send({ priceSdg: 23000, status: 'ACTIVE' });
  assert.equal(configured.status, 200);
  assert.equal(configured.body.baseFeeSdg, 23000);

  const firstConfigurationAudit = await prisma.tenantAuditLog.findFirst({
    where: {
      action: 'CLINICAL_SERVICE_PRICE_UPDATED',
      details: { contains: created.body.service.id }
    },
    orderBy: { timestamp: 'desc' }
  });
  assert.ok(firstConfigurationAudit);
  assert.equal(JSON.parse(firstConfigurationAudit.details).previousPriceSdg, null);
  assert.equal(JSON.parse(firstConfigurationAudit.details).newPriceSdg, 23000);

  const reconfigured = await api.patch(`/api/admin/pricing/services/${created.body.service.id}`)
    .set(auth('admin')).send({ priceSdg: 24000, status: 'ACTIVE' });
  assert.equal(reconfigured.status, 200);
  const subsequentAudit = await prisma.tenantAuditLog.findFirst({
    where: {
      action: 'CLINICAL_SERVICE_PRICE_UPDATED',
      details: { contains: created.body.service.id }
    },
    orderBy: { timestamp: 'desc' }
  });
  assert.equal(JSON.parse(subsequentAudit.details).previousPriceSdg, 23000);
  assert.equal(JSON.parse(subsequentAudit.details).newPriceSdg, 24000);

  const currentInvoice = await api.post('/api/billing/invoice').set(auth('reception')).send({
    patientId: patient1.id, labOrderId: fixture.order.id, invoiceType: 'LABORATORY'
  });
  assert.equal(currentInvoice.status, 201);
  assert.equal(Number(currentInvoice.body.invoice.totalAmountSdg), 24000);

  const futureOrder = await prisma.labOrder.create({
    data: {
      medicalRecordId: (await prisma.medicalRecord.findUnique({ where: { appointmentId: fixture.appointment.id } })).id,
      patientId: patient1.id, doctorId: doctor1.id, status: 'PENDING_BILLING',
      items: { create: { serviceId: created.body.service.id, labReviewStatus: 'NOT_REQUIRED' } }
    }
  });
  const futureInvoice = await api.post('/api/billing/invoice').set(auth('reception')).send({
    patientId: patient1.id, labOrderId: futureOrder.id, invoiceType: 'LABORATORY'
  });
  assert.equal(futureInvoice.status, 201);
  assert.equal(Number(futureInvoice.body.invoice.totalAmountSdg), 24000);

  const duplicate = await createLabReviewFixture(`Duplicate ${fixtureCounter}`, { includeStandard: false });
  const duplicateResponse = await api.post(`/api/records/lab-order-items/${duplicate.customItem.id}/review`).set(auth('lab')).send({
    decision: 'CREATE_SERVICE', service: { labelAr: `  ${created.body.service.labelAr.toUpperCase()}  `, labelEn: `  ${labelEn.toUpperCase()}  ` }
  });
  assert.equal(duplicateResponse.status, 409);
  assert.equal(duplicateResponse.body?.error?.code || duplicateResponse.body?.code, 'LAB_SERVICE_ALREADY_EXISTS');
});

test('external custom lab tests are not billed and all-external orders return to the doctor', async () => {
  const fixture = await createLabReviewFixture(`External Test ${fixtureCounter}`);
  const external = await api.post(`/api/records/lab-order-items/${fixture.customItem.id}/review`).set(auth('lab')).send({ decision: 'EXTERNAL' });
  assert.equal(external.status, 200);
  assert.equal(external.body.item.labReviewStatus, 'EXTERNAL');

  const invoice = await api.post('/api/billing/invoice').set(auth('reception')).send({
    patientId: patient1.id, labOrderId: fixture.order.id, invoiceType: 'LABORATORY'
  });
  assert.equal(invoice.status, 201);
  assert.equal(Number(invoice.body.invoice.totalAmountSdg), Number(service.baseFeeSdg));

  const onlyExternal = await createLabReviewFixture(`External Only ${fixtureCounter}`, { includeStandard: false });
  assert.equal((await api.post(`/api/records/lab-order-items/${onlyExternal.customItem.id}/review`).set(auth('lab')).send({ decision: 'EXTERNAL' })).status, 200);
  assert.equal((await prisma.labOrder.findUnique({ where: { id: onlyExternal.order.id } })).status, 'COMPLETED');
  assert.equal((await prisma.appointment.findUnique({ where: { id: onlyExternal.appointment.id } })).status, 'IN_CONSULTATION');
});

test('lab review is lab-only and concurrent review has exactly one winner', async () => {
  const fixture = await createLabReviewFixture(`Concurrent Test ${fixtureCounter}`, { includeStandard: false });
  const path = `/api/records/lab-order-items/${fixture.customItem.id}/review`;
  assert.equal((await api.post(path).set(auth('reception')).send({ decision: 'EXTERNAL' })).status, 403);
  assert.equal((await api.post(path).set(auth('doctor')).send({ decision: 'EXTERNAL' })).status, 403);

  const responses = await Promise.all([
    api.post(path).set(auth('lab')).send({ decision: 'LINK_EXISTING', serviceId: service.id }),
    api.post(path).set(auth('lab')).send({ decision: 'EXTERNAL' })
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const stored = await prisma.labOrderItem.findUnique({ where: { id: fixture.customItem.id } });
  assert.ok(['APPROVED', 'EXTERNAL'].includes(stored.labReviewStatus));
  assert.equal(await prisma.tenantAuditLog.count({ where: { action: { startsWith: 'LAB_CUSTOM_TEST_', endsWith: `:${fixture.customItem.id}` } } }), 1);
});

test('reception can view the laboratory billing queue and lab staff cannot', async () => {
  const record = await prisma.medicalRecord.findUnique({
    where: {
      appointmentId: relatedAppointment.id
    }
  });

  const order = await prisma.labOrder.create({
    data: {
      medicalRecordId: record.id,
      patientId: patient1.id,
      doctorId: doctor1.id,
      status: 'PENDING_BILLING',
      items: {
        create: {
          serviceId: service.id
        }
      }
    }
  });

  const receptionResponse = await api
    .get('/api/billing/lab-orders/pending')
    .set(auth('reception'));

  assert.equal(receptionResponse.status, 200);

  const queuedOrder = receptionResponse.body.find(
    (candidate) => candidate.id === order.id
  );

  assert.ok(queuedOrder);
  assert.equal(queuedOrder.billingStatus, 'UNBILLED');
  assert.equal(queuedOrder.invoice, null);
  assert.equal(queuedOrder.pricingRequired, false);
  assert.equal(
    Number(queuedOrder.estimatedTotalSdg),
    Number(service.baseFeeSdg)
  );

  const labResponse = await api
    .get('/api/billing/lab-orders/pending')
    .set(auth('lab'));

  assert.equal(labResponse.status, 403);

  await prisma.labOrder.delete({
    where: {
      id: order.id
    }
  });
});

test('laboratory billing queue preserves null pricing and reports every unbillable configuration', async () => {
  const record = await prisma.medicalRecord.findUnique({ where: { appointmentId: relatedAppointment.id } });
  const unique = ++fixtureCounter;
  const services = await Promise.all([
    prisma.clinicalService.create({
      data: {
        labelAr: `سعر فارغ نشط ${unique}`,
        labelEn: `Active Null Price ${unique}`,
        category: 'LABORATORY', status: 'ACTIVE', baseFeeSdg: null, baseFeeUsd: null
      }
    }),
    prisma.clinicalService.create({
      data: {
        labelAr: `سعر مضبوط غير نشط ${unique}`,
        labelEn: `Inactive Configured Price ${unique}`,
        category: 'LABORATORY', status: 'INACTIVE', baseFeeSdg: 17000, baseFeeUsd: 17000 / 1500
      }
    }),
    prisma.clinicalService.create({
      data: {
        labelAr: `سعر مضبوط نشط ${unique}`,
        labelEn: `Active Configured Price ${unique}`,
        category: 'LABORATORY', status: 'ACTIVE', baseFeeSdg: 19000, baseFeeUsd: 19000 / 1500
      }
    })
  ]);
  const orders = await Promise.all(services.map((catalogService) => prisma.labOrder.create({
    data: {
      medicalRecordId: record.id,
      patientId: patient1.id,
      doctorId: doctor1.id,
      status: 'PENDING_BILLING',
      items: { create: { serviceId: catalogService.id } }
    }
  })));

  try {
    const response = await api.get('/api/billing/lab-orders/pending').set(auth('reception'));
    assert.equal(response.status, 200);
    const queued = orders.map((order) => response.body.find((candidate) => candidate.id === order.id));
    assert.ok(queued.every(Boolean));

    assert.equal(queued[0].items[0].service.baseFeeSdg, null);
    assert.equal(queued[0].pricingRequired, true);
    assert.equal(queued[0].estimatedTotalSdg, 0);

    assert.equal(queued[1].items[0].service.baseFeeSdg, 17000);
    assert.equal(queued[1].pricingRequired, true);
    assert.equal(queued[1].estimatedTotalSdg, 0);

    assert.equal(queued[2].items[0].service.baseFeeSdg, 19000);
    assert.equal(queued[2].pricingRequired, false);
    assert.equal(queued[2].estimatedTotalSdg, 19000);
  } finally {
    await prisma.labOrder.deleteMany({ where: { id: { in: orders.map((order) => order.id) } } });
    await prisma.clinicalService.deleteMany({ where: { id: { in: services.map((catalogService) => catalogService.id) } } });
  }
});

test('laboratory payment gate requires full payment and sample collection before results', async () => {
  const record = await prisma.medicalRecord.findUnique({
    where: { appointmentId: relatedAppointment.id }
  });

  const order = await prisma.labOrder.create({
    data: {
      medicalRecordId: record.id,
      patientId: patient1.id,
      doctorId: doctor1.id,
      status: 'PENDING_BILLING',
      items: {
        create: {
          serviceId: service.id
        }
      }
    },
    include: {
      items: true
    }
  });

  const itemId = order.items[0].id;

  const unpaidResult = await api
    .put(`/api/records/lab-orders/items/${itemId}/results`)
    .set(auth('lab'))
    .send({ expectedVersion: 0, resultValue: '13.5' });

  assert.equal(unpaidResult.status, 403);
  assert.equal(
    unpaidResult.body?.error?.code || unpaidResult.body?.code,
    'LAB_PAYMENT_REQUIRED'
  );

  const invoiceResponse = await api
    .post('/api/billing/invoice')
    .set(auth('reception'))
    .send({
      patientId: patient1.id,
      labOrderId: order.id,
      invoiceType: 'LABORATORY',
      items: [{
        descriptionAr: 'malicious browser item',
        descriptionEn: 'malicious browser item',
        qty: 99,
        unitPriceSdg: 1
      }]
    });

  assert.equal(invoiceResponse.status, 201);

  const invoice = invoiceResponse.body.invoice;
  const serverPrice = Number(service.baseFeeSdg);

  assert.equal(invoice.labOrderId, order.id);
  assert.equal(Number(invoice.totalAmountSdg), serverPrice);

  const duplicateInvoiceResponse = await api
    .post('/api/billing/invoice')
    .set(auth('reception'))
    .send({
      patientId: patient1.id,
      labOrderId: order.id,
      invoiceType: 'LABORATORY'
    });

  assert.equal(duplicateInvoiceResponse.status, 200);
  assert.equal(duplicateInvoiceResponse.body.invoice.id, invoice.id);

  const partialAmount = serverPrice / 2;

  const partialPayment = await api
    .post(`/api/billing/invoice/${invoice.id}/payments`)
    .set(auth('reception'))
    .set('Idempotency-Key', `lab-partial-${order.id}`)
    .send({
      payments: [{
        amountSdg: partialAmount,
        paymentMethod: 'CASH'
      }]
    });

  assert.equal(partialPayment.status, 200);
  assert.equal(partialPayment.body.paymentStatus, 'PARTIALLY_PAID');

  let storedOrder = await prisma.labOrder.findUnique({
    where: { id: order.id }
  });

  assert.equal(storedOrder.status, 'PENDING_BILLING');

  const partialResultAttempt = await api
    .put(`/api/records/lab-orders/items/${itemId}/results`)
    .set(auth('lab'))
    .send({ expectedVersion: 0, resultValue: '13.5' });

  assert.equal(partialResultAttempt.status, 403);

  const finalPayment = await api
    .post(`/api/billing/invoice/${invoice.id}/payments`)
    .set(auth('reception'))
    .set('Idempotency-Key', `lab-final-${order.id}`)
    .send({
      payments: [{
        amountSdg: Number(partialPayment.body.remainingBalanceSdg),
        paymentMethod: 'CASH'
      }]
    });

  assert.equal(finalPayment.status, 200);
  assert.equal(finalPayment.body.paymentStatus, 'PAID');

  storedOrder = await prisma.labOrder.findUnique({
    where: { id: order.id }
  });

  assert.equal(storedOrder.status, 'PAID');

  const beforeCollection = await api
    .put(`/api/records/lab-orders/items/${itemId}/results`)
    .set(auth('lab'))
    .send({ expectedVersion: 0, resultValue: '13.5' });

  assert.equal(beforeCollection.status, 409);
  assert.equal(
    beforeCollection.body?.error?.code || beforeCollection.body?.code,
    'LAB_SAMPLE_NOT_COLLECTED'
  );

  const collectResponse = await api
    .put(`/api/records/lab-orders/${order.id}/collect-sample`)
    .set(auth('lab'));

  assert.equal(collectResponse.status, 200);
  assert.equal(collectResponse.body.status, 'SAMPLE_COLLECTED');

  const resultResponse = await api
    .put(`/api/records/lab-orders/items/${itemId}/results`)
    .set(auth('lab'))
    .send({
      expectedVersion: 0,
      resultValue: '13.5',
      referenceRangeMin: 12,
      referenceRangeMax: 16,
      isOutOfRange: false
    });

  assert.equal(resultResponse.status, 200);

  storedOrder = await prisma.labOrder.findUnique({
    where: { id: order.id }
  });

  assert.equal(storedOrder.status, 'COMPLETED');
});

test('laboratory result versions fail closed and prevent sequential stale full-result replacement', async () => {
  const fixture = await createResultConcurrencyFixture(2);
  const item = fixture.order.items[0];
  assert.equal(item.resultVersion, 0);

  const queued = await api.get('/api/records/lab-orders/pending').set(auth('lab'));
  const queuedItem = queued.body.find((order) => order.id === fixture.order.id).items.find((candidate) => candidate.id === item.id);
  assert.equal(queuedItem.resultVersion, 0);

  for (const invalidVersion of [undefined, -1, 0.5, '0', null]) {
    const body = { resultValue: 'invalid-version' };
    if (invalidVersion !== undefined) body.expectedVersion = invalidVersion;
    const rejected = await api.put(`/api/records/lab-orders/items/${item.id}/results`).set(auth('lab')).send(body);
    assert.notEqual(rejected.status, 200);
  }

  const first = await api.put(`/api/records/lab-orders/items/${item.id}/results`).set(auth('lab')).send({
    expectedVersion: 0,
    resultValue: '13.5',
    referenceRangeMin: 12,
    referenceRangeMax: 16,
    isOutOfRange: false,
    fileAttachmentPath: 'secure/result-a.pdf'
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.resultVersion, 1);

  const stale = await api.put(`/api/records/lab-orders/items/${item.id}/results`).set(auth('lab')).send({
    expectedVersion: 0,
    resultValue: '12.0',
    isOutOfRange: true
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'LAB_RESULT_CONFLICT');

  const future = await api.put(`/api/records/lab-orders/items/${item.id}/results`).set(auth('lab')).send({
    expectedVersion: 99,
    resultValue: 'future'
  });
  assert.equal(future.status, 409);
  assert.equal(future.body.error.code, 'LAB_RESULT_CONFLICT');

  const stored = await prisma.labOrderItem.findUnique({ where: { id: item.id } });
  assert.equal(stored.resultVersion, 1);
  assert.equal(stored.resultValue, '13.5');
  assert.equal(Number(stored.referenceRangeMin), 12);
  assert.equal(Number(stored.referenceRangeMax), 16);
  assert.equal(stored.isOutOfRange, false);
  assert.equal(stored.fileAttachmentPath, 'secure/result-a.pdf');

  const audits = await prisma.tenantAuditLog.findMany({
    where: { action: 'LAB_RESULTS_LOGGED', details: { contains: item.id } }
  });
  assert.equal(audits.length, 1);
  assert.equal(JSON.parse(audits[0].details).resultVersion, 1);
});

test('parallel same-item results have one winner while sibling completion remains monotonic', async () => {
  const sameItemFixture = await createResultConcurrencyFixture(2);
  const contested = sameItemFixture.order.items[0];
  const endpoint = `/api/records/lab-orders/items/${contested.id}/results`;
  const [writerA, writerB] = await Promise.all([
    api.put(endpoint).set(auth('lab')).send({ expectedVersion: 0, resultValue: 'writer-a' }),
    api.put(endpoint).set(auth('lab')).send({ expectedVersion: 0, resultValue: 'writer-b' })
  ]);
  assert.deepEqual([writerA.status, writerB.status].sort((a, b) => a - b), [200, 409]);
  const winner = writerA.status === 200 ? writerA : writerB;
  const loser = writerA.status === 409 ? writerA : writerB;
  assert.equal(loser.body.error.code, 'LAB_RESULT_CONFLICT');
  const contestedStored = await prisma.labOrderItem.findUnique({ where: { id: contested.id } });
  assert.equal(contestedStored.resultVersion, 1);
  assert.equal(contestedStored.resultValue, winner.body.resultValue);

  const siblingFixture = await createResultConcurrencyFixture(2);
  const [itemA, itemB] = siblingFixture.order.items;
  const [resultA, resultB] = await Promise.all([
    api.put(`/api/records/lab-orders/items/${itemA.id}/results`).set(auth('lab')).send({ expectedVersion: 0, resultValue: 'A' }),
    api.put(`/api/records/lab-orders/items/${itemB.id}/results`).set(auth('lab')).send({ expectedVersion: 0, resultValue: 'B' })
  ]);
  assert.equal(resultA.status, 200);
  assert.equal(resultB.status, 200);
  const [storedA, storedB, completedOrder, returnedAppointment] = await Promise.all([
    prisma.labOrderItem.findUnique({ where: { id: itemA.id } }),
    prisma.labOrderItem.findUnique({ where: { id: itemB.id } }),
    prisma.labOrder.findUnique({ where: { id: siblingFixture.order.id } }),
    prisma.appointment.findUnique({ where: { id: siblingFixture.appointment.id } })
  ]);
  assert.deepEqual([storedA.resultValue, storedB.resultValue], ['A', 'B']);
  assert.deepEqual([storedA.resultVersion, storedB.resultVersion], [1, 1]);
  assert.equal(completedOrder.status, 'COMPLETED');
  assert.equal(returnedAppointment.status, 'IN_CONSULTATION');
});

test('completed and released results reject stale writes and release serializes with final result entry', async () => {
  const fixture = await createResultConcurrencyFixture(2);
  const [itemA, itemB] = fixture.order.items;
  assert.equal((await api.put(`/api/records/lab-orders/items/${itemA.id}/results`).set(auth('lab')).send({ expectedVersion: 0, resultValue: 'authoritative-a' })).status, 200);
  assert.equal((await api.put(`/api/records/lab-orders/items/${itemB.id}/results`).set(auth('lab')).send({ expectedVersion: 0, resultValue: 'authoritative-b' })).status, 200);

  const staleAfterCompletion = await api.put(`/api/records/lab-orders/items/${itemA.id}/results`).set(auth('lab')).send({ expectedVersion: 1, resultValue: 'stale-completed' });
  assert.equal(staleAfterCompletion.status, 409);
  assert.equal(staleAfterCompletion.body.error.code, 'LAB_RESULT_FINALIZED');

  const release = await api.put(`/api/records/lab-orders/${fixture.order.id}/release`).set(auth('lab'));
  assert.equal(release.status, 200);
  const releaseReplay = await api.put(`/api/records/lab-orders/${fixture.order.id}/release`).set(auth('lab'));
  assert.equal(releaseReplay.status, 200);
  assert.equal(releaseReplay.body.idempotentReplay, true);

  const staleAfterRelease = await api.put(`/api/records/lab-orders/items/${itemA.id}/results`).set(auth('lab')).send({ expectedVersion: 1, resultValue: 'stale-released' });
  assert.equal(staleAfterRelease.status, 409);
  assert.equal(staleAfterRelease.body.error.code, 'LAB_RESULT_FINALIZED');
  const persisted = await prisma.labOrder.findUnique({ where: { id: fixture.order.id }, include: { items: true } });
  assert.ok(persisted.releasedToPatientAt);
  assert.equal(persisted.items.find((item) => item.id === itemA.id).resultValue, 'authoritative-a');

  const raceFixture = await createResultConcurrencyFixture(1);
  const raceItem = raceFixture.order.items[0];
  const [resultWrite, releaseAttempt] = await Promise.all([
    api.put(`/api/records/lab-orders/items/${raceItem.id}/results`).set(auth('lab')).send({ expectedVersion: 0, resultValue: 'serialized-result' }),
    api.put(`/api/records/lab-orders/${raceFixture.order.id}/release`).set(auth('lab'))
  ]);
  assert.equal(resultWrite.status, 200);
  assert.ok([200, 409].includes(releaseAttempt.status));
  const racedOrder = await prisma.labOrder.findUnique({ where: { id: raceFixture.order.id }, include: { items: true } });
  assert.equal(racedOrder.status, 'COMPLETED');
  assert.equal(racedOrder.items[0].resultValue, 'serialized-result');
  assert.equal(racedOrder.items[0].resultVersion, 1);
  if (releaseAttempt.status === 200) assert.ok(racedOrder.releasedToPatientAt);
});

test('laboratory result conflicts disclose nothing to unauthorized roles', async () => {
  const endpoint = '/api/records/lab-orders/items/00000000-0000-4000-8000-000000000000/results';
  const body = { expectedVersion: 0, resultValue: 'unauthorized' };
  assert.equal((await api.put(endpoint).send(body)).status, 401);
  for (const role of ['admin', 'doctor', 'reception', 'pharmacy']) {
    assert.equal((await api.put(endpoint).set(auth(role)).send(body)).status, 403);
  }
});


test('laboratory refund relocks unpaid work and is blocked after sample collection', async () => {
  const record = await prisma.medicalRecord.findUnique({
    where: {
      appointmentId: relatedAppointment.id
    }
  });

  const order = await prisma.labOrder.create({
    data: {
      medicalRecordId: record.id,
      patientId: patient1.id,
      doctorId: doctor1.id,
      status: 'PENDING_BILLING',
      items: {
        create: {
          serviceId: service.id
        }
      }
    },
    include: {
      items: true
    }
  });

  const servicePrice = Number(service.baseFeeSdg);

  // Create and fully pay the first laboratory invoice.
  const firstInvoiceResponse = await api
    .post('/api/billing/invoice')
    .set(auth('reception'))
    .send({
      patientId: patient1.id,
      labOrderId: order.id,
      invoiceType: 'LABORATORY'
    });

  assert.equal(firstInvoiceResponse.status, 201);

  const firstInvoice = firstInvoiceResponse.body.invoice;

  const firstPayment = await api
    .post(`/api/billing/invoice/${firstInvoice.id}/payments`)
    .set(auth('reception'))
    .set('Idempotency-Key', `lab-refund-pay-${order.id}`)
    .send({
      payments: [{
        amountSdg: servicePrice,
        paymentMethod: 'CASH'
      }]
    });

  assert.equal(firstPayment.status, 200);
  assert.equal(firstPayment.body.paymentStatus, 'PAID');

  let storedOrder = await prisma.labOrder.findUnique({
    where: {
      id: order.id
    }
  });

  assert.equal(storedOrder.status, 'PAID');

  // Partial laboratory refunds are deliberately not supported because
  // invoices cannot accept more payments after any refund.
  const partialRefund = await api
    .post(`/api/billing/invoice/${firstInvoice.id}/refund`)
    .set(auth('reception'))
    .send({
      amountSdg: servicePrice / 2,
      refundMethod: 'CASH',
      reason: 'Attempt partial laboratory refund'
    });

  assert.equal(partialRefund.status, 409);
  assert.equal(
    partialRefund.body?.error?.code || partialRefund.body?.code,
    'LAB_PARTIAL_REFUND_NOT_SUPPORTED'
  );

  storedOrder = await prisma.labOrder.findUnique({
    where: {
      id: order.id
    }
  });

  assert.equal(storedOrder.status, 'PAID');

  // Full refund before sample collection relocks the laboratory order.
  const fullRefund = await api
    .post(`/api/billing/invoice/${firstInvoice.id}/refund`)
    .set(auth('reception'))
    .send({
      amountSdg: servicePrice,
      refundMethod: 'CASH',
      reason: 'Patient requested refund before laboratory work started'
    });

  assert.equal(fullRefund.status, 201);
  assert.equal(fullRefund.body.invoice.paymentStatus, 'REFUNDED');

  storedOrder = await prisma.labOrder.findUnique({
    where: {
      id: order.id
    }
  });

  assert.equal(storedOrder.status, 'PENDING_BILLING');

  // A refunded laboratory invoice is historical; a fresh invoice can be
  // generated for the same order if the patient later decides to proceed.
  const secondInvoiceResponse = await api
    .post('/api/billing/invoice')
    .set(auth('reception'))
    .send({
      patientId: patient1.id,
      labOrderId: order.id,
      invoiceType: 'LABORATORY'
    });

  assert.equal(secondInvoiceResponse.status, 201);

  const secondInvoice = secondInvoiceResponse.body.invoice;

  assert.notEqual(secondInvoice.id, firstInvoice.id);
  assert.equal(secondInvoice.labOrderId, order.id);
  assert.equal(Number(secondInvoice.totalAmountSdg), servicePrice);

  const secondPayment = await api
    .post(`/api/billing/invoice/${secondInvoice.id}/payments`)
    .set(auth('reception'))
    .set('Idempotency-Key', `lab-repay-${order.id}`)
    .send({
      payments: [{
        amountSdg: servicePrice,
        paymentMethod: 'CASH'
      }]
    });

  assert.equal(secondPayment.status, 200);
  assert.equal(secondPayment.body.paymentStatus, 'PAID');

  storedOrder = await prisma.labOrder.findUnique({
    where: {
      id: order.id
    }
  });

  assert.equal(storedOrder.status, 'PAID');

  // Laboratory work starts.
  const collectResponse = await api
    .put(`/api/records/lab-orders/${order.id}/collect-sample`)
    .set(auth('lab'));

  assert.equal(collectResponse.status, 200);
  assert.equal(collectResponse.body.status, 'SAMPLE_COLLECTED');

  // Once the sample has been collected, financial reversal is locked.
  const lateRefund = await api
    .post(`/api/billing/invoice/${secondInvoice.id}/refund`)
    .set(auth('reception'))
    .send({
      amountSdg: servicePrice,
      refundMethod: 'CASH',
      reason: 'Attempt refund after sample collection'
    });

  assert.equal(lateRefund.status, 409);
  assert.equal(
    lateRefund.body?.error?.code || lateRefund.body?.code,
    'LAB_SERVICE_ALREADY_STARTED'
  );

  storedOrder = await prisma.labOrder.findUnique({
    where: {
      id: order.id
    }
  });

  assert.equal(storedOrder.status, 'SAMPLE_COLLECTED');
});

test('completed lab results return the patient to the doctor before final visit completion', async () => {
  fixtureCounter += 1;

  const appointment = await prisma.appointment.create({
    data: {
      patientId: patient1.id,
      doctorId: doctor1.id,
      appointmentDate: `2034-03-${String(fixtureCounter).padStart(2, '0')}`,
      appointmentTime: '09:30',
      status: 'WAITING_LAB'
    }
  });

  const record = await prisma.medicalRecord.create({
    data: {
      patientId: patient1.id,
      doctorId: doctor1.id,
      appointmentId: appointment.id,
      symptomsEncrypted: '',
      diagnosisEncrypted: '',
      treatmentEncrypted: '',
      vitalSignsJson: '{}',
      clinicalNotesEncrypted: ''
    }
  });

  const order = await prisma.labOrder.create({
    data: {
      medicalRecordId: record.id,
      patientId: patient1.id,
      doctorId: doctor1.id,
      status: 'PAID',
      items: {
        create: {
          serviceId: service.id
        }
      }
    },
    include: {
      items: true
    }
  });

  const collectResponse = await api
    .put(`/api/records/lab-orders/${order.id}/collect-sample`)
    .set(auth('lab'));

  assert.equal(collectResponse.status, 200);
  assert.equal(collectResponse.body.status, 'SAMPLE_COLLECTED');

  const resultResponse = await api
    .put(`/api/records/lab-orders/items/${order.items[0].id}/results`)
    .set(auth('lab'))
    .send({
      expectedVersion: 0,
      resultValue: '13.5',
      referenceRangeMin: 12,
      referenceRangeMax: 16,
      isOutOfRange: false
    });

  assert.equal(resultResponse.status, 200);

  const completedOrder = await prisma.labOrder.findUnique({
    where: { id: order.id }
  });

  assert.equal(completedOrder.status, 'COMPLETED');

  const returnedAppointment = await prisma.appointment.findUnique({
    where: { id: appointment.id }
  });

  assert.equal(returnedAppointment.status, 'IN_CONSULTATION');

  const finalizeResponse = await api
    .put(`/api/records/${record.id}/finalize`)
    .set(auth('doctor'))
    .send({
      diagnosis: 'Final diagnosis after lab review',
      treatment: 'Final treatment plan',
      clinicalNotes: 'Reviewed completed laboratory results.',
      vitalSigns: {}
    });

  assert.equal(finalizeResponse.status, 200);

  const finalizedAppointment = await prisma.appointment.findUnique({
    where: { id: appointment.id }
  });

  assert.equal(finalizedAppointment.status, 'COMPLETED');
});

test('pharmacy dispensing rejects negative quantity', async () => {
  const fixture = await createPrescriptionFixture();
  const response = await api.post(`/api/records/prescriptions/${fixture.rx.id}/dispense`).set(auth('pharmacy')).send({ items: [{ prescribedDrugId: fixture.item.id, qtyToDispense: -1, batchId: fixture.early.id }] });
  assert.notEqual(response.status, 200);
});

test('pharmacy dispensing applies FEFO automatically on the server', async () => {
  const fixture = await createPrescriptionFixture();

  const response = await api
    .post(`/api/records/prescriptions/${fixture.rx.id}/dispense`)
    .set(auth('pharmacy'))
    .send({
      items: [{
        prescribedDrugId: fixture.item.id,
        qtyToDispense: 1
      }]
    });

  assert.equal(response.status, 200);

  const early = await prisma.inventoryBatch.findUnique({
    where: { id: fixture.early.id }
  });

  const late = await prisma.inventoryBatch.findUnique({
    where: { id: fixture.late.id }
  });

  assert.equal(early.qtyOnHand, 19);
  assert.equal(late.qtyOnHand, 20);

  const movements = await prisma.stockMovement.findMany({
    where: { referenceType: 'PRESCRIBED_DRUG_DISPENSE', referenceId: fixture.item.id }
  });
  assert.equal(movements.length, 1);
  assert.equal(movements[0].inventoryBatchId, fixture.early.id);
  assert.equal(movements[0].drugId, fixture.drug.id);
  assert.equal(movements[0].quantityDelta, -1);
  assert.equal(movements[0].resultingBalance, 19);
  const pharmacist = await prisma.user.findUnique({ where: { username: 'pharma@cms.com' } });
  assert.equal(movements[0].actorUserId, pharmacist.id);
});

test('opening 100 followed by dispense 6 reconciles exactly to stock 94', async () => {
  const fixture = await createPrescriptionFixture({ earlyQty: 100, lateQty: 0 });
  const response = await api.post(`/api/records/prescriptions/${fixture.rx.id}/dispense`)
    .set(auth('pharmacy')).send({ items: [{ prescribedDrugId: fixture.item.id, qtyToDispense: 6 }] });
  assert.equal(response.status, 200);
  const batch = await prisma.inventoryBatch.findUnique({ where: { id: fixture.early.id } });
  const movements = await prisma.stockMovement.findMany({ where: { inventoryBatchId: fixture.early.id } });
  assert.equal(batch.qtyOnHand, 94);
  assert.deepEqual(movements.map((movement) => movement.movementType).sort(), ['DISPENSE', 'OPENING_BALANCE']);
  assert.equal(movements.reduce((balance, movement) => balance + movement.quantityDelta, 0), 94);
  assert.equal(movements.find((movement) => movement.movementType === 'DISPENSE').resultingBalance, 94);
  assert.equal(await prisma.stockMovement.count({ where: { inventoryBatchId: fixture.late.id } }), 0);
});

test('pharmacy dispensing splits quantity across multiple FEFO batches', async () => {
  const fixture = await createPrescriptionFixture();

  await prisma.prescribedDrug.update({
    where: { id: fixture.item.id },
    data: { qtyPrescribed: 32 }
  });

  await prisma.inventoryBatch.update({
    where: { id: fixture.late.id },
    data: { qtyOnHand: 20 }
  });

  const response = await api
    .post(`/api/records/prescriptions/${fixture.rx.id}/dispense`)
    .set(auth('pharmacy'))
    .send({
      items: [{
        prescribedDrugId: fixture.item.id,
        qtyToDispense: 32
      }]
    });

  assert.equal(response.status, 200);

  const early = await prisma.inventoryBatch.findUnique({
    where: { id: fixture.early.id }
  });

  const late = await prisma.inventoryBatch.findUnique({
    where: { id: fixture.late.id }
  });

  const prescribedDrug = await prisma.prescribedDrug.findUnique({
    where: { id: fixture.item.id }
  });

  const prescription = await prisma.prescription.findUnique({
    where: { id: fixture.rx.id }
  });

  assert.equal(early.qtyOnHand, 0);
  assert.equal(late.qtyOnHand, 8);
  assert.equal(prescribedDrug.qtyDispensed, 32);
  assert.equal(prescription.status, 'FILLED');

  const movements = await prisma.stockMovement.findMany({
    where: { referenceType: 'PRESCRIBED_DRUG_DISPENSE', referenceId: fixture.item.id },
    orderBy: { resultingBalance: 'asc' }
  });
  assert.equal(movements.length, 2);
  assert.deepEqual(
    new Map(movements.map((movement) => [movement.inventoryBatchId, [movement.quantityDelta, movement.resultingBalance]])),
    new Map([[fixture.early.id, [-20, 0]], [fixture.late.id, [-12, 8]]])
  );
});

test('dispense movement failure rolls back stock and prescribed quantity', async () => {
  const fixture = await createPrescriptionFixture();
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION fail_test_dispense_movement() RETURNS trigger AS $$
    BEGIN
      IF NEW."movementType" = 'DISPENSE' THEN
        RAISE EXCEPTION 'forced dispense movement failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe('CREATE TRIGGER fail_test_dispense_movement_trigger BEFORE INSERT ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION fail_test_dispense_movement()');
  try {
    const response = await api.post(`/api/records/prescriptions/${fixture.rx.id}/dispense`)
      .set(auth('pharmacy')).send({ items: [{ prescribedDrugId: fixture.item.id, qtyToDispense: 6 }] });
    assert.equal(response.status, 500);
    assert.equal((await prisma.inventoryBatch.findUnique({ where: { id: fixture.early.id } })).qtyOnHand, 20);
    assert.equal((await prisma.prescribedDrug.findUnique({ where: { id: fixture.item.id } })).qtyDispensed, 0);
    assert.equal(await prisma.stockMovement.count({ where: {
      referenceType: 'PRESCRIBED_DRUG_DISPENSE', referenceId: fixture.item.id
    } }), 0);
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_test_dispense_movement_trigger ON "StockMovement"');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_test_dispense_movement()');
  }
});

test('stock CAS failure creates no dispense movement', async () => {
  const fixture = await createPrescriptionFixture();
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION reject_test_stock_decrement() RETURNS trigger AS $$
    BEGIN
      IF NEW."qtyOnHand" < OLD."qtyOnHand" THEN RETURN NULL; END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe('CREATE TRIGGER reject_test_stock_decrement_trigger BEFORE UPDATE ON "InventoryBatch" FOR EACH ROW EXECUTE FUNCTION reject_test_stock_decrement()');
  try {
    const response = await api.post(`/api/records/prescriptions/${fixture.rx.id}/dispense`)
      .set(auth('pharmacy')).send({ items: [{ prescribedDrugId: fixture.item.id, qtyToDispense: 1 }] });
    assert.equal(response.status, 422);
    assert.equal((await prisma.inventoryBatch.findUnique({ where: { id: fixture.early.id } })).qtyOnHand, 20);
    assert.equal(await prisma.stockMovement.count({ where: {
      referenceType: 'PRESCRIBED_DRUG_DISPENSE', referenceId: fixture.item.id
    } }), 0);
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_test_stock_decrement_trigger ON "InventoryBatch"');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_test_stock_decrement()');
  }
});

test('concurrent dispensing commits once and leaves stock ledger reconciled', async () => {
  const fixture = await createPrescriptionFixture();
  const requestDispense = () => api.post(`/api/records/prescriptions/${fixture.rx.id}/dispense`)
    .set(auth('pharmacy')).send({ items: [{ prescribedDrugId: fixture.item.id, qtyToDispense: 10 }] });
  const responses = await Promise.all([requestDispense(), requestDispense()]);
  assert.equal(responses.filter((response) => response.status === 200).length, 1);
  assert.equal(responses.filter((response) => response.status !== 200).length, 1);
  const early = await prisma.inventoryBatch.findUnique({ where: { id: fixture.early.id } });
  const movements = await prisma.stockMovement.findMany({ where: { inventoryBatchId: fixture.early.id } });
  assert.equal(early.qtyOnHand, 10);
  assert.equal(movements.reduce((balance, movement) => balance + movement.quantityDelta, 0), 10);
  assert.equal(movements.filter((movement) => movement.movementType === 'DISPENSE').length, 1);
});

test('pharmacy dispensing prevents over-dispensing and deducts valid FEFO stock', async () => {
  const fixture = await createPrescriptionFixture();

  assert.notEqual(
    (
      await api
        .post(`/api/records/prescriptions/${fixture.rx.id}/dispense`)
        .set(auth('pharmacy'))
        .send({
          items: [{
            prescribedDrugId: fixture.item.id,
            qtyToDispense: 11
          }]
        })
    ).status,
    200
  );

  const response = await api
    .post(`/api/records/prescriptions/${fixture.rx.id}/dispense`)
    .set(auth('pharmacy'))
    .send({
      items: [{
        prescribedDrugId: fixture.item.id,
        qtyToDispense: 10
      }]
    });

  assert.equal(response.status, 200);

  assert.equal(
    (
      await prisma.inventoryBatch.findUnique({
        where: { id: fixture.early.id }
      })
    ).qtyOnHand,
    10
  );
});

test('consultation payment gate blocks the doctor until the server-priced consultation invoice is fully paid', async () => {
  fixtureCounter += 1;

  const consultationFee = Number(doctor1.consultationFee);
  assert.ok(consultationFee > 1);

  const appointment = await prisma.appointment.create({
    data: {
      patientId: patient1.id,
      doctorId: doctor1.id,
      appointmentDate: '2042-04-01',
      appointmentTime: `14:${String(fixtureCounter % 60).padStart(2, '0')}`,
      status: 'CHECKED_IN'
    }
  });

  const blockedWithoutInvoice = await api
    .put(`/api/appointments/${appointment.id}/status`)
    .set(auth('doctor'))
    .send({ status: 'IN_CONSULTATION' });

  assert.equal(blockedWithoutInvoice.status, 409);
  assert.equal(
    blockedWithoutInvoice.body.error.code,
    'CONSULTATION_PAYMENT_REQUIRED'
  );

  const invoicePayload = {
    patientId: patient1.id,
    appointmentId: appointment.id,
    invoiceType: 'CONSULTATION',

    // Deliberately forged. Backend must ignore this value.
    items: [{
      descriptionAr: 'سعر مزور',
      descriptionEn: 'Tampered consultation',
      qty: 1,
      unitPriceSdg: 1
    }]
  };

  const created = await api
    .post('/api/billing/invoice')
    .set(auth('reception'))
    .send(invoicePayload);

  assert.equal(created.status, 201);
  assert.equal(created.body.invoice.invoiceType, 'CONSULTATION');
  assert.equal(
    Number(created.body.invoice.totalAmountSdg),
    consultationFee
  );
  assert.equal(
    Number(created.body.invoice.items[0].unitPriceSdg),
    consultationFee
  );

  const duplicate = await api
    .post('/api/billing/invoice')
    .set(auth('reception'))
    .send({
      ...invoicePayload,
      items: [{
        descriptionAr: 'محاولة ثانية',
        descriptionEn: 'Second forged value',
        qty: 1,
        unitPriceSdg: 999999
      }]
    });

  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.existing, true);
  assert.equal(
    duplicate.body.invoice.id,
    created.body.invoice.id
  );

  assert.equal(
    await prisma.invoice.count({
      where: {
        appointmentId: appointment.id,
        invoiceType: 'CONSULTATION'
      }
    }),
    1
  );

  const partialAmount = Math.floor(consultationFee / 2);
  const remainingAmount = consultationFee - partialAmount;

  const partial = await api
    .post(`/api/billing/invoice/${created.body.invoice.id}/payments`)
    .set(paymentAuth('reception'))
    .send({
      payments: [{
        amountSdg: partialAmount,
        paymentMethod: 'CASH'
      }]
    });

  assert.equal(partial.status, 200);
  assert.equal(partial.body.paymentStatus, 'PARTIALLY_PAID');

  const blockedAfterPartial = await api
    .put(`/api/appointments/${appointment.id}/status`)
    .set(auth('doctor'))
    .send({ status: 'IN_CONSULTATION' });

  assert.equal(blockedAfterPartial.status, 409);
  assert.equal(
    blockedAfterPartial.body.error.code,
    'CONSULTATION_PAYMENT_REQUIRED'
  );

  const paid = await api
    .post(`/api/billing/invoice/${created.body.invoice.id}/payments`)
    .set(paymentAuth('reception'))
    .send({
      payments: [{
        amountSdg: remainingAmount,
        paymentMethod: 'CASH'
      }]
    });

  assert.equal(paid.status, 200);
  assert.equal(paid.body.paymentStatus, 'PAID');

  const allowed = await api
    .put(`/api/appointments/${appointment.id}/status`)
    .set(auth('doctor'))
    .send({ status: 'IN_CONSULTATION' });

  assert.equal(allowed.status, 200);

  const persisted = await prisma.appointment.findUnique({
    where: { id: appointment.id }
  });

  assert.equal(persisted.status, 'IN_CONSULTATION');
});

test('billing is restricted and split payments set partial then paid', async () => {
  assert.equal((await api.post('/api/billing/invoice').set(auth('pharmacy')).send({ patientId: patient1.id, items: [{ serviceId: service.id, quantity: 1 }] })).status, 403);
  const invoiceResponse = await api.post('/api/billing/invoice').set(auth('reception')).send({ patientId: patient1.id, items: [{ serviceId: service.id, quantity: 1 }] });
  assert.equal(invoiceResponse.status, 201);
  const id = invoiceResponse.body.invoice.id;
  const total = Number(invoiceResponse.body.invoice.totalAmountSdg);
  const partial = await api.post(`/api/billing/invoice/${id}/payments`).set(paymentAuth('reception')).send({ payments: [{ amountSdg: 40, paymentMethod: 'CASH' }] });
  assert.equal(partial.body.paymentStatus, 'PARTIALLY_PAID');
  assert.equal(partial.body.remainingBalanceSdg, total - 40);
  const paid = await api.post(`/api/billing/invoice/${id}/payments`).set(paymentAuth('reception')).send({ payments: [{ amountSdg: total - 40, paymentMethod: 'CARD', transactionReference: `TEST-${Date.now()}` }] });
  assert.equal(paid.body.paymentStatus, 'PAID');
  assert.equal(paid.body.remainingBalanceSdg, 0);
});

test('GENERAL billing is catalog-authoritative and admin price changes preserve invoice snapshots', async () => {
  const catalogService = await prisma.clinicalService.create({
    data: {
      labelAr: `خدمة أمان ${++fixtureCounter}`,
      labelEn: `Pricing Security Service ${fixtureCounter}`,
      category: 'CLINICAL_PROCEDURE',
      baseFeeSdg: 20000,
      baseFeeUsd: 20000 / 1500,
      status: 'ACTIVE'
    }
  });
  try {
    const legitimate = await api.post('/api/billing/invoice').set(auth('reception')).send({
      patientId: patient1.id,
      invoiceType: 'GENERAL',
      items: [{ serviceId: catalogService.id, quantity: 1 }]
    });
    assert.equal(legitimate.status, 201);
    assert.equal(Number(legitimate.body.invoice.totalAmountSdg), 20000);
    assert.equal(Number(legitimate.body.invoice.items[0].unitPriceSdg), 20000);

    for (const forged of [
      { serviceId: catalogService.id, quantity: 1, unitPrice: 1 },
      { serviceId: catalogService.id, quantity: 1, unitPriceSdg: 1 },
      { serviceId: catalogService.id, quantity: 1, unitPriceUsd: 1 },
      { serviceId: catalogService.id, quantity: 1, price: 1 },
      { serviceId: catalogService.id, quantity: 1, subtotal: 1 },
      { serviceId: catalogService.id, quantity: 1, total: 1 },
      { serviceId: catalogService.id, quantity: 1, amount: 1 },
      { serviceId: catalogService.id, quantity: 1, balance: 0 },
      { serviceId: catalogService.id, quantity: 1, status: 'PAID' }
    ]) {
      const invoiceCountBefore = await prisma.invoice.count({ where: { patientId: patient1.id } });
      const response = await api.post('/api/billing/invoice').set(auth('reception')).send({
        patientId: patient1.id, invoiceType: 'GENERAL', items: [forged]
      });
      assert.equal(response.status, 422);
      assert.equal(response.body.error.code, 'GENERAL_INVOICE_ITEM_INVALID');
      assert.equal(await prisma.invoice.count({ where: { patientId: patient1.id } }), invoiceCountBefore);
    }

    for (const quantity of [0, -1, 1.5, '1', 101]) {
      const response = await api.post('/api/billing/invoice').set(auth('reception')).send({
        patientId: patient1.id,
        invoiceType: 'GENERAL',
        items: [{ serviceId: catalogService.id, quantity }]
      });
      assert.equal(response.status, 422);
    }

    for (const role of ['reception', 'doctor', 'lab', 'pharmacy']) {
      const denied = await api.patch(`/api/admin/pricing/services/${catalogService.id}`).set(auth(role)).send({ priceSdg: 25000 });
      assert.equal(denied.status, 403);
    }
    assert.equal((await api.get('/api/admin/pricing')).status, 401);
    assert.equal((await api.patch(`/api/admin/pricing/services/${catalogService.id}`).send({ priceSdg: 25000 })).status, 401);

    const maxPrice = await api.patch(`/api/admin/pricing/services/${catalogService.id}`)
      .set(auth('admin')).send({ priceSdg: 1_000_000_000 });
    assert.equal(maxPrice.status, 200);
    const maxLine = await api.post('/api/billing/invoice').set(auth('reception')).send({
      patientId: patient1.id, invoiceType: 'GENERAL',
      items: [{ serviceId: catalogService.id, quantity: 100 }]
    });
    assert.equal(maxLine.status, 201);
    assert.equal(Number(maxLine.body.invoice.totalAmountSdg), 100_000_000_000);

    const maximumItems = Array.from({ length: 100 }, () => ({ serviceId: catalogService.id, quantity: 100 }));
    const maximumAggregate = await api.post('/api/billing/invoice').set(auth('reception')).send({
      patientId: patient1.id, invoiceType: 'GENERAL', items: maximumItems
    });
    assert.equal(maximumAggregate.status, 201);
    assert.equal(Number(maximumAggregate.body.invoice.totalAmountSdg), 10_000_000_000_000);
    const aboveMaximum = await api.post('/api/billing/invoice').set(auth('reception')).send({
      patientId: patient1.id, invoiceType: 'GENERAL', items: [...maximumItems, maximumItems[0]]
    });
    assert.equal(aboveMaximum.status, 422);
    assert.equal(aboveMaximum.body.error.code, 'GENERAL_INVOICE_ITEM_LIMIT_EXCEEDED');

    const changed = await api.patch(`/api/admin/pricing/services/${catalogService.id}`).set(auth('admin')).send({ priceSdg: 25000 });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.baseFeeSdg, 25000);
    const historical = await prisma.invoice.findUnique({ where: { id: legitimate.body.invoice.id }, include: { items: true } });
    assert.equal(Number(historical.totalAmountSdg), 20000);
    assert.equal(Number(historical.items[0].unitPriceSdg), 20000);

    const future = await api.post('/api/billing/invoice').set(auth('reception')).send({
      patientId: patient1.id,
      invoiceType: 'GENERAL',
      items: [{ serviceId: catalogService.id, quantity: 1 }]
    });
    assert.equal(future.status, 201);
    assert.equal(Number(future.body.invoice.totalAmountSdg), 25000);

    await api.patch(`/api/admin/pricing/services/${catalogService.id}`).set(auth('admin')).send({ priceSdg: 25000, status: 'INACTIVE' });
    const inactive = await api.post('/api/billing/invoice').set(auth('reception')).send({
      patientId: patient1.id, invoiceType: 'GENERAL', items: [{ serviceId: catalogService.id, quantity: 1 }]
    });
    assert.equal(inactive.status, 404);
    assert.equal(inactive.body.error.code, 'SERVICE_NOT_AVAILABLE');

    const audit = await prisma.tenantAuditLog.findFirst({
      where: { action: 'CLINICAL_SERVICE_PRICE_UPDATED', details: { contains: catalogService.id } },
      orderBy: { timestamp: 'desc' }
    });
    assert.ok(audit);
  } finally {
    await prisma.clinicalService.delete({ where: { id: catalogService.id } });
  }
});

test('billing rejects zero, negative, and overpayments', async () => {
  const invoice = await prisma.invoice.create({ data: { patientId: patient1.id, totalAmountSdg: 100, totalAmountUsd: 1, invoiceExchangeRate: 100, createdBy: 'test' } });
  for (const amount of [0, -1, 101]) {
    const response = await api.post(`/api/billing/invoice/${invoice.id}/payments`).set(paymentAuth('reception')).send({ payments: [{ amountSdg: amount, paymentMethod: 'CASH' }] });
    assert.notEqual(response.status, 200);
  }
});

test('payment retries are idempotent and cannot duplicate ledger rows', async () => {
  const invoice = await prisma.invoice.create({ data: { patientId: patient1.id, totalAmountSdg: 100, totalAmountUsd: 1, invoiceExchangeRate: 100, createdBy: 'test' } });
  const key = `payment-idempotent-${Date.now()}`;
  const body = { payments: [{ amountSdg: 40, paymentMethod: 'CASH' }] };
  const first = await api.post(`/api/billing/invoice/${invoice.id}/payments`).set(paymentAuth('reception', key)).send(body);
  const replay = await api.post(`/api/billing/invoice/${invoice.id}/payments`).set(paymentAuth('reception', key)).send(body);
  assert.equal(first.status, 200);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.idempotentReplay, true);
  assert.equal(await prisma.payment.count({ where: { invoiceId: invoice.id } }), 1);
  assert.equal(Number((await prisma.payment.aggregate({ where: { invoiceId: invoice.id }, _sum: { amountSdg: true } }))._sum.amountSdg), 40);
});

test('competing payments cannot commit beyond the invoice total', async () => {
  const invoice = await prisma.invoice.create({ data: { patientId: patient1.id, totalAmountSdg: 100, totalAmountUsd: 1, invoiceExchangeRate: 100, createdBy: 'test' } });
  const body = { payments: [{ amountSdg: 60, paymentMethod: 'CASH' }] };
  const [left, right] = await Promise.all([
    api.post(`/api/billing/invoice/${invoice.id}/payments`).set(paymentAuth('reception', `payment-race-left-${Date.now()}`)).send(body),
    api.post(`/api/billing/invoice/${invoice.id}/payments`).set(paymentAuth('reception', `payment-race-right-${Date.now()}`)).send(body)
  ]);
  assert.deepEqual([left.status, right.status].sort(), [200, 409]);
  const ledger = await prisma.payment.aggregate({ where: { invoiceId: invoice.id }, _sum: { amountSdg: true } });
  assert.equal(Number(ledger._sum.amountSdg), 60);
  const persisted = await prisma.invoice.findUnique({ where: { id: invoice.id } });
  assert.equal(persisted.paymentStatus, 'PARTIALLY_PAID');
  assert.equal(persisted.ledgerVersion, 1);
});

test('payment idempotency keys cannot be reused with a different request', async () => {
  const invoice = await prisma.invoice.create({ data: { patientId: patient1.id, totalAmountSdg: 100, totalAmountUsd: 1, invoiceExchangeRate: 100, createdBy: 'test' } });
  const key = `payment-reuse-${Date.now()}`;
  assert.equal((await api.post(`/api/billing/invoice/${invoice.id}/payments`).set(paymentAuth('reception', key)).send({ payments: [{ amountSdg: 20, paymentMethod: 'CASH' }] })).status, 200);
  const changed = await api.post(`/api/billing/invoice/${invoice.id}/payments`).set(paymentAuth('reception', key)).send({ payments: [{ amountSdg: 30, paymentMethod: 'CASH' }] });
  assert.equal(changed.status, 409);
  assert.equal(changed.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
});

async function paidInvoice(amount = 100) {
  const invoice = await prisma.invoice.create({ data: { patientId: patient1.id, totalAmountSdg: amount, totalAmountUsd: amount / 100, invoiceExchangeRate: 100, createdBy: 'test' } });
  const response = await api.post(`/api/billing/invoice/${invoice.id}/payments`).set(paymentAuth('reception')).send({ payments: [{ amountSdg: amount, paymentMethod: 'CASH' }] });
  assert.equal(response.status, 200);
  return invoice;
}

test('refund ledger records partial and full reversals with audit history', async () => {
  const invoice = await paidInvoice(100);
  const partialRef = `REF-PARTIAL-${Date.now()}`;
  const partial = await api.post(`/api/billing/invoice/${invoice.id}/refund`).set(auth('reception')).send({ amountSdg: 40, refundMethod: 'CARD', transactionReference: partialRef, reason: 'Patient request' });
  assert.equal(partial.status, 201);
  assert.equal(partial.body.invoice.paymentStatus, 'PARTIALLY_REFUNDED');
  assert.equal(partial.body.refundedSdg, 40);
  assert.equal(partial.body.netCollectedSdg, 60);
  assert.equal(partial.body.refundableSdg, 60);
  assert.equal(partial.body.remainingBalanceSdg, 40);
  assert.equal(Number(partial.body.refund.amountUsd), 0.4);
  const full = await api.post(`/api/billing/invoice/${invoice.id}/refund`).set(auth('reception')).send({ amountSdg: 60, refundMethod: 'CASH' });
  assert.equal(full.status, 201);
  assert.equal(full.body.invoice.paymentStatus, 'REFUNDED');
  assert.equal(full.body.netCollectedSdg, 0);
  assert.equal(full.body.remainingBalanceSdg, 100);
  assert.equal((await prisma.payment.count({ where: { invoiceId: invoice.id } })), 1);
  assert.equal((await prisma.refund.count({ where: { invoiceId: invoice.id } })), 2);
  assert.equal((await prisma.tenantAuditLog.count({ where: { action: 'INVOICE_REFUND', details: { contains: invoice.id } } })), 2);
});

test('refund validation rejects invalid, excessive, duplicate, and unauthorized reversals', async () => {
  const invoice = await paidInvoice(100);
  for (const amount of [0, -1, 101]) {
    const response = await api.post(`/api/billing/invoice/${invoice.id}/refund`).set(auth('reception')).send({ amountSdg: amount, refundMethod: 'CASH' });
    assert.notEqual(response.status, 201);
  }
  assert.equal((await api.post(`/api/billing/invoice/${invoice.id}/refund`).set(auth('pharmacy')).send({ amountSdg: 10, refundMethod: 'CASH' })).status, 403);
  const reference = `REF-DUP-${Date.now()}`;
  assert.equal((await api.post(`/api/billing/invoice/${invoice.id}/refund`).set(auth('admin')).send({ amountSdg: 30, refundMethod: 'BANKAK', transactionReference: reference })).status, 201);
  const other = await paidInvoice(100);
  const duplicate = await api.post(`/api/billing/invoice/${other.id}/refund`).set(auth('reception')).send({ amountSdg: 10, refundMethod: 'BANKAK', transactionReference: reference });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, 'DUPLICATE_REFUND_REFERENCE');
  const paymentReference = `PAYMENT-REF-${Date.now()}`;
  const paymentReferencedInvoice = await prisma.invoice.create({ data: { patientId: patient1.id, totalAmountSdg: 20, totalAmountUsd: 0.2, invoiceExchangeRate: 100, createdBy: 'test', payments: { create: { amountSdg: 20, amountUsd: 0.2, paymentMethod: 'CARD', transactionReference: paymentReference, receivedBy: (await prisma.user.findUnique({ where: { username: 'recep@cms.com' } })).id } } } });
  const paymentReferenceReuse = await api.post(`/api/billing/invoice/${paymentReferencedInvoice.id}/refund`).set(auth('reception')).send({ amountSdg: 5, refundMethod: 'CARD', transactionReference: paymentReference });
  assert.equal(paymentReferenceReuse.status, 409);
  const exceedsRemainder = await api.post(`/api/billing/invoice/${invoice.id}/refund`).set(auth('reception')).send({ amountSdg: 71, refundMethod: 'CASH' });
  assert.equal(exceedsRemainder.status, 409);
  assert.equal(exceedsRemainder.body.error.code, 'REFUND_EXCEEDS_PAID_AMOUNT');
});

test('refund cannot be recorded against an invoice with no paid funds', async () => {
  const invoice = await prisma.invoice.create({ data: { patientId: patient1.id, totalAmountSdg: 100, totalAmountUsd: 1, invoiceExchangeRate: 100, createdBy: 'test' } });
  const response = await api.post(`/api/billing/invoice/${invoice.id}/refund`).set(auth('reception')).send({ amountSdg: 10, refundMethod: 'CASH' });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'NO_PAID_FUNDS');
});

test('billing analytics never fabricates empty operational metrics', async () => {
  const response = await api.get('/api/billing/analytics').set(auth('admin'));
  assert.equal(response.status, 200);
  assert.equal(response.body.averageWaitTimeMinutes, null);
  assert.deepEqual(response.body.waitTimeTrend, []);
  assert.ok(response.body.dailyRevenueTrend.every((item) => Number.isFinite(item.amount) && item.amount >= 0));
  assert.ok(response.body.monthlyRevenueTrend.every((item) => Number.isFinite(item.amount) && item.amount >= 0));
});

test('appointments reject past dates and invalid slots', async () => {
  assert.equal((await api.get(`/api/appointments/slots?doctorId=${doctor1.id}&date=2020-01-01`)).status, 422);
  const response = await api.post('/api/appointments/book').send(await bookingPayload('2030-01-06', '03:00', '0991000010'));
  assert.equal(response.status, 422);
});

test('emergency override and transfer cannot reopen terminal appointments', async () => {
  const completed = await prisma.appointment.create({ data: { patientId: patient1.id, doctorId: doctor1.id, appointmentDate: '2031-01-06', appointmentTime: '11:30', status: 'COMPLETED' } });
  const override = await api.post(`/api/appointments/${completed.id}/override`).set(auth('reception')).send({ justification: 'Verified audit emergency justification' });
  assert.equal(override.status, 409);
  assert.equal(override.body.error.code, 'OVERRIDE_INVALID_STATE');
  const transfer = await api.post(`/api/appointments/${completed.id}/transfer`).set(auth('reception')).send({ targetDoctorId: doctor2.id });
  assert.equal(transfer.status, 409);
  assert.equal(transfer.body.error.code, 'TRANSFER_INVALID_STATE');
  assert.equal((await prisma.appointment.findUnique({ where: { id: completed.id } })).status, 'COMPLETED');
});

test('concurrent booking allows exactly one reservation per active doctor slot', async () => {
  const date = '2030-01-13';
  const payload = await bookingPayload(date, '10:00', '0991000011');
  const responses = await Promise.all([api.post('/api/appointments/book').send(payload), api.post('/api/appointments/book').send(payload)]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
});

test('debug notification endpoint is absent', async () => {
  assert.equal((await api.post('/api/test-notification').send({ userId: 'x', title: 'x', message: 'x' })).status, 404);
});

test('legacy static attachment URL is not exposed', async () => {
  assert.equal((await api.get('/uploads/secret.pdf')).status, 404);
});

test('oversize uploads return a safe 413 validation response', async () => {
  const response = await api.post('/api/upload')
    .set(auth('doctor'))
    .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), { filename: 'oversize.png', contentType: 'image/png' });
  assert.equal(response.status, 413);
  assert.equal(response.body.error.code, 'FILE_TOO_LARGE');
  assert.equal(JSON.stringify(response.body).includes('MulterError'), false);
});


test('patient login reports whether the medical record is linked', async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const email = `linkage-${suffix}@example.com`;
  const phone = `+24991${String(Date.now()).slice(-7)}`;
  const password = 'StrongPass123';

  const register = await api
    .post('/api/patient-auth/register')
    .send({
      fullName: 'Patient Linkage Test',
      fullNameAr: 'مريض اختبار الربط',
      fullNameEn: 'Patient Linkage Test',
      phone,
      email,
      dateOfBirth: '1994-04-15',
      gender: 'MALE',
      password,
      addressStateId: 1
    });

  assert.equal(register.status, 201);
  assert.ok(register.body.challengeId);
  assert.ok(register.body.developmentCode);

  const verify = await api
    .post('/api/patient-auth/verify')
    .send({
      challengeId: register.body.challengeId,
      code: register.body.developmentCode
    });

  assert.equal(verify.status, 200);

  const login = await api
    .post('/api/auth/login')
    .send({
      username: email,
      password
    });

  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, 'PATIENT');
  assert.equal(login.body.user.patientLinked, true);
  assert.ok(login.body.user.patientId);
});


test('pharmacy invoice uses server-authoritative formulary price and ignores browser pricing', async () => {
  const fixture = await createPrescriptionFixture({ paid: false });

  const response = await api
    .post('/api/billing/invoice')
    .set(auth('reception'))
    .send({
      patientId: patient1.id,
      prescriptionId: fixture.rx.id,
      invoiceType: 'PHARMACY',
      items: [{
        descriptionAr: 'سعر مزور',
        descriptionEn: 'Malicious browser price',
        qty: 1,
        unitPriceSdg: 1
      }]
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.invoice.prescriptionId, fixture.rx.id);
  assert.equal(
    Number(response.body.invoice.totalAmountSdg),
    Number(fixture.unitPriceSdg) * fixture.item.qtyPrescribed
  );

  assert.equal(response.body.invoice.items.length, 1);
  assert.equal(
    Number(response.body.invoice.items[0].unitPriceSdg),
    Number(fixture.unitPriceSdg)
  );
  assert.equal(
    response.body.invoice.items[0].qty,
    fixture.item.qtyPrescribed
  );
});

test('duplicate pharmacy invoice requests reuse the same active invoice', async () => {
  const fixture = await createPrescriptionFixture({ paid: false });

  const payload = {
    patientId: patient1.id,
    prescriptionId: fixture.rx.id,
    invoiceType: 'PHARMACY'
  };

  const first = await api
    .post('/api/billing/invoice')
    .set(auth('reception'))
    .send(payload);

  assert.equal(first.status, 201);

  const second = await api
    .post('/api/billing/invoice')
    .set(auth('reception'))
    .send(payload);

  assert.equal(second.status, 200);
  assert.equal(second.body.existing, true);
  assert.equal(second.body.invoice.id, first.body.invoice.id);
});

test('pharmacy invoice rejects formulary medication without configured price', async () => {
  const fixture = await createPrescriptionFixture({
    paid: false,
    unitPriceSdg: null
  });

  const response = await api
    .post('/api/billing/invoice')
    .set(auth('reception'))
    .send({
      patientId: patient1.id,
      prescriptionId: fixture.rx.id,
      invoiceType: 'PHARMACY'
    });

  assert.equal(response.status, 409);
  assert.equal(
    response.body.error.code,
    'PHARMACY_PRICE_NOT_CONFIGURED'
  );
});

test('pharmacy dispensing stays locked until the pharmacy invoice is fully paid', async () => {
  const fixture = await createPrescriptionFixture({ paid: false });

  const invoiceResponse = await api
    .post('/api/billing/invoice')
    .set(auth('reception'))
    .send({
      patientId: patient1.id,
      prescriptionId: fixture.rx.id,
      invoiceType: 'PHARMACY'
    });

  assert.equal(invoiceResponse.status, 201);

  const invoice = invoiceResponse.body.invoice;
  const invoiceTotal = Number(invoice.totalAmountSdg);

  const beforeItem = await prisma.prescribedDrug.findUnique({
    where: { id: fixture.item.id }
  });

  const beforeBatch = await prisma.inventoryBatch.findUnique({
    where: { id: fixture.early.id }
  });

  const beforePayment = await api
    .post(`/api/records/prescriptions/${fixture.rx.id}/dispense`)
    .set(auth('pharmacy'))
    .send({
      items: [{
        prescribedDrugId: fixture.item.id,
        qtyToDispense: 1
      }]
    });

  assert.equal(beforePayment.status, 403);
  assert.equal(
    beforePayment.body.error.code,
    'PHARMACY_PAYMENT_REQUIRED'
  );

  assert.equal(
    (await prisma.prescribedDrug.findUnique({
      where: { id: fixture.item.id }
    })).qtyDispensed,
    beforeItem.qtyDispensed
  );

  assert.equal(
    (await prisma.inventoryBatch.findUnique({
      where: { id: fixture.early.id }
    })).qtyOnHand,
    beforeBatch.qtyOnHand
  );

  const partialAmount = invoiceTotal / 2;

  const partialPayment = await api
    .post(`/api/billing/invoice/${invoice.id}/payments`)
    .set(paymentAuth('reception'))
    .send({
      payments: [{
        amountSdg: partialAmount,
        paymentMethod: 'CASH'
      }]
    });

  assert.equal(partialPayment.status, 200);
  assert.equal(partialPayment.body.paymentStatus, 'PARTIALLY_PAID');

  const afterPartial = await api
    .post(`/api/records/prescriptions/${fixture.rx.id}/dispense`)
    .set(auth('pharmacy'))
    .send({
      items: [{
        prescribedDrugId: fixture.item.id,
        qtyToDispense: 1
      }]
    });

  assert.equal(afterPartial.status, 403);
  assert.equal(
    afterPartial.body.error.code,
    'PHARMACY_PAYMENT_REQUIRED'
  );

  const fullPayment = await api
    .post(`/api/billing/invoice/${invoice.id}/payments`)
    .set(paymentAuth('reception'))
    .send({
      payments: [{
        amountSdg: invoiceTotal - partialAmount,
        paymentMethod: 'CASH'
      }]
    });

  assert.equal(fullPayment.status, 200);
  assert.equal(fullPayment.body.paymentStatus, 'PAID');

  const dispense = await api
    .post(`/api/records/prescriptions/${fixture.rx.id}/dispense`)
    .set(auth('pharmacy'))
    .send({
      items: [{
        prescribedDrugId: fixture.item.id,
        qtyToDispense: 1
      }]
    });

  assert.equal(dispense.status, 200);

  const afterItem = await prisma.prescribedDrug.findUnique({
    where: { id: fixture.item.id }
  });

  const afterBatch = await prisma.inventoryBatch.findUnique({
    where: { id: fixture.early.id }
  });

  assert.equal(afterItem.qtyDispensed, beforeItem.qtyDispensed + 1);
  assert.equal(afterBatch.qtyOnHand, beforeBatch.qtyOnHand - 1);
});


test('reception can view pharmacy billing queue while pharmacist receives read-only payment state', async () => {
  const fixture = await createPrescriptionFixture({ paid: false });

  const receptionQueue = await api
    .get('/api/billing/prescriptions/pending')
    .set(auth('reception'));

  assert.equal(receptionQueue.status, 200);

  const queuedPrescription = receptionQueue.body.find(
    (candidate) => candidate.id === fixture.rx.id
  );

  assert.ok(queuedPrescription);
  assert.equal(queuedPrescription.billingStatus, 'UNBILLED');
  assert.equal(queuedPrescription.invoice, null);
  assert.equal(queuedPrescription.pricingRequired, false);
  assert.equal(queuedPrescription.automaticBillingAvailable, true);
  assert.equal(
    Number(queuedPrescription.estimatedTotalSdg),
    Number(fixture.unitPriceSdg) * fixture.item.qtyPrescribed
  );

  const forbidden = await api
    .get('/api/billing/prescriptions/pending')
    .set(auth('pharmacy'));

  assert.equal(forbidden.status, 403);

  const pharmacyQueueBeforeInvoice = await api
    .get('/api/records/prescriptions/pending')
    .set(auth('pharmacy'));

  assert.equal(pharmacyQueueBeforeInvoice.status, 200);

  const pharmacyRxBeforeInvoice =
    pharmacyQueueBeforeInvoice.body.find(
      (candidate) => candidate.id === fixture.rx.id
    );

  assert.ok(pharmacyRxBeforeInvoice);
  assert.equal(
    pharmacyRxBeforeInvoice.billingStatus,
    'UNBILLED'
  );

  const invoiceResponse = await api
    .post('/api/billing/invoice')
    .set(auth('reception'))
    .send({
      patientId: patient1.id,
      prescriptionId: fixture.rx.id,
      invoiceType: 'PHARMACY'
    });

  assert.equal(invoiceResponse.status, 201);

  const pharmacyQueueAfterInvoice = await api
    .get('/api/records/prescriptions/pending')
    .set(auth('pharmacy'));

  assert.equal(pharmacyQueueAfterInvoice.status, 200);

  const pharmacyRxAfterInvoice =
    pharmacyQueueAfterInvoice.body.find(
      (candidate) => candidate.id === fixture.rx.id
    );

  assert.ok(pharmacyRxAfterInvoice);
  assert.equal(
    pharmacyRxAfterInvoice.billingStatus,
    'UNPAID'
  );
});


async function createCustomMedicationReviewFixture({
  customDrugName
} = {}) {
  fixtureCounter += 1;

  const unique = `${fixtureCounter}-${Date.now()}-${Math.random()}`;
  const day = String((fixtureCounter % 20) + 1).padStart(2, '0');
  const minute = String(fixtureCounter % 60).padStart(2, '0');

  const appointment = await prisma.appointment.create({
    data: {
      patientId: patient1.id,
      doctorId: doctor1.id,
      appointmentDate: `2032-06-${day}`,
      appointmentTime: `11:${minute}`,
      status: 'COMPLETED'
    }
  });

  const record = await prisma.medicalRecord.create({
    data: {
      patientId: patient1.id,
      doctorId: doctor1.id,
      appointmentId: appointment.id,
      symptomsEncrypted: '',
      diagnosisEncrypted: '',
      treatmentEncrypted: '',
      vitalSignsJson: '{}',
      clinicalNotesEncrypted: ''
    }
  });

  const rx = await prisma.prescription.create({
    data: {
      medicalRecordId: record.id,
      patientId: patient1.id,
      doctorId: doctor1.id,
      status: 'ACTIVE',
      prescribedDrugs: {
        create: {
          drugId: null,
          customDrugName:
            customDrugName ||
            `Custom Medication ${unique}`,
          dosage: '1 tablet twice daily',
          duration: '5 days',
          instructionsAr: '',
          instructionsEn: '',
          qtyPrescribed: 4,
          pharmacyReviewStatus: 'PENDING_REVIEW'
        }
      }
    },
    include: {
      prescribedDrugs: true
    }
  });

  return {
    appointment,
    record,
    rx,
    prescribedDrug: rx.prescribedDrugs[0],
    unique
  };
}

async function requestPharmacyInvoiceForFixture(fixture) {
  return api
    .post('/api/billing/invoice')
    .set(auth('reception'))
    .send({
      patientId: patient1.id,
      appointmentId: fixture.appointment.id,
      prescriptionId: fixture.rx.id,
      invoiceType: 'PHARMACY',

      // The server must ignore browser pricing for pharmacy
      // prescriptions and derive the real amount itself.
      items: [
        {
          descriptionAr: 'ignored',
          descriptionEn: 'ignored',
          qty: 1,
          unitPriceSdg: 1
        }
      ]
    });
}

async function createPrescriptionFixture({
  paid = true,
  unitPriceSdg = 2500,
  earlyQty = 20,
  lateQty = 20,
  qtyPrescribed = 10
} = {}) {
  fixtureCounter += 1;
  const fixtureGenericName = `Fixture-${fixtureCounter}-${Date.now()}`;

  const fixtureDrug = await prisma.drugFormulary.create({
    data: {
      brandName: 'Fixture Drug',
      labelAr: 'دواء اختبار',
      labelEn: 'Fixture Drug',
      genericName: fixtureGenericName,
      strength: '1mg',
      dosageForm: 'Tablet',
      identityKey: buildMedicineIdentityKey({
        brandName: 'Fixture Drug',
        genericName: fixtureGenericName,
        strength: '1mg',
        dosageForm: 'Tablet'
      }),
      unitPriceSdg,
      status: 'ACTIVE'
    }
  });

  const appointment = await prisma.appointment.create({
    data: {
      patientId: patient1.id,
      doctorId: doctor1.id,
      appointmentDate: `2031-02-${String(fixtureCounter).padStart(2, '0')}`,
      appointmentTime: '10:00',
      status: 'COMPLETED'
    }
  });

  const record = await prisma.medicalRecord.create({
    data: {
      patientId: patient1.id,
      doctorId: doctor1.id,
      appointmentId: appointment.id,
      symptomsEncrypted: '',
      diagnosisEncrypted: '',
      treatmentEncrypted: '',
      vitalSignsJson: '{}',
      clinicalNotesEncrypted: ''
    }
  });

  const rx = await prisma.prescription.create({
    data: {
      medicalRecordId: record.id,
      patientId: patient1.id,
      doctorId: doctor1.id,
      prescribedDrugs: {
        create: {
          drugId: fixtureDrug.id,
          dosage: '1 daily',
          duration: '10 days',
          instructionsAr: '',
          instructionsEn: '',
          qtyPrescribed
        }
      }
    },
    include: {
      prescribedDrugs: true
    }
  });

  const suffix = `${Date.now()}-${Math.random()}`;

  const early = await prisma.inventoryBatch.create({
    data: {
      drugId: fixtureDrug.id,
      batchNumber: `EARLY-${suffix}`,
      normalizedBatchNumber: normalizeBatchNumber(`EARLY-${suffix}`),
      expiryDate: '2029-01-01',
      qtyOnHand: earlyQty
    }
  });

  const late = await prisma.inventoryBatch.create({
    data: {
      drugId: fixtureDrug.id,
      batchNumber: `LATE-${suffix}`,
      normalizedBatchNumber: normalizeBatchNumber(`LATE-${suffix}`),
      expiryDate: '2030-01-01',
      qtyOnHand: lateQty
    }
  });

  await prisma.stockMovement.createMany({
    data: [early, late].filter((batch) => batch.qtyOnHand > 0).map((batch) => ({
      drugId: fixtureDrug.id,
      inventoryBatchId: batch.id,
      movementType: 'OPENING_BALANCE',
      quantityDelta: batch.qtyOnHand,
      resultingBalance: batch.qtyOnHand,
      actorUserId: null,
      referenceType: 'TEST_FIXTURE_OPENING_BALANCE',
      referenceId: batch.id,
      idempotencyKey: `test:opening-balance:${batch.id}`
    }))
  });

  let invoice = null;

  if (paid) {
    const price = Number(unitPriceSdg);

    if (!Number.isFinite(price) || price <= 0) {
      throw new Error('Paid pharmacy fixture requires a positive unit price.');
    }

    const total = price * qtyPrescribed;

    invoice = await prisma.invoice.create({
      data: {
        patientId: patient1.id,
        appointmentId: appointment.id,
        prescriptionId: rx.id,
        invoiceType: 'PHARMACY',
        totalAmountSdg: total,
        totalAmountUsd: total / 1500,
        invoiceExchangeRate: 1500,
        paymentStatus: 'PAID',
        createdBy: 'integration-test-fixture',
        items: {
          create: {
            descriptionAr: fixtureDrug.labelAr,
            descriptionEn: fixtureDrug.labelEn,
            qty: qtyPrescribed,
            unitPriceSdg: price,
            unitPriceUsd: price / 1500
          }
        }
      }
    });
  }

  return {
    rx,
    item: rx.prescribedDrugs[0],
    drug: fixtureDrug,
    appointment,
    record,
    early,
    late,
    invoice,
    unitPriceSdg
  };
}

async function bookingPayload(date, time, phone) {
  const otp = await api.post('/api/appointments/otp/request').send({ phone });
  assert.equal(otp.status, 200);
  return { doctorId: doctor1.id, appointmentDate: date, appointmentTime: time, fullNameAr: 'مريض حجز', fullNameEn: 'Booking Patient', gender: 'MALE', dateOfBirth: '1990-01-01', phone, addressStateId: 1, otpCode: otp.body.developmentCode };
}


test('patient can securely change verified email', async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const currentEmail = `profile-email-${suffix}@example.com`;
  const newEmail = `profile-email-new-${suffix}@example.com`;
  const phone = `+24991${String(Date.now()).slice(-7)}`;
  const password = 'StrongPass123';

  const register = await api
    .post('/api/patient-auth/register')
    .send({
      fullName: 'Profile Email Test',
      fullNameAr: 'اختبار تغيير البريد',
      fullNameEn: 'Profile Email Test',
      phone,
      email: currentEmail,
      dateOfBirth: '1994-04-15',
      gender: 'MALE',
      password,
      addressStateId: 1
    });

  assert.equal(register.status, 201);
  assert.ok(register.body.developmentCode);

  const verify = await api
    .post('/api/patient-auth/verify')
    .send({
      challengeId: register.body.challengeId,
      code: register.body.developmentCode
    });

  assert.equal(verify.status, 200);

  const login = await api
    .post('/api/auth/login')
    .send({
      username: currentEmail,
      password
    });

  assert.equal(login.status, 200);

  const token = login.body.token;

  const requestChange = await api
    .post('/api/patient/me/email-change/request')
    .set('Authorization', `Bearer ${token}`)
    .send({
      email: newEmail
    });

  assert.equal(requestChange.status, 201);
  assert.ok(requestChange.body.challengeId);
  assert.ok(requestChange.body.developmentCode);

  const confirmChange = await api
    .post('/api/patient/me/email-change/verify')
    .set('Authorization', `Bearer ${token}`)
    .send({
      challengeId: requestChange.body.challengeId,
      code: requestChange.body.developmentCode
    });

  assert.equal(confirmChange.status, 200);
  assert.equal(confirmChange.body.email, newEmail);
  assert.equal(confirmChange.body.emailVerified, true);

  const user = await prisma.user.findUnique({
    where: {
      email: newEmail
    }
  });

  assert.ok(user);
  assert.ok(user.emailVerifiedAt);

  const oldLogin = await api
    .post('/api/auth/login')
    .send({
      username: currentEmail,
      password
    });

  assert.equal(oldLogin.status, 401);

  const newLogin = await api
    .post('/api/auth/login')
    .send({
      username: newEmail,
      password
    });

  assert.equal(newLogin.status, 200);
});


test('patient phone change updates account and patient but remains unverified', async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const email = `profile-phone-${suffix}@example.com`;
  const phone = `+24992${String(Date.now()).slice(-7)}`;
  const newPhone = `+24993${String(Date.now()).slice(-7)}`;
  const password = 'StrongPass123';

  const register = await api
    .post('/api/patient-auth/register')
    .send({
      fullName: 'Profile Phone Test',
      fullNameAr: 'اختبار تغيير الهاتف',
      fullNameEn: 'Profile Phone Test',
      phone,
      email,
      dateOfBirth: '1993-03-12',
      gender: 'MALE',
      password,
      addressStateId: 1
    });

  assert.equal(register.status, 201);
  assert.ok(register.body.developmentCode);

  const verify = await api
    .post('/api/patient-auth/verify')
    .send({
      challengeId: register.body.challengeId,
      code: register.body.developmentCode
    });

  assert.equal(verify.status, 200);

  const login = await api
    .post('/api/auth/login')
    .send({
      username: email,
      password
    });

  assert.equal(login.status, 200);

  const token = login.body.token;
  const userId = login.body.user.id;

  // Phone change is authorized through the current verified email.
  await prisma.user.update({
    where: {
      id: userId
    },
    data: {
      emailVerifiedAt: new Date()
    }
  });

  const requestChange = await api
    .post('/api/patient/me/phone-change/request')
    .set('Authorization', `Bearer ${token}`)
    .send({
      phone: newPhone
    });

  assert.equal(requestChange.status, 201);
  assert.ok(requestChange.body.challengeId);
  assert.ok(requestChange.body.developmentCode);

  const confirmChange = await api
    .post('/api/patient/me/phone-change/verify')
    .set('Authorization', `Bearer ${token}`)
    .send({
      challengeId: requestChange.body.challengeId,
      code: requestChange.body.developmentCode
    });

  assert.equal(confirmChange.status, 200);
  assert.equal(confirmChange.body.phone, newPhone);
  assert.equal(confirmChange.body.phoneVerified, false);

  const updatedUser = await prisma.user.findUnique({
    where: {
      id: userId
    }
  });

  const updatedPatient = await prisma.patient.findUnique({
    where: {
      userId
    }
  });

  assert.equal(updatedUser.phoneNormalized, newPhone);
  assert.equal(updatedUser.phoneVerifiedAt, null);
  assert.equal(updatedPatient.phone, newPhone);
});


test('patient profile persists blood type', async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const email = `profile-blood-${suffix}@example.com`;
  const phone = `+24994${String(Date.now()).slice(-7)}`;
  const password = 'StrongPass123';

  const register = await api
    .post('/api/patient-auth/register')
    .send({
      fullName: 'Profile Blood Type Test',
      fullNameAr: 'اختبار فصيلة الدم',
      fullNameEn: 'Profile Blood Type Test',
      phone,
      email,
      dateOfBirth: '1992-02-10',
      gender: 'MALE',
      password,
      addressStateId: 1
    });

  assert.equal(register.status, 201);
  assert.ok(register.body.developmentCode);

  const verify = await api
    .post('/api/patient-auth/verify')
    .send({
      challengeId: register.body.challengeId,
      code: register.body.developmentCode
    });

  assert.equal(verify.status, 200);

  const login = await api
    .post('/api/auth/login')
    .send({
      username: email,
      password
    });

  assert.equal(login.status, 200);

  const token = login.body.token;
  const userId = login.body.user.id;

  const update = await api
    .patch('/api/patient/me')
    .set('Authorization', `Bearer ${token}`)
    .send({
      bloodType: 'O+'
    });

  assert.equal(update.status, 200);

  const profile = await api
    .get('/api/patient/me')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(profile.status, 200);
  assert.equal(profile.body.bloodType, 'O+');

  const patient = await prisma.patient.findUnique({
    where: {
      userId
    }
  });

  assert.ok(patient);
  assert.equal(patient.bloodType, 'O+');
});

test('patient lab results stay hidden until released and expose released standard and custom tests safely', async () => {
  // -------------------------------------------------------
  // 1. Create a real verified patient portal account.
  // -------------------------------------------------------
  const suffix = `${Date.now()}-${Math.random()}`;
  const email = `lab-patient-${suffix}@example.com`;
  const phone = `+24995${String(Date.now()).slice(-7)}`;
  const password = 'StrongPass123';

  const register = await api
    .post('/api/patient-auth/register')
    .send({
      fullName: 'Laboratory Patient Test',
      fullNameAr: 'مريض اختبار المختبر',
      fullNameEn: 'Laboratory Patient Test',
      phone,
      email,
      dateOfBirth: '1991-05-17',
      gender: 'MALE',
      password,
      addressStateId: 1
    });

  assert.equal(register.status, 201);
  assert.ok(register.body.developmentCode);

  const verify = await api
    .post('/api/patient-auth/verify')
    .send({
      challengeId: register.body.challengeId,
      code: register.body.developmentCode
    });

  assert.equal(verify.status, 200);

  const login = await api
    .post('/api/auth/login')
    .send({
      username: email,
      password
    });

  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, 'PATIENT');

  const patientToken = login.body.token;
  const userId = login.body.user.id;

  const linkedPatient = await prisma.patient.findUnique({
    where: {
      userId
    }
  });

  assert.ok(linkedPatient);

  // -------------------------------------------------------
  // 2. Create a fresh clinical visit for this patient.
  // -------------------------------------------------------
  fixtureCounter += 1;

  const appointment = await prisma.appointment.create({
    data: {
      patientId: linkedPatient.id,
      doctorId: doctor1.id,
      appointmentDate: `2035-04-${String(fixtureCounter).padStart(2, '0')}`,
      appointmentTime: '10:30',
      status: 'IN_CONSULTATION'
    }
  });

  const record = await prisma.medicalRecord.create({
    data: {
      patientId: linkedPatient.id,
      doctorId: doctor1.id,
      appointmentId: appointment.id,
      symptomsEncrypted: '',
      diagnosisEncrypted: '',
      treatmentEncrypted: '',
      vitalSignsJson: '{}',
      clinicalNotesEncrypted: ''
    }
  });

  // -------------------------------------------------------
  // 3. Create a COMPLETED order which has NOT been released.
  //
  // It contains:
  // - a catalogue test
  // - a custom doctor-requested test
  // -------------------------------------------------------
  const order = await prisma.labOrder.create({
    data: {
      medicalRecordId: record.id,
      patientId: linkedPatient.id,
      doctorId: doctor1.id,
      status: 'COMPLETED',
      items: {
        create: [
          {
            serviceId: service.id,
            labReviewStatus: 'NOT_REQUIRED',
            resultValue: '13.5',
            referenceRangeMin: 12,
            referenceRangeMax: 16,
            isOutOfRange: false
          },
          {
            customTestName: 'Custom Vitamin Test',
            serviceId: service.id,
            labReviewStatus: 'APPROVED',
            resultValue: '7.2',
            referenceRangeMin: 8,
            referenceRangeMax: 20,
            isOutOfRange: true
          },
          {
            customTestName: 'External Referral Test',
            labReviewStatus: 'EXTERNAL',
            resultValue: 'must-not-be-exposed'
          }
        ]
      }
    }
  });

  assert.equal(order.releasedToPatientAt, null);

  // -------------------------------------------------------
  // 4. SECURITY:
  // COMPLETED is not enough. It must remain hidden.
  // -------------------------------------------------------
  const beforeRelease = await api
    .get('/api/patient/lab-results')
    .set('Authorization', `Bearer ${patientToken}`);

  assert.equal(beforeRelease.status, 200);

  assert.equal(
    beforeRelease.body.some(
      (item) => item.id === order.id
    ),
    false
  );

  const recordBeforeRelease = await api
    .get(`/api/patient/medical-records/${record.id}`)
    .set('Authorization', `Bearer ${patientToken}`);
  assert.equal(recordBeforeRelease.status, 200);
  assert.deepEqual(recordBeforeRelease.body.releasedLabResults, []);

  // -------------------------------------------------------
  // 5. Lab technician explicitly releases results.
  // -------------------------------------------------------
  const release = await api
    .put(`/api/records/lab-orders/${order.id}/release`)
    .set(auth('lab'));

  assert.equal(release.status, 200);
  assert.equal(release.body.id, order.id);
  assert.ok(release.body.releasedToPatientAt);

  // -------------------------------------------------------
  // 6. Patient should now receive the result.
  // -------------------------------------------------------
  const afterRelease = await api
    .get('/api/patient/lab-results')
    .set('Authorization', `Bearer ${patientToken}`);

  assert.equal(afterRelease.status, 200);

  const releasedOrder = afterRelease.body.find(
    (item) => item.id === order.id
  );

  assert.ok(releasedOrder);
  assert.ok(releasedOrder.releasedAt);
  assert.equal(releasedOrder.tests.length, 2);
  assert.equal(releasedOrder.tests.some((item) => item.customTestName === 'External Referral Test'), false);

  const recordAfterRelease = await api
    .get(`/api/patient/medical-records/${record.id}`)
    .set('Authorization', `Bearer ${patientToken}`);
  assert.equal(recordAfterRelease.status, 200);
  assert.equal(recordAfterRelease.body.releasedLabResults.length, 2);
  assert.deepEqual(
    recordAfterRelease.body.releasedLabResults.map((item) => item.resultValue).sort(),
    ['13.5', '7.2']
  );
  assert.equal(recordAfterRelease.body.releasedLabResults.some((item) => item.testNameEn === 'External Referral Test'), false);

  // -------------------------------------------------------
  // 7. Standard catalogue test.
  // -------------------------------------------------------
  const standardTest = releasedOrder.tests.find(
    (item) => item.service
  );

  assert.ok(standardTest);

  assert.equal(
    standardTest.resultValue,
    '13.5'
  );

  assert.equal(
    standardTest.isOutOfRange,
    false
  );

  assert.ok(standardTest.service.labelEn);
  assert.ok(standardTest.service.labelAr);

  assert.equal(
    Number(standardTest.referenceRangeMin),
    12
  );

  assert.equal(
    Number(standardTest.referenceRangeMax),
    16
  );

  // -------------------------------------------------------
  // 8. Custom/free-text test.
  // -------------------------------------------------------
  const customTest = releasedOrder.tests.find(
    (item) =>
      item.customTestName ===
      'Custom Vitamin Test'
  );

  assert.ok(customTest);

  assert.equal(
    customTest.resultValue,
    '7.2'
  );

  assert.equal(
    customTest.isOutOfRange,
    true
  );

  assert.ok(customTest.service);
  assert.ok(customTest.service.labelEn);

  assert.equal(
    Number(customTest.referenceRangeMin),
    8
  );

  assert.equal(
    Number(customTest.referenceRangeMax),
    20
  );

  // -------------------------------------------------------
  // 9. Persisted release state.
  // -------------------------------------------------------
  const persistedOrder =
    await prisma.labOrder.findUnique({
      where: {
        id: order.id
      }
    });

  assert.ok(
    persistedOrder.releasedToPatientAt
  );

  // -------------------------------------------------------
  // 10. Audit trail.
  // -------------------------------------------------------
  const releaseAudit =
    await prisma.tenantAuditLog.findFirst({
      where: {
        action:
          'LAB_RESULTS_RELEASED_TO_PATIENT',
        details: {
          contains: order.id
        }
      }
    });

  assert.ok(releaseAudit);
});


test('login self-heals orphan patient account by creating missing patient record', async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const email = `orphan-create-${suffix}@example.com`;
  const phone = `+24995${String(Date.now()).slice(-7)}`;
  const password = 'StrongPass123';
  const dateOfBirth = '1991-05-14';

  const register = await api
    .post('/api/patient-auth/register')
    .send({
      fullName: 'Orphan Create Test',
      fullNameAr: 'اختبار إصلاح الحساب',
      fullNameEn: 'Orphan Create Test',
      phone,
      email,
      dateOfBirth,
      gender: 'MALE',
      password,
      addressStateId: 1
    });

  assert.equal(register.status, 201);
  assert.ok(register.body.developmentCode);

  const verify = await api
    .post('/api/patient-auth/verify')
    .send({
      challengeId: register.body.challengeId,
      code: register.body.developmentCode
    });

  assert.equal(verify.status, 200);
  assert.equal(verify.body.state, 'CLAIMED');

  const user = await prisma.user.findUnique({
    where: { email }
  });

  assert.ok(user);

  const originallyLinkedPatient = await prisma.patient.findUnique({
    where: { userId: user.id }
  });

  assert.ok(originallyLinkedPatient);

  // Simulate a legacy/orphan production account:
  // User + PatientRegistration survive, but Patient linkage is missing.
  await prisma.patient.delete({
    where: { id: originallyLinkedPatient.id }
  });

  const registration = await prisma.patientRegistration.findUnique({
    where: { userId: user.id }
  });

  assert.ok(registration);

  const beforeLogin = await prisma.patient.findUnique({
    where: { userId: user.id }
  });

  assert.equal(beforeLogin, null);

  const login = await api
    .post('/api/auth/login')
    .send({
      username: email,
      password
    });

  assert.equal(login.status, 200);
  assert.equal(login.body.user.patientLinked, true);
  assert.ok(login.body.user.patientId);

  const healedPatient = await prisma.patient.findUnique({
    where: { userId: user.id }
  });

  assert.ok(healedPatient);
  assert.equal(healedPatient.fullNameEn, 'Orphan Create Test');
  assert.equal(healedPatient.dateOfBirth, dateOfBirth);
  assert.equal(healedPatient.phone, phone);

  const auditLog = await prisma.tenantAuditLog.findFirst({
    where: {
      userId: user.id,
      action: 'PATIENT_LOGIN_SELF_HEALED'
    },
    orderBy: {
      timestamp: 'desc'
    }
  });

  assert.ok(auditLog);
});


test('login self-heals orphan account by linking exactly one existing unclaimed patient', async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const email = `orphan-link-${suffix}@example.com`;
  const phone = `+24996${String(Date.now()).slice(-7)}`;
  const password = 'StrongPass123';
  const dateOfBirth = '1990-06-16';

  const register = await api
    .post('/api/patient-auth/register')
    .send({
      fullName: 'Orphan Link Test',
      fullNameAr: 'اختبار ربط الحساب',
      fullNameEn: 'Orphan Link Test',
      phone,
      email,
      dateOfBirth,
      gender: 'FEMALE',
      password,
      addressStateId: 1
    });

  assert.equal(register.status, 201);
  assert.ok(register.body.developmentCode);

  const verify = await api
    .post('/api/patient-auth/verify')
    .send({
      challengeId: register.body.challengeId,
      code: register.body.developmentCode
    });

  assert.equal(verify.status, 200);

  const user = await prisma.user.findUnique({
    where: { email }
  });

  assert.ok(user);

  const originalPatient = await prisma.patient.findUnique({
    where: { userId: user.id }
  });

  assert.ok(originalPatient);

  await prisma.patient.delete({
    where: { id: originalPatient.id }
  });

  const existingPatient = await prisma.patient.create({
    data: {
      fullNameAr: 'ملف مريض موجود',
      fullNameEn: 'Existing Patient Record',
      gender: 'FEMALE',
      dateOfBirth,
      phone,
      addressStateId: 1,
      emergencyContact: 'Self',
      status: 'ACTIVE'
    }
  });

  const patientCountBefore = await prisma.patient.count({
    where: {
      dateOfBirth,
      phone
    }
  });

  assert.equal(patientCountBefore, 1);

  const login = await api
    .post('/api/auth/login')
    .send({
      username: email,
      password
    });

  assert.equal(login.status, 200);
  assert.equal(login.body.user.patientLinked, true);
  assert.equal(login.body.user.patientId, existingPatient.id);

  const linkedPatient = await prisma.patient.findUnique({
    where: { id: existingPatient.id }
  });

  assert.equal(linkedPatient.userId, user.id);

  const patientCountAfter = await prisma.patient.count({
    where: {
      dateOfBirth,
      phone
    }
  });

  // No duplicate Patient should have been created.
  assert.equal(patientCountAfter, 1);
});


test('login does not auto-link orphan account when multiple patient records match', async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const email = `orphan-ambiguous-${suffix}@example.com`;
  const phone = `+24997${String(Date.now()).slice(-7)}`;
  const password = 'StrongPass123';
  const dateOfBirth = '1989-07-17';

  const register = await api
    .post('/api/patient-auth/register')
    .send({
      fullName: 'Orphan Ambiguous Test',
      fullNameAr: 'اختبار التطابق المتعدد',
      fullNameEn: 'Orphan Ambiguous Test',
      phone,
      email,
      dateOfBirth,
      gender: 'MALE',
      password,
      addressStateId: 1
    });

  assert.equal(register.status, 201);
  assert.ok(register.body.developmentCode);

  const verify = await api
    .post('/api/patient-auth/verify')
    .send({
      challengeId: register.body.challengeId,
      code: register.body.developmentCode
    });

  assert.equal(verify.status, 200);

  const user = await prisma.user.findUnique({
    where: { email }
  });

  assert.ok(user);

  const originalPatient = await prisma.patient.findUnique({
    where: { userId: user.id }
  });

  assert.ok(originalPatient);

  await prisma.patient.delete({
    where: { id: originalPatient.id }
  });

  const firstPatient = await prisma.patient.create({
    data: {
      fullNameAr: 'المريض المطابق الأول',
      fullNameEn: 'First Matching Patient',
      gender: 'MALE',
      dateOfBirth,
      phone,
      addressStateId: 1,
      emergencyContact: 'Self',
      status: 'ACTIVE'
    }
  });

  const secondPatient = await prisma.patient.create({
    data: {
      fullNameAr: 'المريض المطابق الثاني',
      fullNameEn: 'Second Matching Patient',
      gender: 'MALE',
      dateOfBirth,
      phone,
      addressStateId: 1,
      emergencyContact: 'Self',
      status: 'ACTIVE'
    }
  });

  const login = await api
    .post('/api/auth/login')
    .send({
      username: email,
      password
    });

  assert.equal(login.status, 200);

  // Ambiguous identity must NOT be linked automatically.
  assert.equal(login.body.user.patientLinked, false);
  assert.equal(login.body.user.patientId, null);

  const firstAfter = await prisma.patient.findUnique({
    where: { id: firstPatient.id }
  });

  const secondAfter = await prisma.patient.findUnique({
    where: { id: secondPatient.id }
  });

  assert.equal(firstAfter.userId, null);
  assert.equal(secondAfter.userId, null);

  const linkedToUser = await prisma.patient.findUnique({
    where: { userId: user.id }
  });

  assert.equal(linkedToUser, null);
});


test('email-only verification never auto-links an existing medical record', async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const email = `email-only-link-${suffix}@example.com`;
  const phone = `+24998${String(Date.now()).slice(-7)}`;
  const password = 'StrongPass123';
  const dateOfBirth = '1993-08-18';

  const register = await api
    .post('/api/patient-auth/register')
    .send({
      fullName: 'Email Only Security Test',
      fullNameAr: 'اختبار أمان البريد فقط',
      fullNameEn: 'Email Only Security Test',
      phone,
      email,
      dateOfBirth,
      gender: 'MALE',
      password,
      addressStateId: 1
    });

  assert.equal(register.status, 201);
  assert.ok(register.body.challengeId);
  assert.ok(register.body.developmentCode);

  /*
   * Test environment normally creates a PHONE challenge.
   * Convert this challenge to EMAIL so verification proves email ownership
   * while deliberately leaving phoneVerifiedAt null.
   */
  await prisma.verificationChallenge.update({
    where: {
      id: register.body.challengeId
    },
    data: {
      type: 'EMAIL',
      targetNormalized: email
    }
  });

  /*
   * Simulate a legacy clinic record that already exists before
   * the online account is verified.
   */
  const existingPatient = await prisma.patient.create({
    data: {
      fullNameAr: 'ملف طبي سابق',
      fullNameEn: 'Existing Legacy Patient',
      gender: 'MALE',
      dateOfBirth,
      phone,
      addressStateId: 1,
      emergencyContact: 'Self',
      status: 'ACTIVE'
    }
  });

  const verify = await api
    .post('/api/patient-auth/verify')
    .send({
      challengeId: register.body.challengeId,
      code: register.body.developmentCode
    });

  assert.equal(verify.status, 200);

  // Email ownership alone must never grant access to an existing
  // medical record matched by phone + DOB.
  assert.equal(verify.body.state, 'MANUAL_REVIEW_REQUIRED');
  assert.equal(verify.body.reason, 'VERIFIED_PHONE_REQUIRED');

  const user = await prisma.user.findUnique({
    where: {
      email
    },
    select: {
      id: true,
      status: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true
    }
  });

  assert.ok(user);
  assert.equal(user.status, 'ACTIVE');
  assert.ok(user.emailVerifiedAt);
  assert.equal(user.phoneVerifiedAt, null);

  const patientAfterVerify = await prisma.patient.findUnique({
    where: {
      id: existingPatient.id
    },
    select: {
      userId: true
    }
  });

  assert.equal(patientAfterVerify.userId, null);

  const linkedAfterVerify = await prisma.patient.findUnique({
    where: {
      userId: user.id
    }
  });

  assert.equal(linkedAfterVerify, null);

  /*
   * Login self-healing must obey the same security rule.
   */
  const login = await api
    .post('/api/auth/login')
    .send({
      username: email,
      password
    });

  assert.equal(login.status, 200);
  assert.equal(login.body.user.patientLinked, false);
  assert.equal(login.body.user.patientId, null);

  const patientAfterLogin = await prisma.patient.findUnique({
    where: {
      id: existingPatient.id
    },
    select: {
      userId: true
    }
  });

  assert.equal(patientAfterLogin.userId, null);

  const linkedAfterLogin = await prisma.patient.findUnique({
    where: {
      userId: user.id
    }
  });

  assert.equal(linkedAfterLogin, null);
});
