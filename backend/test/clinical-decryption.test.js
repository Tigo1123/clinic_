import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import nodemailer from 'nodemailer';
import prisma from '../src/db.js';
import { app, httpServer } from '../src/server.js';
import { decrypt, encrypt } from '../src/utils/encryption.js';

const api = request(app);
let doctorToken;
let patientToken;
let doctor;
let patient;
let patientUser;
let counter = 0;

async function login(username, password) {
  const response = await api.post('/api/auth/login').send({ username, password });
  assert.equal(response.status, 200);
  return response.body.token;
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function createRecord({ status = 'COMPLETED', diagnosis = 'Synthetic diagnosis' } = {}) {
  counter += 1;
  const appointment = await prisma.appointment.create({ data: {
    patientId: patient.id,
    doctorId: doctor.id,
    appointmentDate: `2087-07-${String(counter).padStart(2, '0')}`,
    appointmentTime: '10:00',
    status
  } });
  const record = await prisma.medicalRecord.create({ data: {
    patientId: patient.id,
    doctorId: doctor.id,
    appointmentId: appointment.id,
    symptomsEncrypted: encrypt('Synthetic symptom'),
    diagnosisEncrypted: encrypt(diagnosis),
    treatmentEncrypted: encrypt('Synthetic treatment'),
    clinicalNotesEncrypted: encrypt('Synthetic private note'),
    vitalSignsJson: '{}'
  } });
  return { appointment, record };
}

function assertUnreadableResponse(response, markers = []) {
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, {
    error: { code: 'CLINICAL_DATA_UNREADABLE', message: 'Clinical information is unavailable.' }
  });
  const body = JSON.stringify(response.body);
  for (const marker of markers) assert.equal(body.includes(marker), false);
  assert.doesNotMatch(body, /ciphertext|authentication tag|decrypt|key|stack|Prisma|SQL/i);
}

before(async () => {
  doctorToken = await login('doctor@cms.com', 'Doctor@123');
  doctor = await prisma.doctor.findFirst({ where: { user: { username: 'doctor@cms.com' } } });
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const password = 'ClinicalReadStrong123';
  patientUser = await prisma.user.create({ data: {
    username: `clinical-read-${suffix}@example.test`,
    email: `clinical-read-${suffix}@example.test`,
    passwordHash: await bcrypt.hash(password, 4),
    role: 'PATIENT',
    status: 'ACTIVE',
    emailVerifiedAt: new Date()
  } });
  patient = await prisma.patient.create({ data: {
    userId: patientUser.id,
    fullNameAr: 'مريض اصطناعي',
    fullNameEn: 'Synthetic Patient',
    gender: 'FEMALE',
    dateOfBirth: '1990-01-01',
    phone: `+250788${String(Date.now()).slice(-6)}`,
    addressStateId: 1,
    emergencyContact: 'Synthetic Contact'
  } });
  patientToken = await login(patientUser.username, password);
});

after(async () => {
  await prisma.$disconnect();
  if (httpServer.listening) await new Promise((resolve) => httpServer.close(resolve));
});

test('AES-GCM keeps valid encrypted data and legitimate empty fields distinct', () => {
  const originalKey = process.env.MEDICAL_ENCRYPTION_KEY;
  try {
    process.env.MEDICAL_ENCRYPTION_KEY = 'synthetic-clinical-key-for-regression-tests';
    const plaintext = 'Synthetic diagnosis with punctuation: ;:{}';
    const ciphertext = encrypt(plaintext);
    assert.equal(decrypt(ciphertext), plaintext);
    assert.equal(encrypt(''), '');
    assert.equal(decrypt(''), '');
    assert.equal(decrypt(null), '');
  } finally {
    if (originalKey === undefined) delete process.env.MEDICAL_ENCRYPTION_KEY;
    else process.env.MEDICAL_ENCRYPTION_KEY = originalKey;
  }
});

