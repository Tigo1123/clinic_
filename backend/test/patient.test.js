import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import prisma from '../src/db.js';
import { app, httpServer } from '../src/server.js';
import { encrypt } from '../src/utils/encryption.js';
import { accessTokenAudience, accessTokenIssuer, verifyAccessToken } from '../src/services/accessTokens.js';

const api = request(app);
const password = 'StrongPass123';
let adminToken;
let receptionToken;
let doctorToken;
let labToken;
let pharmacyToken;
let patientA;
let patientB;
let doctor;

const auth = (token) => ({ Authorization: `Bearer ${token}` });
async function login(username, pass = password) {
  const response = await api.post('/api/auth/login').send({ username, password: pass });
  return response;
}
async function register(phone, email, overrides = {}) {
  return api.post('/api/patient-auth/register').send({ fullName: 'Online Patient', phone, email, dateOfBirth: '1990-01-01', gender: 'MALE', password, ...overrides });
}
async function registerAndVerify(phone, email, overrides = {}) {
  const registration = await register(phone, email, overrides);
  assert.equal(registration.status, 201);
  const verified = await api.post('/api/patient-auth/verify').send({ challengeId: registration.body.challengeId, code: registration.body.developmentCode });
  assert.equal(verified.status, 200);
  const session = await login(phone);
  assert.equal(session.status, 200);
  const user = await prisma.user.findUnique({ where: { id: session.body.user.id }, include: { patient: true } });
  return { token: session.body.token, user, patient: user.patient, verificationState: verified.body.state };
}

before(async () => {
  adminToken = (await api.post('/api/auth/login').send({ username: 'admin@cms.com', password: 'Admin@123' })).body.token;
  receptionToken = (await api.post('/api/auth/login').send({ username: 'recep@cms.com', password: 'Receptionist@123' })).body.token;
  doctorToken = (await api.post('/api/auth/login').send({ username: 'doctor@cms.com', password: 'Doctor@123' })).body.token;
  labToken = (await api.post('/api/auth/login').send({ username: 'lab@cms.com', password: 'Labtech@123' })).body.token;
  pharmacyToken = (await api.post('/api/auth/login').send({ username: 'pharma@cms.com', password: 'Pharmacist@123' })).body.token;
  doctor = await prisma.doctor.findFirst({ where: { user: { username: 'doctor@cms.com' } } });
  patientA = await registerAndVerify('+250788100001', 'patient-a@example.com');
  patientB = await registerAndVerify('+250788100002', 'patient-b@example.com');
});

after(async () => {
  await prisma.$disconnect();
  if (httpServer.listening) await new Promise((resolve) => httpServer.close(resolve));
});

test('patient registration creates verified user and linked new patient record', () => {
  assert.equal(patientA.user.role, 'PATIENT');
  assert.ok(patientA.user.phoneVerifiedAt);
  assert.equal(patientA.patient.userId, patientA.user.id);
});

test('patient login uses the strict application access-token contract', async () => {
  const claims = verifyAccessToken(patientA.token);
  assert.equal(claims.typ, 'access');
  assert.equal(claims.iss, accessTokenIssuer());
  assert.equal(claims.aud, accessTokenAudience());
  assert.equal(claims.role, 'PATIENT');
  assert.equal(claims.av, patientA.user.authVersion);
  assert.equal((await api.get('/api/patient/me').set(auth(patientA.token))).status, 200);
});

test('duplicate phone and email are rejected', async () => {
  assert.equal((await register('0788100001', 'different@example.com')).status, 409);
  assert.equal((await register('+250788100009', ' PATIENT-A@EXAMPLE.COM ')).status, 409);
});

test('weak password is rejected', async () => {
  assert.equal((await register('+250788100010', 'weak@example.com', { password: 'weak' })).status, 422);
});

test('incorrect password is rejected and patient login succeeds by normalized phone', async () => {
  assert.equal((await login('+250788100001', 'WrongPass123')).status, 401);
  assert.equal((await login('0788100001')).status, 200);
});

test('inactive patient account cannot login', async () => {
  await prisma.user.update({ where: { id: patientB.user.id }, data: { status: 'INACTIVE' } });
  assert.equal((await login('+250788100002')).status, 403);
  await prisma.user.update({ where: { id: patientB.user.id }, data: { status: 'ACTIVE' } });
});

