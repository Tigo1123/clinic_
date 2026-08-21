import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
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
import { decryptMfaSecret } from '../src/services/mfaCrypto.js';
import {
  consumeMfaChallenge,
  consumeRecoveryCode,
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
});

test('strict access-token contract protects HTTP authentication', async () => {
  const admin = await prisma.user.findUnique({ where: { username: 'admin@cms.com' } });
  const baseClaims = { id: admin.id, username: admin.username, role: admin.role };
  const protectedPath = '/api/auth/users';

  assert.equal((await api.get(protectedPath).set(auth('admin'))).status, 200);

  const invalidTokens = [
    signTestToken({ ...baseClaims, typ: 'mfa_challenge' }),
    signTestToken(baseClaims),
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
  const roleMismatch = signAccessToken({ id: reception.id, username: reception.username, role: 'ADMIN' });
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
});

test('WebSocket authentication uses the strict access-token contract', async () => {
  const valid = await checkSocketToken(tokens.doctor);
  assert.equal(valid.error, null);
  assert.equal(valid.socket.user.typ, 'access');
  assert.equal(valid.socket.user.role, 'DOCTOR');

  const doctor = await prisma.user.findUnique({ where: { username: 'doctor@cms.com' } });
  const baseClaims = { id: doctor.id, username: doctor.username, role: doctor.role };
  for (const token of [
    signTestToken({ ...baseClaims, typ: 'mfa_challenge' }),
    signTestToken({ ...baseClaims, typ: 'access' }, { issuer: 'wrong-issuer' }),
    signTestToken({ ...baseClaims, typ: 'access' }, { audience: 'wrong-audience' })
  ]) {
    const rejected = await checkSocketToken(token);
    assert.ok(rejected.error instanceof Error);
    assert.equal(rejected.socket.user, undefined);
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
  const staffToken = signAccessToken({ id: staff.id, username: staff.username, role: staff.role });
  const patientToken = signAccessToken({ id: patient.id, username: patient.username, role: patient.role });

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

  const challenge = await createMfaChallenge(staff.id);
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

  const limited = await createMfaChallenge(staff.id);
  const limitedRecord = await findMfaChallenge(limited.token);
  for (let attempt = 0; attempt < 5; attempt += 1) await recordMfaChallengeFailure(limitedRecord.id);
  assert.equal(await findMfaChallenge(limited.token), null);

  const expired = await createMfaChallenge(staff.id);
  await prisma.mfaChallenge.update({ where: { id: expired.challengeId }, data: { expiresAt: new Date(Date.now() - 1) } });
  assert.equal(await findMfaChallenge(expired.token), null);

  const replayCode = confirmation.body.recoveryCodes[0];
  const recoveryResults = await Promise.all([
    consumeRecoveryCode(staff.id, replayCode),
    consumeRecoveryCode(staff.id, replayCode)
  ]);
  assert.deepEqual(recoveryResults.sort(), [false, true]);

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
  for (const action of ['MFA_ENROLLMENT_STARTED', 'MFA_ENABLED', 'MFA_ENROLLMENT_FAILED', 'MFA_CHALLENGE_CREATED', 'MFA_VERIFICATION_FAILED', 'MFA_VERIFICATION_SUCCEEDED', 'MFA_RECOVERY_CODES_REGENERATED', 'MFA_DISABLED']) {
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

test('pharmacist can update medication price and the change is audited', async () => {
  assert.ok(drug);

  const freshDrug = await prisma.drugFormulary.findUnique({
    where: { id: drug.id }
  });

  const originalPrice =
    freshDrug.unitPriceSdg == null
      ? null
      : Number(freshDrug.unitPriceSdg);

  const testPrice =
    originalPrice === 7777
      ? 8888
      : 7777;

  try {
    const response = await api
      .patch(`/api/records/drugs/${drug.id}/price`)
      .set(auth('pharmacy'))
      .send({
        unitPriceSdg: testPrice
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.drug.id, drug.id);
    assert.equal(
      Number(response.body.drug.unitPriceSdg),
      testPrice
    );

    const storedDrug = await prisma.drugFormulary.findUnique({
      where: { id: drug.id }
    });

    assert.equal(
      Number(storedDrug.unitPriceSdg),
      testPrice
    );

    const auditEntries = await prisma.tenantAuditLog.findMany({
      where: {
        action: `PHARMACY_DRUG_PRICE_UPDATED:${drug.id}`
      }
    });

    const matchingAudit = auditEntries.find((entry) => {
      try {
        const details = JSON.parse(entry.details);

        return (
          details.drugId === drug.id &&
          Number(details.newPriceSdg) === testPrice
        );
      } catch {
        return false;
      }
    });

    assert.ok(
      matchingAudit,
      'Expected medication price update audit log'
    );
  } finally {
    await prisma.drugFormulary.update({
      where: { id: drug.id },
      data: {
        unitPriceSdg: originalPrice
      }
    });
  }
});

test('only pharmacists can update medication prices', async () => {
  assert.ok(drug);

  const before = await prisma.drugFormulary.findUnique({
    where: { id: drug.id }
  });

  const beforePrice =
    before.unitPriceSdg == null
      ? null
      : Number(before.unitPriceSdg);

  const forbiddenRoles = [
    'admin',
    'reception',
    'doctor',
    'lab'
  ];

  for (const role of forbiddenRoles) {
    const response = await api
      .patch(`/api/records/drugs/${drug.id}/price`)
      .set(auth(role))
      .send({
        unitPriceSdg: 9999
      });

    assert.equal(
      response.status,
      403,
      `${role} must not be allowed to update medication prices`
    );
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

test('medication pricing rejects invalid prices without changing the drug', async () => {
  assert.ok(drug);

  const before = await prisma.drugFormulary.findUnique({
    where: { id: drug.id }
  });

  const beforePrice =
    before.unitPriceSdg == null
      ? null
      : Number(before.unitPriceSdg);

  const invalidPrices = [
    0,
    -100,
    12.5,
    'invalid'
  ];

  for (const invalidPrice of invalidPrices) {
    const response = await api
      .patch(`/api/records/drugs/${drug.id}/price`)
      .set(auth('pharmacy'))
      .send({
        unitPriceSdg: invalidPrice
      });

    assert.equal(response.status, 422);
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
      labelAr: 'دواء ربط اختبار',
      labelEn: `Linked Review Drug ${fixture.unique}`,
      genericName: `LinkedGeneric-${fixture.unique}`,
      strength: '500mg',
      dosageForm: 'Tablet',
      unitPriceSdg: 4500
    }
  });

  await prisma.inventoryBatch.create({
    data: {
      drugId: targetDrug.id,
      batchNumber: `LINK-${fixture.unique}`,
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

test('pharmacist can create a new formulary medicine with price and initial stock', async () => {
  const fixture =
    await createCustomMedicationReviewFixture({
      customDrugName: `Cefixime Review ${Date.now()}`
    });

  const labelEn =
    `Cefixime Review ${fixture.unique}`;

  const genericName =
    `Cefixime-${fixture.unique}`;

  const review = await api
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

  assert.equal(
    Number(stored.drug.unitPriceSdg),
    6000
  );

  assert.equal(
    stored.drug.inventoryBatches.length,
    1
  );

  assert.equal(
    stored.drug.inventoryBatches[0].qtyOnHand,
    40
  );

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

  const billing =
    await requestPharmacyInvoiceForFixture(fixture);

  assert.equal(billing.status, 201);

  const invoiceCount = await prisma.invoice.count({
    where: {
      prescriptionId: fixture.rx.id,
      invoiceType: 'PHARMACY'
    }
  });

  assert.equal(invoiceCount, 1);
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

test('lab tech can create and price a reusable service while invalid and duplicate prices are rejected', async () => {
  const invalid = await createLabReviewFixture(`Invalid Price ${fixtureCounter}`, { includeStandard: false });
  for (const price of [0, -1, 1.5]) {
    const response = await api.post(`/api/records/lab-order-items/${invalid.customItem.id}/review`).set(auth('lab')).send({
      decision: 'CREATE_SERVICE', service: { labelAr: 'فحص سعر غير صالح', labelEn: `Invalid Price ${fixtureCounter}`, baseFeeSdg: price }
    });
    assert.equal(response.status, 422);
    assert.equal(response.body?.error?.code || response.body?.code, 'LAB_SERVICE_PRICE_INVALID');
  }

  const fixture = await createLabReviewFixture(`Reusable Test ${fixtureCounter}`, { includeStandard: false });
  const labelEn = `Reusable Test ${fixtureCounter}`;
  const created = await api.post(`/api/records/lab-order-items/${fixture.customItem.id}/review`).set(auth('lab')).send({
    decision: 'CREATE_SERVICE', service: { labelAr: `فحص قابل لإعادة الاستخدام ${fixtureCounter}`, labelEn, baseFeeSdg: 23000 }
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.service.category, 'LABORATORY');
  assert.equal(Number(created.body.service.baseFeeSdg), 23000);

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
  assert.equal(Number(futureInvoice.body.invoice.totalAmountSdg), 23000);

  const duplicate = await createLabReviewFixture(`Duplicate ${fixtureCounter}`, { includeStandard: false });
  const duplicateResponse = await api.post(`/api/records/lab-order-items/${duplicate.customItem.id}/review`).set(auth('lab')).send({
    decision: 'CREATE_SERVICE', service: { labelAr: `  ${created.body.service.labelAr.toUpperCase()}  `, labelEn: `  ${labelEn.toUpperCase()}  `, baseFeeSdg: 24000 }
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
    .send({ resultValue: '13.5' });

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
    .send({ resultValue: '13.5' });

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
    .send({ resultValue: '13.5' });

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
});

test('pharmacy dispensing splits quantity across multiple FEFO batches', async () => {
  const fixture = await createPrescriptionFixture();

  await prisma.prescribedDrug.update({
    where: { id: fixture.item.id },
    data: { qtyPrescribed: 20 }
  });

  await prisma.inventoryBatch.update({
    where: { id: fixture.early.id },
    data: { qtyOnHand: 8 }
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
        qtyToDispense: 20
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
  assert.equal(prescribedDrug.qtyDispensed, 20);
  assert.equal(prescription.status, 'FILLED');
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
  assert.equal((await api.post('/api/billing/invoice').set(auth('pharmacy')).send({ patientId: patient1.id, items: [{ descriptionAr: 'x', descriptionEn: 'x', qty: 1, unitPriceSdg: 100 }] })).status, 403);
  const invoiceResponse = await api.post('/api/billing/invoice').set(auth('reception')).send({ patientId: patient1.id, items: [{ descriptionAr: 'اختبار', descriptionEn: 'Test', qty: 1, unitPriceSdg: 100 }] });
  assert.equal(invoiceResponse.status, 201);
  const id = invoiceResponse.body.invoice.id;
  const partial = await api.post(`/api/billing/invoice/${id}/payments`).set(paymentAuth('reception')).send({ payments: [{ amountSdg: 40, paymentMethod: 'CASH' }] });
  assert.equal(partial.body.paymentStatus, 'PARTIALLY_PAID');
  assert.equal(partial.body.remainingBalanceSdg, 60);
  const paid = await api.post(`/api/billing/invoice/${id}/payments`).set(paymentAuth('reception')).send({ payments: [{ amountSdg: 60, paymentMethod: 'CARD', transactionReference: `TEST-${Date.now()}` }] });
  assert.equal(paid.body.paymentStatus, 'PAID');
  assert.equal(paid.body.remainingBalanceSdg, 0);
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

async function createPrescriptionFixture({ paid = true, unitPriceSdg = 2500 } = {}) {
  fixtureCounter += 1;

  const fixtureDrug = await prisma.drugFormulary.create({
    data: {
      labelAr: 'دواء اختبار',
      labelEn: 'Fixture Drug',
      genericName: `Fixture-${fixtureCounter}-${Date.now()}`,
      strength: '1mg',
      dosageForm: 'Tablet',
      unitPriceSdg
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
          qtyPrescribed: 10
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
      expiryDate: '2029-01-01',
      qtyOnHand: 20
    }
  });

  const late = await prisma.inventoryBatch.create({
    data: {
      drugId: fixtureDrug.id,
      batchNumber: `LATE-${suffix}`,
      expiryDate: '2030-01-01',
      qtyOnHand: 20
    }
  });

  let invoice = null;

  if (paid) {
    const price = Number(unitPriceSdg);

    if (!Number.isFinite(price) || price <= 0) {
      throw new Error('Paid pharmacy fixture requires a positive unit price.');
    }

    const total = price * 10;

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
            qty: 10,
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