test('malformed, truncated, tampered ciphertext and wrong keys raise the same sanitized error', () => {
  const originalKey = process.env.MEDICAL_ENCRYPTION_KEY;
  const key = 'synthetic-clinical-key-for-regression-tests';
  try {
    process.env.MEDICAL_ENCRYPTION_KEY = key;
    const ciphertext = encrypt('Synthetic private content');
    const tail = ciphertext.at(-1);
    const tampered = `${ciphertext.slice(0, -1)}${tail === '0' ? '1' : '0'}`;
    const truncated = ciphertext.slice(0, -3);
    for (const invalid of ['not-a-ciphertext-marker', truncated, tampered]) {
      assert.throws(() => decrypt(invalid), (error) => {
        assert.equal(error.code, 'CLINICAL_DATA_UNREADABLE');
        assert.equal(error.message, 'Clinical information is unavailable.');
        assert.equal(error.cause, undefined);
        return true;
      });
    }
    process.env.MEDICAL_ENCRYPTION_KEY = 'different-synthetic-key-for-regression-tests';
    assert.throws(() => decrypt(ciphertext), { code: 'CLINICAL_DATA_UNREADABLE' });
  } finally {
    if (originalKey === undefined) delete process.env.MEDICAL_ENCRYPTION_KEY;
    else process.env.MEDICAL_ENCRYPTION_KEY = originalKey;
  }
});

test('clinical read endpoints return one sanitized error instead of blanks, markers, or ciphertext', async () => {
  const { record } = await createRecord();
  const unreadable = `UNREADABLE-CIPHERTEXT-MARKER-${Date.now()}`;
  await prisma.medicalRecord.update({ where: { id: record.id }, data: { diagnosisEncrypted: unreadable } });
  const originalKey = process.env.MEDICAL_ENCRYPTION_KEY;
  const logged = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logged.push(args.map(String).join(' '));
  try {
    const requests = await Promise.all([
      api.get(`/api/records/${record.id}/summary`).set(auth(doctorToken)),
      api.get(`/api/patients/${patient.id}/history`).set(auth(doctorToken)),
      api.get(`/api/patients/${patient.id}/profile`).set(auth(doctorToken)),
      api.get('/api/patient/medical-records').set(auth(patientToken)),
      api.get(`/api/patient/medical-records/${record.id}`).set(auth(patientToken))
    ]);
    requests.forEach((response) => assertUnreadableResponse(response, [unreadable]));

    process.env.MEDICAL_ENCRYPTION_KEY = 'wrong-synthetic-clinical-key';
    const wrongKeyResponse = await api.get(`/api/records/${record.id}/summary`).set(auth(doctorToken));
    assertUnreadableResponse(wrongKeyResponse);
    assert.deepEqual(logged, []);
  } finally {
    console.error = originalConsoleError;
    if (originalKey === undefined) delete process.env.MEDICAL_ENCRYPTION_KEY;
    else process.env.MEDICAL_ENCRYPTION_KEY = originalKey;
  }
});

test('an unreadable required field prevents emailed summary delivery and leaves stored data unchanged', async () => {
  const { appointment, record } = await createRecord({ diagnosis: 'Synthetic email diagnosis' });
  const unreadable = `UNREADABLE-EMAIL-CIPHERTEXT-${Date.now()}`;
  await prisma.medicalRecord.update({ where: { id: record.id }, data: { diagnosisEncrypted: unreadable } });
  const beforeRecord = await prisma.medicalRecord.findUnique({ where: { id: record.id } });
  const beforeAppointment = await prisma.appointment.findUnique({ where: { id: appointment.id } });
  const beforeLogs = await prisma.notificationLog.count();
  const originalCreateTransport = nodemailer.createTransport;
  const originalEnvironment = Object.fromEntries(['NOTIFICATIONS_DISABLED', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM_EMAIL'].map((name) => [name, process.env[name]]));
  let outgoingMessages = 0;
  nodemailer.createTransport = () => ({ sendMail: async () => { outgoingMessages += 1; return { messageId: 'synthetic-never-sent' }; } });
  Object.assign(process.env, {
    NOTIFICATIONS_DISABLED: 'false', SMTP_HOST: 'smtp.synthetic.test', SMTP_PORT: '2525',
    SMTP_USER: 'synthetic-user', SMTP_PASS: 'synthetic-password', SMTP_FROM_EMAIL: 'clinic@example.test'
  });
  try {
    const response = await api.post(`/api/records/${record.id}/send-summary`).set(auth(doctorToken)).send({});
    assertUnreadableResponse(response, [unreadable, 'Synthetic email diagnosis']);
    assert.equal(outgoingMessages, 0);
    assert.equal(await prisma.notificationLog.count(), beforeLogs);
    assert.equal((await prisma.medicalRecord.findUnique({ where: { id: record.id } })).diagnosisEncrypted, beforeRecord.diagnosisEncrypted);
    assert.equal((await prisma.appointment.findUnique({ where: { id: appointment.id } })).status, beforeAppointment.status);
  } finally {
    nodemailer.createTransport = originalCreateTransport;
    for (const [name, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