test('expired verification code is rejected', async () => {
  const registration = await register('+250788100011', 'expired@example.com');
  await prisma.verificationChallenge.update({ where: { id: registration.body.challengeId }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const response = await api.post('/api/patient-auth/verify').send({ challengeId: registration.body.challengeId, code: registration.body.developmentCode });
  assert.equal(response.body.error.code, 'VERIFICATION_EXPIRED');
});

test('incorrect verification code is rejected and attempt limit enforced', async () => {
  const registration = await register('+250788100012', 'attempts@example.com');
  for (let i = 0; i < 5; i++) await api.post('/api/patient-auth/verify').send({ challengeId: registration.body.challengeId, code: '000000' });
  const blocked = await api.post('/api/patient-auth/verify').send({ challengeId: registration.body.challengeId, code: registration.body.developmentCode });
  assert.equal(blocked.body.error.code, 'VERIFICATION_ATTEMPTS_EXCEEDED');
});

test('verification code is single-use', async () => {
  const registration = await register('+250788100013', 'reuse@example.com');
  assert.equal((await api.post('/api/patient-auth/verify').send({ challengeId: registration.body.challengeId, code: registration.body.developmentCode })).status, 200);
  const reused = await api.post('/api/patient-auth/verify').send({ challengeId: registration.body.challengeId, code: registration.body.developmentCode });
  assert.equal(reused.body.error.code, 'VERIFICATION_INVALID');
});

test('unique existing patient is automatically linked after verification', async () => {
  const existing = await prisma.patient.create({
    data: {
      fullNameAr: 'موجود',
      fullNameEn: 'Existing',
      gender: 'FEMALE',
      dateOfBirth: '1985-05-05',
      phone: '+250788100020',
      addressStateId: 1,
      emergencyContact: 'Self'
    }
  });

  const registration = await register(
    '+250788100020',
    'claim@example.com',
    { dateOfBirth: '1985-05-05', gender: 'FEMALE' }
  );

  const verification = await api.post('/api/patient-auth/verify').send({
    challengeId: registration.body.challengeId,
    code: registration.body.developmentCode
  });

  assert.equal(verification.status, 200);
  assert.equal(verification.body.state, 'CLAIMED');

  const linkedPatient = await prisma.patient.findUnique({
    where: { id: existing.id }
  });

  assert.equal(linkedPatient.userId, registration.body.userId);

  const session = await login('+250788100020');
  assert.equal(session.status, 200);

  const profile = await api
    .get('/api/patient/me')
    .set(auth(session.body.token));

  assert.equal(profile.status, 200);
  assert.equal(profile.body.id, existing.id);
});

test('ambiguous existing match is never automatically claimed', async () => {
  for (let i = 0; i < 2; i++) await prisma.patient.create({ data: { fullNameAr: `ملتبس ${i}`, fullNameEn: `Ambiguous ${i}`, gender: 'MALE', dateOfBirth: '1984-04-04', phone: '+250788100021', addressStateId: 1, emergencyContact: 'Self' } });
  const registration = await register('+250788100021', 'ambiguous@example.com', { dateOfBirth: '1984-04-04' });
  const response = await api.post('/api/patient-auth/verify').send({ challengeId: registration.body.challengeId, code: registration.body.developmentCode });
  assert.equal(response.body.state, 'AMBIGUOUS_MATCH');
});

test('auto-link assigns an existing patient to only one verified account', async () => {
  const existing = await prisma.patient.create({
    data: {
      fullNameAr: 'سباق',
      fullNameEn: 'Auto Link Race',
      gender: 'MALE',
      dateOfBirth: '1983-03-03',
      phone: '+250788100022',
      addressStateId: 1,
      emergencyContact: 'Self'
    }
  });

  const registration = await register(
    '+250788100022',
    'claim-race@example.com',
    { dateOfBirth: '1983-03-03' }
  );

  const verification = await api.post('/api/patient-auth/verify').send({
    challengeId: registration.body.challengeId,
    code: registration.body.developmentCode
  });

  assert.equal(verification.status, 200);
  assert.equal(verification.body.state, 'CLAIMED');

  const linked = await prisma.patient.findUnique({
    where: { id: existing.id }
  });

  assert.equal(linked.userId, registration.body.userId);

  const issued = await api
    .post(`/api/patient-auth/claims/${existing.id}/code`)
    .set(auth(receptionToken));

  assert.equal(issued.status, 409);
  assert.equal(issued.body.error.code, 'PATIENT_ALREADY_CLAIMED');
});

test('patient A gets own profile and cannot address patient B through staff API', async () => {
  assert.equal((await api.get('/api/patient/me').set(auth(patientA.token))).status, 200);
  assert.equal((await api.get(`/api/patients/${patientB.patient.id}/profile`).set(auth(patientA.token))).status, 403);
});

test('PATIENT role is denied every staff mutation surface', async () => {
  const checks = await Promise.all([
    api.get('/api/admin/analytics').set(auth(patientA.token)),
    api.get('/api/auth/users').set(auth(patientA.token)),
    api.get('/api/patients/search?q=a').set(auth(patientA.token)),
    api.post('/api/records').set(auth(patientA.token)).send({}),
    api.get('/api/records/lab-orders/pending').set(auth(patientA.token)),
    api.get('/api/records/prescriptions/pending').set(auth(patientA.token)),
    api.post('/api/billing/invoice').set(auth(patientA.token)).send({}),
    api.put('/api/records/lab-orders/items/00000000-0000-4000-8000-000000000000/results').set(auth(patientA.token)).send({ resultValue: 'x' })
  ]);
  checks.forEach((response) => assert.equal(response.status, 403));
});

test('authenticated booking ignores injected patientId and books for token owner', async () => {
  const response = await api.post('/api/patient/appointments').set(auth(patientA.token)).send({ doctorId: doctor.id, appointmentDate: '2032-01-04', appointmentTime: '10:00', patientId: patientB.patient.id });
  assert.equal(response.status, 201);
  const stored = await prisma.appointment.findUnique({ where: { id: response.body.id } });
  assert.equal(stored.patientId, patientA.patient.id);
});

test('patient sees own appointment but not another patient appointment', async () => {
  const other = await prisma.appointment.create({ data: { patientId: patientB.patient.id, doctorId: doctor.id, appointmentDate: '2032-01-04', appointmentTime: '10:15', status: 'CONFIRMED' } });
  assert.equal((await api.get('/api/patient/appointments').set(auth(patientA.token))).status, 200);
  assert.equal((await api.get(`/api/patient/appointments/${other.id}`).set(auth(patientA.token))).status, 404);
});

test('patient booking rejects past/invalid slots and preserves conflict protection', async () => {
  assert.equal((await api.post('/api/patient/appointments').set(auth(patientA.token)).send({ doctorId: doctor.id, appointmentDate: '2020-01-01', appointmentTime: '10:00' })).status, 422);
  assert.equal((await api.post('/api/patient/appointments').set(auth(patientA.token)).send({ doctorId: doctor.id, appointmentDate: '2032-01-04', appointmentTime: '03:00' })).status, 422);
  const payload = { doctorId: doctor.id, appointmentDate: '2032-01-11', appointmentTime: '10:00' };
  const results = await Promise.all([api.post('/api/patient/appointments').set(auth(patientA.token)).send(payload), api.post('/api/patient/appointments').set(auth(patientB.token)).send(payload)]);
  assert.deepEqual(results.map((item) => item.status).sort(), [201, 409]);
});

test('patient cancellation obeys ownership and state rules', async () => {
  const own = await prisma.appointment.create({ data: { patientId: patientA.patient.id, doctorId: doctor.id, appointmentDate: '2033-01-02', appointmentTime: '11:00', status: 'CONFIRMED' } });
  const other = await prisma.appointment.create({ data: { patientId: patientB.patient.id, doctorId: doctor.id, appointmentDate: '2033-01-02', appointmentTime: '11:15', status: 'CONFIRMED' } });
  assert.equal((await api.post(`/api/patient/appointments/${other.id}/cancel`).set(auth(patientA.token))).status, 404);
  assert.equal((await api.post(`/api/patient/appointments/${own.id}/cancel`).set(auth(patientA.token))).status, 200);
  const completed = await prisma.appointment.create({ data: { patientId: patientA.patient.id, doctorId: doctor.id, appointmentDate: '2033-01-02', appointmentTime: '11:30', status: 'COMPLETED' } });
  assert.equal((await api.post(`/api/patient/appointments/${completed.id}/cancel`).set(auth(patientA.token))).status, 409);
});

test('reschedule conflict preserves the original appointment', async () => {
  const own = await prisma.appointment.create({ data: { patientId: patientA.patient.id, doctorId: doctor.id, appointmentDate: '2033-01-09', appointmentTime: '12:00', status: 'CONFIRMED' } });
  await prisma.appointment.create({ data: { patientId: patientB.patient.id, doctorId: doctor.id, appointmentDate: '2033-01-16', appointmentTime: '12:00', status: 'CONFIRMED' } });
  assert.equal((await api.put(`/api/patient/appointments/${own.id}/reschedule`).set(auth(patientA.token)).send({ doctorId: doctor.id, appointmentDate: '2033-01-16', appointmentTime: '12:00' })).status, 409);
  assert.equal((await prisma.appointment.findUnique({ where: { id: own.id } })).appointmentDate, '2033-01-09');
});

test('patient only receives own released labs, prescriptions, and patient-safe visit fields', async () => {
  const appointment = await prisma.appointment.create({ data: { patientId: patientA.patient.id, doctorId: doctor.id, appointmentDate: '2031-01-05', appointmentTime: '13:00', status: 'COMPLETED' } });
  const record = await prisma.medicalRecord.create({ data: { patientId: patientA.patient.id, doctorId: doctor.id, appointmentId: appointment.id, symptomsEncrypted: encrypt('private symptom'), diagnosisEncrypted: encrypt('patient diagnosis'), treatmentEncrypted: encrypt('patient treatment'), clinicalNotesEncrypted: encrypt('private clinician note'), vitalSignsJson: '{}' } });
  const formulary = await prisma.drugFormulary.findFirst();
  await prisma.prescription.create({ data: { medicalRecordId: record.id, patientId: patientA.patient.id, doctorId: doctor.id, prescribedDrugs: { create: { drugId: formulary.id, dosage: 'Once daily', duration: '5 days', instructionsAr: '', instructionsEn: 'After food', qtyPrescribed: 5 } } } });
  const service = await prisma.clinicalService.findFirst({ where: { category: 'LABORATORY' } });
  const lab = await prisma.labOrder.create({ data: { medicalRecordId: record.id, patientId: patientA.patient.id, doctorId: doctor.id, status: 'COMPLETED', releasedToPatientAt: new Date(), items: { create: { serviceId: service.id, resultValue: '13.5' } } } });
  assert.equal((await api.get('/api/patient/lab-results').set(auth(patientA.token))).body[0].id, lab.id);
  assert.ok((await api.get('/api/patient/prescriptions').set(auth(patientA.token))).body.length > 0);
  const records = await api.get('/api/patient/medical-records').set(auth(patientA.token));
  const safe = records.body.find((item) => item.id === record.id);
  assert.equal(safe.diagnosis, 'patient diagnosis');
  assert.equal(Object.hasOwn(safe, 'clinicalNotes'), false);
  assert.equal(Object.hasOwn(safe, 'symptoms'), false);
  assert.equal((await api.get('/api/patient/lab-results').set(auth(patientB.token))).body.some((item) => item.id === lab.id), false);
  const detail = await api.get(`/api/patient/medical-records/${record.id}`).set(auth(patientA.token));
  assert.equal(detail.status, 200);
  assert.equal(detail.body.diagnosis, 'patient diagnosis');
  assert.equal(detail.body.treatment, 'patient treatment');
  assert.equal(detail.body.prescriptions[0].medicines.length, 1);
  assert.equal(detail.body.releasedLabResults.length, 1);
  assert.equal(detail.body.releasedLabResults[0].resultValue, '13.5');
  assert.equal((await api.get(`/api/patient/medical-records/${record.id}`).set(auth(patientB.token))).status, 404);
});

test('patient medical-record details keep a stable contract for optional visit data', async () => {
  const scenarios = [
    {
      label: 'complete legacy-style record',
      diagnosis: 'Complete diagnosis',
      treatment: 'Complete treatment',
      vitalSignsJson: JSON.stringify({ blood_pressure: '120/80', heart_rate: 72 })
    },
    {
      label: 'record without diagnosis or treatment',
      diagnosis: '',
      treatment: '',
      vitalSignsJson: '{}'
    },
    {
      label: 'record with partial vitals',
      diagnosis: 'Partial vitals',
      treatment: '',
      vitalSignsJson: JSON.stringify({ temperature: '36.8' })
    },
    {
      label: 'record with malformed optional vitals',
      diagnosis: 'Safe malformed vitals',
      treatment: '',
      vitalSignsJson: JSON.stringify({ temperature: { value: '36.8' } })
    }
  ];

  for (const [index, scenario] of scenarios.entries()) {
    const appointment = await prisma.appointment.create({
      data: {
        patientId: patientA.patient.id,
        doctorId: doctor.id,
        appointmentDate: `2031-02-${String(index + 1).padStart(2, '0')}`,
        appointmentTime: '14:00',
        status: 'COMPLETED'
      }
    });
    const record = await prisma.medicalRecord.create({
      data: {
        patientId: patientA.patient.id,
        doctorId: doctor.id,
        appointmentId: appointment.id,
        symptomsEncrypted: encrypt(''),
        diagnosisEncrypted: encrypt(scenario.diagnosis),
        treatmentEncrypted: encrypt(scenario.treatment),
        clinicalNotesEncrypted: encrypt('must remain private'),
        vitalSignsJson: scenario.vitalSignsJson
      }
    });

    const detail = await api
      .get(`/api/patient/medical-records/${record.id}`)
      .set(auth(patientA.token));

    assert.equal(detail.status, 200, scenario.label);
    assert.equal(detail.body.diagnosis, scenario.diagnosis);
    assert.equal(detail.body.treatment, scenario.treatment);
    assert.ok(Array.isArray(detail.body.prescriptions));
    assert.ok(Array.isArray(detail.body.releasedLabResults));
    assert.equal(detail.body.prescriptions.length, 0);
    assert.equal(detail.body.releasedLabResults.length, 0);
    assert.equal(Object.hasOwn(detail.body, 'clinicalNotes'), false);

    for (const value of Object.values(detail.body.vitalSigns)) {
      assert.ok(['string', 'number'].includes(typeof value));
    }
  }
});


test('forgot password sends a reset challenge without exposing unknown emails', async () => {
  const account = await registerAndVerify(
    '+250788100030',
    'forgot-password@example.com'
  );

  const existing = await api
    .post('/api/patient-auth/forgot-password')
    .send({ email: ' FORGOT-PASSWORD@EXAMPLE.COM ' });

  assert.equal(existing.status, 200);
  assert.equal(existing.body.success, true);
  assert.ok(existing.body.challengeId);
  assert.ok(existing.body.developmentCode);

  const unknown = await api
    .post('/api/patient-auth/forgot-password')
    .send({ email: 'does-not-exist@example.com' });

  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.success, true);
  assert.equal(Object.hasOwn(unknown.body, 'challengeId'), false);

  assert.ok(account.user.id);
});

test('wrong password reset code is rejected', async () => {
  const account = await registerAndVerify(
    '+250788100031',
    'reset-wrong@example.com'
  );

  const forgot = await api
    .post('/api/patient-auth/forgot-password')
    .send({ email: 'reset-wrong@example.com' });

  assert.equal(forgot.status, 200);

  const response = await api
    .post('/api/patient-auth/reset-password')
    .send({
      challengeId: forgot.body.challengeId,
      code: '000000',
      newPassword: 'NewStrongPass123'
    });

  assert.equal(response.status, 422);
  assert.equal(
    response.body.error.code,
    'PASSWORD_RESET_CODE_INCORRECT'
  );
  assert.equal((await prisma.user.findUnique({ where: { id: account.user.id } })).authVersion, account.user.authVersion);
});

test('password reset changes password and reset code is single-use', async () => {
  const phone = '+250788100032';
  const email = 'reset-success@example.com';
  const newPassword = 'NewStrongPass123';

  const account = await registerAndVerify(phone, email);
  const secondSession = await login(phone);
  assert.equal(secondSession.status, 200);
  const patientIdBefore = account.patient.id;
  assert.equal((await api.get('/api/patient/me').set(auth(account.token))).status, 200);
  assert.equal((await api.get('/api/patient/me').set(auth(secondSession.body.token))).status, 200);

  const forgot = await api
    .post('/api/patient-auth/forgot-password')
    .send({ email });

  const siblingForgot = await api
    .post('/api/patient-auth/forgot-password')
    .send({ email });

  assert.equal(forgot.status, 200);
  assert.ok(forgot.body.challengeId);
  assert.ok(forgot.body.developmentCode);
  assert.equal(siblingForgot.status, 200);

  const reset = await api
    .post('/api/patient-auth/reset-password')
    .send({
      challengeId: forgot.body.challengeId,
      code: forgot.body.developmentCode,
      newPassword
    });

  assert.equal(reset.status, 200);
  assert.equal(reset.body.success, true);
  const resetUser = await prisma.user.findUnique({ where: { id: account.user.id }, include: { patient: true } });
  assert.equal(resetUser.authVersion, account.user.authVersion + 1);
  assert.equal(resetUser.patient.id, patientIdBefore);
  for (const token of [account.token, secondSession.body.token]) {
    const rejected = await api.get('/api/patient/me').set(auth(token));
    assert.equal(rejected.status, 401);
    assert.equal(rejected.body.error.code, 'SESSION_REVOKED');
  }

  // Old password must stop working.
  assert.equal((await login(phone, password)).status, 401);

  // New password must work.
  const newSession = await login(phone, newPassword);
  assert.equal(newSession.status, 200);
  assert.equal(verifyAccessToken(newSession.body.token).av, resetUser.authVersion);

  const invalidatedSibling = await api.post('/api/patient-auth/reset-password').send({
    challengeId: siblingForgot.body.challengeId,
    code: siblingForgot.body.developmentCode,
    newPassword: 'SiblingResetPass123'
  });
  assert.equal(invalidatedSibling.status, 422);
  assert.equal(invalidatedSibling.body.error.code, 'PASSWORD_RESET_INVALID');
  assert.equal((await prisma.user.findUnique({ where: { id: account.user.id } })).authVersion, resetUser.authVersion);

  // The same reset code cannot be reused.
  const reused = await api
    .post('/api/patient-auth/reset-password')
    .send({
      challengeId: forgot.body.challengeId,
      code: forgot.body.developmentCode,
      newPassword: 'AnotherStrongPass123'
    });

  assert.equal(reused.status, 422);
  assert.equal(
    reused.body.error.code,
    'PASSWORD_RESET_INVALID'
  );
});

test('expired password reset code is rejected', async () => {
  await registerAndVerify(
    '+250788100033',
    'reset-expired@example.com'
  );

  const forgot = await api
    .post('/api/patient-auth/forgot-password')
    .send({ email: 'reset-expired@example.com' });

  assert.equal(forgot.status, 200);

  await prisma.verificationChallenge.update({
    where: { id: forgot.body.challengeId },
    data: { expiresAt: new Date(Date.now() - 1000) }
  });

  const response = await api
    .post('/api/patient-auth/reset-password')
    .send({
      challengeId: forgot.body.challengeId,
      code: forgot.body.developmentCode,
      newPassword: 'NewStrongPass123'
    });

  assert.equal(response.status, 422);
  assert.equal(
    response.body.error.code,
    'PASSWORD_RESET_EXPIRED'
  );
});

test('doctor discovery and specialties use real active doctor data', async () => {
  const doctors = await api.get('/api/patient/doctors').set(auth(patientA.token));
  const specialties = await api.get('/api/patient/specialties').set(auth(patientA.token));
  assert.equal(doctors.status, 200);
  assert.ok(doctors.body.length > 0);
  assert.ok(specialties.body.length > 0);
  assert.equal(Object.hasOwn(doctors.body[0], 'weeklySchedule'), false);
});
