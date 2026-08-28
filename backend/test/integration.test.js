import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import * as OTPAuth from 'otpauth';
import { Client } from 'pg';
import prisma from '../src/db.js';
import { app, httpServer } from '../src/server.js';
import { validateEnvironment } from '../src/config.js';
import { emitQueueUpdate } from '../src/utils/socketEvents.js';
import { getClinicDateString } from '../src/utils/clinicTime.js';
import { encrypt, decrypt } from '../src/utils/encryption.js';
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
import { normalizeFileNumber, normalizeNationalId, normalizePatientPhone } from '../src/utils/patientIdentity.js';
import { errorHandler } from '../src/utils/apiError.js';
import { ensurePharmacyInvoiceForPrescription } from '../src/services/pharmacyInvoice.js';
import { SOCKET_REVOCATION_CHANNEL } from '../src/services/socketRevocation.js';
import { STAFF_ROLES } from '../src/routes/auth.js';
import {
  corsMiddleware,
  createAdminResetLimiter,
  createLoginLimiter,
  securityHeadersMiddleware
} from '../src/utils/edgeSecurity.js';
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
let pharmacyApiPatientToken;

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

function assertSafeAuthorizationDenial(response, expectedStatus) {
  assert.equal(response.status, expectedStatus);
  assert.doesNotMatch(
    JSON.stringify(response.body),
    /Prisma|PrismaClient|P20\d{2}|SQL|constraint|stack|database|passwordHash|mfaSecret|jwt|Bearer\s+[A-Za-z0-9._-]+/i
  );
}

function assertSafeValidationError(response, attackerMarkers = []) {
  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  const serialized = JSON.stringify(response.body);
  assert.doesNotMatch(
    serialized,
    /Prisma|PrismaClient|P20\d{2}|SQL|constraint|stack|database|node_modules|\/home\/|file:\/\/|Bearer\s+[A-Za-z0-9._-]+|eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/i
  );
  for (const marker of attackerMarkers) assert.equal(serialized.includes(marker), false);
}

function assertNoSensitiveErrorLeak(body, markers = []) {
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(
    serialized,
    /Prisma|PrismaClient|P20\d{2}|SQL|constraint|stack|database_url|postgres(?:ql)?:\/\/|node_modules|\/home\/|file:\/\/|Bearer\s+[A-Za-z0-9._-]+|eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/i
  );
  for (const marker of markers) assert.equal(serialized.includes(marker), false);
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
  return { appointment, record, order };
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

async function createAuthorityTestAppointment() {
  fixtureCounter += 1;
  return prisma.appointment.create({
    data: {
      patientId: patient1.id,
      doctorId: doctor1.id,
      appointmentDate: `2048-07-${String((fixtureCounter % 27) + 1).padStart(2, '0')}`,
      appointmentTime: `${String(8 + (fixtureCounter % 10)).padStart(2, '0')}:40`,
      status: 'IN_CONSULTATION'
    }
  });
}

function authorityPrescriptionPayload(appointment, prescribedDrugs, extra = {}) {
  return {
    patientId: patient1.id,
    appointmentId: appointment.id,
    diagnosis: 'Authority validation integration diagnosis',
    prescribedDrugs,
    ...extra
  };
}

function prescribedDrugPayload(drugId) {
  return {
    drugId,
    dosage: 'One tablet',
    duration: 'Three days',
    qtyPrescribed: 3,
    unitPriceSdg: 1,
    status: 'ACTIVE'
  };
}

async function createAppointmentConcurrencyPatient() {
  fixtureCounter += 1;
  const username = `appointment-concurrency-${fixtureCounter}@example.test`;
  const user = await prisma.user.create({ data: {
    username,
    email: username,
    passwordHash: await bcrypt.hash('PatientConcurrency@123', 10),
    role: 'PATIENT',
    status: 'ACTIVE',
    emailVerifiedAt: new Date()
  } });
  const patient = await prisma.patient.create({ data: {
    userId: user.id,
    fullNameAr: `مريض تزامن ${fixtureCounter}`,
    fullNameEn: `Concurrency Patient ${fixtureCounter}`,
    gender: 'MALE',
    dateOfBirth: '1990-01-01',
    phone: `0987${String(fixtureCounter).padStart(6, '0')}`,
    addressStateId: 1,
    emergencyContact: 'Self'
  } });
  return {
    user,
    patient,
    token: signTestToken({ id: user.id, role: 'PATIENT', av: user.authVersion, typ: 'access' })
  };
}

async function createConcurrencyAppointment(patientId, status = 'PENDING') {
  fixtureCounter += 1;
  return prisma.appointment.create({ data: {
    patientId,
    doctorId: doctor1.id,
    appointmentDate: `2050-08-${String((fixtureCounter % 27) + 1).padStart(2, '0')}`,
    appointmentTime: `${String(8 + (fixtureCounter % 10)).padStart(2, '0')}:20`,
    status
  } });
}

async function findAvailableAppointmentSlot(doctorId) {
  for (let day = 1; day <= 28; day += 1) {
    const date = `2051-09-${String(day).padStart(2, '0')}`;
    const response = await api.get('/api/appointments/slots').query({ doctorId, date });
    if (response.status === 200 && response.body.length > 0) {
      return { doctorId, appointmentDate: date, appointmentTime: response.body[0] };
    }
  }
  throw new Error('No configured Doctor slot was available for appointment concurrency tests.');
}

async function findTodayWalkInSlot(doctorId) {
  const response = await api.get('/api/appointments/slots').query({ doctorId, date: getClinicDateString() });
  assert.equal(response.status, 200);
  assert.ok(response.body.length > 0, 'A configured clinic slot is required for walk-in tests.');
  return response.body[0];
}

async function createStandaloneTestPatient(label = 'C1') {
  fixtureCounter += 1;
  return prisma.patient.create({ data: {
    fullNameAr: `مريض ${label} ${fixtureCounter}`,
    fullNameEn: `C1 Patient ${label} ${fixtureCounter}`,
    gender: 'MALE', dateOfBirth: '1990-01-01', phone: `0944${String(fixtureCounter).padStart(6, '0')}`,
    addressStateId: 1, emergencyContact: 'Self'
  } });
}

async function findTransferAppointmentSlot(sourceDoctorId, targetDoctorId) {
  for (let day = 1; day <= 28; day += 1) {
    const date = `2052-10-${String(day).padStart(2, '0')}`;
    const response = await api.get('/api/appointments/slots').query({ doctorId: targetDoctorId, date });
    if (response.status !== 200) continue;
    for (const time of response.body) {
      const sourceConflict = await prisma.appointment.findFirst({ where: {
        doctorId: sourceDoctorId,
        appointmentDate: date,
        appointmentTime: time,
        status: { notIn: ['CANCELLED', 'NO_SHOW'] }
      } });
      if (!sourceConflict) return { appointmentDate: date, appointmentTime: time };
    }
  }
  throw new Error('No mutually available transfer slot was available for appointment concurrency tests.');
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

test('simultaneous doctor consultation starts claim CHECKED_IN exactly once', async () => {
  fixtureCounter += 1;
  const appointment = await prisma.appointment.create({ data: {
    patientId: patient1.id, doctorId: doctor1.id,
    appointmentDate: `2060-01-${String((fixtureCounter % 27) + 1).padStart(2, '0')}`,
    appointmentTime: `${String(8 + (fixtureCounter % 10)).padStart(2, '0')}:10`, status: 'CHECKED_IN'
  } });
  const invoice = await api.post('/api/billing/invoice').set(auth('reception')).send({
    patientId: patient1.id, appointmentId: appointment.id, invoiceType: 'CONSULTATION',
    items: [{ descriptionAr: 'محاولة سعر', descriptionEn: 'Forged price', qty: 1, unitPriceSdg: 1 }]
  });
  assert.equal(invoice.status, 201);
  assert.equal(invoice.body.invoice.appointmentId, appointment.id);
  const payment = await api.post(`/api/billing/invoice/${invoice.body.invoice.id}/payments`)
    .set(paymentAuth('reception'))
    .send({ payments: [{ amountSdg: Number(invoice.body.invoice.totalAmountSdg), paymentMethod: 'CASH' }] });
  assert.equal(payment.status, 200);
  const paidInvoice = await prisma.invoice.findUnique({ where: { id: invoice.body.invoice.id } });
  assert.equal(paidInvoice.paymentStatus, 'PAID');
  const beforeAudits = await prisma.tenantAuditLog.count({ where: { action: 'APPOINTMENT_STATUS_UPDATED', details: { contains: appointment.id } } });
  const [startA, startB] = await Promise.all([
    api.put(`/api/appointments/${appointment.id}/status`).set(auth('doctor')).send({ status: 'IN_CONSULTATION' }),
    api.put(`/api/appointments/${appointment.id}/status`).set(auth('doctor')).send({ status: 'IN_CONSULTATION' })
  ]);
  assert.deepEqual([startA.status, startB.status].sort((a, b) => a - b), [200, 409]);
  const loser = startA.status === 409 ? startA : startB;
  assert.ok([
    'APPOINTMENT_STATE_CONFLICT',
    'ILLEGAL_APPOINTMENT_STATUS_TRANSITION'
  ].includes(loser.body.error.code));
  assert.doesNotMatch(JSON.stringify(loser.body), /Prisma|P20\d{2}|SQL|constraint|stack|database/i);
  assert.equal((await prisma.appointment.findUnique({ where: { id: appointment.id } })).status, 'IN_CONSULTATION');
  assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'APPOINTMENT_STATUS_UPDATED', details: { contains: appointment.id } } }), beforeAudits + 1);
});

test('doctor start races receptionist cancellation without an impossible rollback', async () => {
  fixtureCounter += 1;
  const appointment = await prisma.appointment.create({ data: {
    patientId: patient1.id, doctorId: doctor1.id,
    appointmentDate: `2060-02-${String((fixtureCounter % 27) + 1).padStart(2, '0')}`,
    appointmentTime: `${String(8 + (fixtureCounter % 10)).padStart(2, '0')}:15`, status: 'CHECKED_IN'
  } });
  const invoice = await api.post('/api/billing/invoice').set(auth('reception')).send({
    patientId: patient1.id, appointmentId: appointment.id, invoiceType: 'CONSULTATION',
    items: [{ descriptionAr: 'كشف', descriptionEn: 'Consultation', qty: 1, unitPriceSdg: 1 }]
  });
  assert.equal(invoice.status, 201);
  assert.equal(invoice.body.invoice.appointmentId, appointment.id);
  const payment = await api.post(`/api/billing/invoice/${invoice.body.invoice.id}/payments`)
    .set(paymentAuth('reception'))
    .send({ payments: [{ amountSdg: Number(invoice.body.invoice.totalAmountSdg), paymentMethod: 'CASH' }] });
  assert.equal(payment.status, 200);
  const paidInvoice = await prisma.invoice.findUnique({ where: { id: invoice.body.invoice.id } });
  assert.equal(paidInvoice.paymentStatus, 'PAID');
  const [start, cancel] = await Promise.all([
    api.put(`/api/appointments/${appointment.id}/status`).set(auth('doctor')).send({ status: 'IN_CONSULTATION' }),
    api.put(`/api/appointments/${appointment.id}/status`).set(auth('reception')).send({ status: 'CANCELLED' })
  ]);
  assert.deepEqual([start.status, cancel.status].sort((a, b) => a - b), [200, 409]);
  const persisted = await prisma.appointment.findUnique({ where: { id: appointment.id } });
  assert.ok(['IN_CONSULTATION', 'CANCELLED'].includes(persisted.status));
  const loser = start.status === 409 ? start : cancel;
  assert.equal(loser.body.error.code, 'APPOINTMENT_STATE_CONFLICT');
  assert.doesNotMatch(JSON.stringify(loser.body), /Prisma|P20\d{2}|SQL|constraint|stack|database/i);
});

test('concurrent consultation submissions create one medical record and lab order', async () => {
  const appointment = await createAuthorityTestAppointment();
  const payload = authorityPrescriptionPayload(appointment, [], { orderedServices: [service.id], diagnosis: 'Concurrent consultation' });
  const [first, second] = await Promise.all([
    api.post('/api/records').set(auth('doctor')).send(payload),
    api.post('/api/records').set(auth('doctor')).send(payload)
  ]);
  assert.equal([first.status, second.status].filter((status) => status === 201).length, 1);
  assert.equal([first.status, second.status].filter((status) => status !== 201).length, 1);
  const loser = first.status === 201 ? second : first;
  assert.doesNotMatch(JSON.stringify(loser.body), /Prisma|P20\d{2}|SQL|constraint|stack|database/i);
  assert.equal(await prisma.medicalRecord.count({ where: { appointmentId: appointment.id } }), 1);
  const record = await prisma.medicalRecord.findUnique({ where: { appointmentId: appointment.id }, include: { labOrders: { include: { items: true } } } });
  assert.equal(record.labOrders.length, 1);
  assert.equal(record.labOrders[0].items.length, 1);
  assert.equal((await prisma.appointment.findUnique({ where: { id: appointment.id } })).status, 'WAITING_LAB');
});

test('simultaneous consultation finalization commits one terminal transition', async () => {
  const appointment = await createAuthorityTestAppointment();
  const record = await prisma.medicalRecord.create({ data: {
    patientId: patient1.id, doctorId: doctor1.id, appointmentId: appointment.id,
    symptomsEncrypted: '', diagnosisEncrypted: encrypt('initial'), treatmentEncrypted: '',
    vitalSignsJson: '{}', clinicalNotesEncrypted: ''
  } });
  await prisma.labOrder.create({ data: {
    medicalRecordId: record.id, patientId: patient1.id, doctorId: doctor1.id,
    status: 'COMPLETED', items: { create: { serviceId: service.id, resultValue: 'ready', resultVersion: 1 } }
  } });
  const [first, second] = await Promise.all([
    api.put(`/api/records/${record.id}/finalize`).set(auth('doctor')).send({ diagnosis: 'final A', treatment: 'plan A', vitalSigns: {} }),
    api.put(`/api/records/${record.id}/finalize`).set(auth('doctor')).send({ diagnosis: 'final B', treatment: 'plan B', vitalSigns: {} })
  ]);
  assert.equal([first.status, second.status].filter((status) => status === 200).length, 1);
  assert.equal([first.status, second.status].filter((status) => status !== 200).length, 1);
  const loser = first.status === 200 ? second : first;
  assert.doesNotMatch(JSON.stringify(loser.body), /Prisma|P20\d{2}|SQL|constraint|stack|database/i);
  assert.equal((await prisma.appointment.findUnique({ where: { id: appointment.id } })).status, 'COMPLETED');
  const persisted = await prisma.medicalRecord.findUnique({ where: { id: record.id } });
  assert.ok(['final A', 'final B'].includes(decrypt(persisted.diagnosisEncrypted)));
  assert.equal(await prisma.prescription.count({ where: { medicalRecordId: record.id } }), 0);
});

test('lab completion racing doctor finalization preserves a valid workflow state', async () => {
  const fixture = await createResultConcurrencyFixture(1);
  const item = fixture.order.items[0];
  const resultEndpoint = `/api/records/lab-orders/items/${item.id}/results`;
  const finalizeEndpoint = `/api/records/${fixture.record.id}/finalize`;

  const [labResult, finalize] = await Promise.all([
    api.put(resultEndpoint).set(auth('lab')).send({ expectedVersion: 0, resultValue: 'final laboratory result' }),
    api.put(finalizeEndpoint).set(auth('doctor')).send({ diagnosis: 'Final diagnosis after laboratory review', treatment: 'Final treatment', vitalSigns: {} })
  ]);

  assert.equal(labResult.status, 200);
  assert.ok([200, 409].includes(finalize.status));
  assert.doesNotMatch(JSON.stringify(finalize.body), /Prisma|PrismaClient|P20\d{2}|SQL|constraint|stack|database|transaction/i);

  const persisted = await prisma.labOrder.findUnique({
    where: { id: fixture.order.id },
    include: { items: true }
  });
  const appointment = await prisma.appointment.findUnique({ where: { id: fixture.appointment.id } });
  const recordCount = await prisma.medicalRecord.count({ where: { appointmentId: fixture.appointment.id } });
  assert.equal(recordCount, 1);
  assert.equal(persisted.status, 'COMPLETED');
  assert.equal(persisted.items.length, 1);
  assert.equal(persisted.items[0].resultValue, 'final laboratory result');
  assert.equal(persisted.items[0].resultVersion, 1);
  assert.ok(['IN_CONSULTATION', 'COMPLETED'].includes(appointment.status));
  if (finalize.status === 200) {
    assert.equal(appointment.status, 'COMPLETED');
    assert.equal((await prisma.prescription.count({ where: { medicalRecordId: fixture.record.id } })), 0);
  } else {
    assert.equal(appointment.status, 'IN_CONSULTATION');
  }
  const resultAudits = await prisma.tenantAuditLog.findMany({
    where: { action: 'LAB_RESULTS_LOGGED', details: { contains: item.id } }
  });
  assert.equal(resultAudits.length, 1);
});

test('cancelled and no-show terminal appointments reject stale active transitions safely', async () => {
  for (const status of ['CANCELLED', 'NO_SHOW']) {
    const appointment = await createConcurrencyAppointment(patient1.id, status);
    const response = await api.put(`/api/appointments/${appointment.id}/status`).set(auth('reception')).send({ status: 'CHECKED_IN' });
    assert.equal(response.status, 409);
    assert.doesNotMatch(JSON.stringify(response.body), /Prisma|P20\d{2}|SQL|constraint|stack|database/i);
    assert.equal((await prisma.appointment.findUnique({ where: { id: appointment.id } })).status, status);
    assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'APPOINTMENT_STATUS_UPDATED', details: { contains: appointment.id } } }), 0);
  }
});

before(async () => {
  tokens.admin = await login('admin@cms.com', 'Admin@123');
  tokens.reception = await login('recep@cms.com', 'Receptionist@123');
  tokens.doctor = await login('doctor@cms.com', 'Doctor@123');
  tokens.lab = await login('lab@cms.com', 'Labtech@123');
  tokens.pharmacy = await login('pharma@cms.com', 'Pharmacist@123');
  doctor1 = await prisma.doctor.findFirst({ where: { user: { username: 'doctor@cms.com' } } });
  doctor2 = await prisma.doctor.findFirst({ where: { user: { username: 'doctor_cardio@cms.com' } } });
  const clinicWeekday = new Date(`${getClinicDateString()}T12:00:00.000Z`).toLocaleDateString('en-US', {
    weekday: 'long', timeZone: 'UTC'
  });
  const doctorSchedule = JSON.parse(doctor1.weeklySchedule);
  if (!doctorSchedule.some(({ day }) => day === clinicWeekday)) {
    doctorSchedule.push({ day: clinicWeekday, startTime: '09:00', endTime: '15:00', slotDurationInMinutes: 15 });
    doctor1 = await prisma.doctor.update({
      where: { id: doctor1.id },
      data: { weeklySchedule: JSON.stringify(doctorSchedule) }
    });
  }
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

test('centralized unknown errors return only the canonical safe 500 response', () => {
  const markers = [
    `CENTRAL-SECRET-${Date.now()}`,
    'postgresql://db-user:db-password@internal.example/clinic',
    '/home/clinic/private/server.js',
    'Bearer eyJhbGciOiJIUzI1NiJ9.sensitive.signature',
    'P2002 fake_constraint SQL SELECT passwordHash mfaSecret recovery-code'
  ];
  const internal = new Error(markers.join(' | '));
  internal.stack = `Error: ${markers[0]}\n at ${markers[2]}:99:1`;
  const req = { id: 'central-error-test', method: 'GET', path: '/api/internal-test' };
  const response = {
    headersSent: false,
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  errorHandler(internal, req, response, () => assert.fail('Unknown errors must be handled centrally.'));
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, {
    error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected server error occurred.' }
  });
  assertNoSensitiveErrorLeak(response.body, markers);
});

test('legacy patient search returns a fixed 500 without raw dependency errors', async () => {
  const markers = [
    `LEGACY-PRISMA-${Date.now()}`,
    'P2025 LEGACY_FAKE_CONSTRAINT',
    'SQL SELECT * FROM Patient',
    '/home/clinic/private/patient-query.js'
  ];
  const originalFindMany = prisma.patient.findMany;
  prisma.patient.findMany = async () => {
    const error = new Error(markers.join(' | '));
    error.stack = `Error: ${markers[0]} at ${markers[3]}`;
    throw error;
  };
  try {
    const response = await api.get('/api/patients/search?q=legacy-error-marker').set(auth('reception'));
    assert.equal(response.status, 500);
    assert.deepEqual(response.body, { error: 'Failed to search patients.' });
    assertNoSensitiveErrorLeak(response.body, markers);
  } finally {
    prisma.patient.findMany = originalFindMany;
  }
});

test('authorized attachment filesystem failures are centrally sanitized', async () => {
  const filename = `${crypto.randomUUID()}.pdf`;
  const publicPath = `/api/upload/${filename}`;
  const appointment = await prisma.appointment.create({ data: {
    patientId: patient1.id, doctorId: doctor1.id,
    appointmentDate: '2067-08-08', appointmentTime: '08:00', status: 'COMPLETED'
  } });
  await prisma.medicalRecord.create({ data: {
    patientId: patient1.id, doctorId: doctor1.id, appointmentId: appointment.id,
    symptomsEncrypted: '', diagnosisEncrypted: '', treatmentEncrypted: '', clinicalNotesEncrypted: '',
    vitalSignsJson: '{}', attachmentPath: publicPath
  } });
  const markers = [
    `FILESYSTEM-SECRET-${Date.now()}`,
    `/home/clinic/private/uploads/${filename}`,
    'EACCES permission denied open'
  ];
  const originalExistsSync = fs.existsSync;
  fs.existsSync = (candidate) => {
    if (String(candidate).endsWith(filename)) {
      const error = new Error(markers.join(' | '));
      error.code = 'EACCES';
      throw error;
    }
    return originalExistsSync(candidate);
  };
  try {
    const response = await api.get(publicPath).set(auth('doctor'));
    assert.equal(response.status, 500);
    assert.equal(response.body.error.code, 'INTERNAL_SERVER_ERROR');
    assert.equal(response.body.error.message, 'An unexpected server error occurred.');
    assertNoSensitiveErrorLeak(response.body, markers);
  } finally {
    fs.existsSync = originalExistsSync;
  }
});

test('clinical summary rejects attacker-controlled recipient fields', async () => {
  const appointment = await prisma.appointment.create({ data: {
    patientId: patient1.id, doctorId: doctor1.id, appointmentDate: '2062-01-01', appointmentTime: '09:00', status: 'COMPLETED'
  } });
  const record = await prisma.medicalRecord.create({ data: {
    patientId: patient1.id, doctorId: doctor1.id, appointmentId: appointment.id,
    symptomsEncrypted: encrypt('symptoms'), diagnosisEncrypted: encrypt('diagnosis'), treatmentEncrypted: encrypt('treatment'),
    vitalSignsJson: '{}', clinicalNotesEncrypted: ''
  } });
  const response = await api.post(`/api/records/${record.id}/send-summary`).set(auth('doctor')).send({
    email: 'attacker@example.com',
    recipient: 'attacker@example.com',
    to: 'attacker@example.com'
  });
  assert.equal(response.status, 422);
  assert.doesNotMatch(JSON.stringify(response.body), /attacker@example\.com|diagnosis|treatment|Prisma|SQL|stack/i);
});

test('clinical summary requires a verified patient email and never falls back to a supplied address', async () => {
  const appointment = await prisma.appointment.create({ data: {
    patientId: patient1.id, doctorId: doctor1.id, appointmentDate: '2062-01-02', appointmentTime: '09:00', status: 'COMPLETED'
  } });
  const record = await prisma.medicalRecord.create({ data: {
    patientId: patient1.id, doctorId: doctor1.id, appointmentId: appointment.id,
    symptomsEncrypted: encrypt('symptoms'), diagnosisEncrypted: encrypt('diagnosis'), treatmentEncrypted: encrypt('treatment'),
    vitalSignsJson: '{}', clinicalNotesEncrypted: ''
  } });
  const response = await api.post(`/api/records/${record.id}/send-summary`).set(auth('doctor')).send({});
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'PATIENT_VERIFIED_EMAIL_REQUIRED');
  assert.doesNotMatch(JSON.stringify(response.body), /diagnosis|treatment|Prisma|SQL|stack|database/i);
});

test('clinical summary SMTP provider failures expose no transport or clinical content', async () => {
  const portal = await createAppointmentConcurrencyPatient();
  const appointment = await prisma.appointment.create({ data: {
    patientId: portal.patient.id, doctorId: doctor1.id,
    appointmentDate: '2067-09-09', appointmentTime: '09:00', status: 'COMPLETED'
  } });
  const clinicalMarker = `CLINICAL-SUMMARY-SECRET-${Date.now()}-${++fixtureCounter}`;
  const record = await prisma.medicalRecord.create({ data: {
    patientId: portal.patient.id, doctorId: doctor1.id, appointmentId: appointment.id,
    symptomsEncrypted: encrypt(clinicalMarker),
    diagnosisEncrypted: encrypt(clinicalMarker),
    treatmentEncrypted: encrypt(clinicalMarker),
    clinicalNotesEncrypted: encrypt(clinicalMarker),
    vitalSignsJson: JSON.stringify({ blood_pressure: clinicalMarker })
  } });
  const markers = [
    `SMTP-HOST-${Date.now()}`,
    `SMTP-USER-${Date.now()}`,
    `SMTP-PROVIDER-DIAGNOSTIC-${Date.now()}`,
    `SMTP-TRANSPORT-STACK-${Date.now()}`,
    clinicalMarker
  ];
  const originalCreateTransport = nodemailer.createTransport;
  const previousEnvironment = {
    NOTIFICATIONS_DISABLED: process.env.NOTIFICATIONS_DISABLED,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
    SMTP_FROM_EMAIL: process.env.SMTP_FROM_EMAIL
  };
  nodemailer.createTransport = () => ({
    async sendMail() {
      const error = new Error(markers.slice(0, 3).join(' | '));
      error.stack = `${markers[3]} at /home/smtp/provider.js:1:1`;
      throw error;
    }
  });
  Object.assign(process.env, {
    NOTIFICATIONS_DISABLED: 'false',
    SMTP_HOST: markers[0],
    SMTP_PORT: '2525',
    SMTP_USER: markers[1],
    SMTP_PASS: `SMTP-PASSWORD-${Date.now()}`,
    SMTP_FROM_EMAIL: 'clinic@example.test'
  });
  try {
    const response = await api.post(`/api/records/${record.id}/send-summary`).set(auth('doctor')).send({});
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, 'EMAIL_DELIVERY_FAILED');
    assert.equal(response.body.error.message, 'Post-visit summary could not be delivered.');
    assertNoSensitiveErrorLeak(response.body, markers);
  } finally {
    nodemailer.createTransport = originalCreateTransport;
    for (const [name, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('doctor clinical writes accept active formulary medicines and preserve server price authority', async () => {
  const appointment = await createAuthorityTestAppointment();
  const activeDrug = await prisma.drugFormulary.create({
    data: {
      brandName: `Authority Active ${fixtureCounter}`,
      labelAr: 'دواء نشط',
      labelEn: `Authority Active ${fixtureCounter}`,
      genericName: `authority-active-${fixtureCounter}`,
      strength: '20mg',
      dosageForm: 'Tablet',
      identityKey: buildMedicineIdentityKey({
        brandName: `Authority Active ${fixtureCounter}`,
        genericName: `authority-active-${fixtureCounter}`,
        strength: '20mg',
        dosageForm: 'Tablet'
      }),
      unitPriceSdg: 2750,
      status: 'ACTIVE'
    }
  });

  const response = await api.post('/api/records').set(auth('doctor')).send(
    authorityPrescriptionPayload(appointment, [prescribedDrugPayload(activeDrug.id)], {
      medicinePrice: 1,
      invoiceTotal: 1
    })
  );
  assert.equal(response.status, 201);
  const invoice = await prisma.invoice.findFirst({
    where: { prescriptionId: response.body.data.prescription.id, invoiceType: 'PHARMACY' },
    include: { items: true }
  });
  assert.ok(invoice);
  assert.equal(Number(invoice.items[0].unitPriceSdg), 2750);
  assert.equal(Number(invoice.totalAmountSdg), 8250);
});

test('inactive, missing, and mixed formulary selections reject the complete clinical mutation', async () => {
  const activeDrug = await prisma.drugFormulary.create({
    data: {
      brandName: `Authority Mixed Active ${++fixtureCounter}`,
      labelAr: 'دواء نشط مختلط', labelEn: `Authority Mixed Active ${fixtureCounter}`,
      genericName: `authority-mixed-active-${fixtureCounter}`, strength: '5mg', dosageForm: 'Tablet',
      identityKey: buildMedicineIdentityKey({ brandName: `Authority Mixed Active ${fixtureCounter}`, genericName: `authority-mixed-active-${fixtureCounter}`, strength: '5mg', dosageForm: 'Tablet' }),
      unitPriceSdg: 1000, status: 'ACTIVE'
    }
  });
  const inactiveDrug = await prisma.drugFormulary.create({
    data: {
      brandName: `Authority Inactive ${fixtureCounter}`,
      labelAr: 'دواء غير نشط', labelEn: `Authority Inactive ${fixtureCounter}`,
      genericName: `authority-inactive-${fixtureCounter}`, strength: '5mg', dosageForm: 'Tablet',
      identityKey: buildMedicineIdentityKey({ brandName: `Authority Inactive ${fixtureCounter}`, genericName: `authority-inactive-${fixtureCounter}`, strength: '5mg', dosageForm: 'Tablet' }),
      unitPriceSdg: 1000, status: 'INACTIVE'
    }
  });

  const cases = [
    { drugs: [prescribedDrugPayload(inactiveDrug.id)], status: 409, code: 'FORMULARY_MEDICINE_INACTIVE' },
    { drugs: [prescribedDrugPayload(crypto.randomUUID())], status: 404, code: 'FORMULARY_MEDICINE_NOT_FOUND' },
    { drugs: [prescribedDrugPayload(activeDrug.id), prescribedDrugPayload(inactiveDrug.id)], status: 409, code: 'FORMULARY_MEDICINE_INACTIVE' }
  ];

  for (const entry of cases) {
    const appointment = await createAuthorityTestAppointment();
    const response = await api.post('/api/records').set(auth('doctor')).send(
      authorityPrescriptionPayload(appointment, entry.drugs)
    );
    assert.equal(response.status, entry.status);
    assert.equal(response.body.error.code, entry.code);
    assert.equal(await prisma.medicalRecord.count({ where: { appointmentId: appointment.id } }), 0);
    assert.equal((await prisma.appointment.findUnique({ where: { id: appointment.id } })).status, 'IN_CONSULTATION');
  }
});

test('final consultation prescription rejects an inactive formulary medicine atomically', async () => {
  const appointment = await createAuthorityTestAppointment();
  const record = await prisma.medicalRecord.create({ data: {
    patientId: patient1.id, doctorId: doctor1.id, appointmentId: appointment.id,
    symptomsEncrypted: '', diagnosisEncrypted: '', treatmentEncrypted: '', vitalSignsJson: '{}', clinicalNotesEncrypted: ''
  } });
  const inactiveDrug = await prisma.drugFormulary.create({ data: {
    brandName: `Finalize Inactive ${++fixtureCounter}`, labelAr: 'دواء نهائي غير نشط', labelEn: `Finalize Inactive ${fixtureCounter}`,
    genericName: `finalize-inactive-${fixtureCounter}`, strength: '1mg', dosageForm: 'Tablet',
    identityKey: buildMedicineIdentityKey({ brandName: `Finalize Inactive ${fixtureCounter}`, genericName: `finalize-inactive-${fixtureCounter}`, strength: '1mg', dosageForm: 'Tablet' }),
    unitPriceSdg: 500, status: 'INACTIVE'
  } });
  const beforeDiagnosis = record.diagnosisEncrypted;
  const response = await api.put(`/api/records/${record.id}/finalize`).set(auth('doctor')).send({
    diagnosis: 'Must roll back', prescribedDrugs: [prescribedDrugPayload(inactiveDrug.id)]
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'FORMULARY_MEDICINE_INACTIVE');
  assert.equal(await prisma.prescription.count({ where: { medicalRecordId: record.id } }), 0);
  assert.equal((await prisma.medicalRecord.findUnique({ where: { id: record.id } })).diagnosisEncrypted, beforeDiagnosis);
  assert.equal((await prisma.appointment.findUnique({ where: { id: appointment.id } })).status, 'IN_CONSULTATION');
});

test('doctor and Admin medicine lifecycle writes serialize under concurrent submission', async () => {
  const appointment = await createAuthorityTestAppointment();
  const medicine = await prisma.drugFormulary.create({ data: {
    brandName: `Authority Race ${++fixtureCounter}`, labelAr: 'دواء سباق', labelEn: `Authority Race ${fixtureCounter}`,
    genericName: `authority-race-${fixtureCounter}`, strength: '25mg', dosageForm: 'Tablet',
    identityKey: buildMedicineIdentityKey({ brandName: `Authority Race ${fixtureCounter}`, genericName: `authority-race-${fixtureCounter}`, strength: '25mg', dosageForm: 'Tablet' }),
    unitPriceSdg: 2200, status: 'ACTIVE'
  } });
  const [doctorResponse, adminResponse] = await Promise.all([
    api.post('/api/records').set(auth('doctor')).send(authorityPrescriptionPayload(appointment, [prescribedDrugPayload(medicine.id)])),
    api.patch(`/api/admin/pricing/medicines/${medicine.id}`).set(auth('admin')).send({ priceSdg: 2200, status: 'INACTIVE' })
  ]);
  assert.equal(adminResponse.status, 200);
  assert.ok([201, 409].includes(doctorResponse.status));
  const recordCount = await prisma.medicalRecord.count({ where: { appointmentId: appointment.id } });
  if (doctorResponse.status === 201) {
    assert.equal(recordCount, 1);
  } else {
    assert.equal(doctorResponse.body.error.code, 'FORMULARY_MEDICINE_INACTIVE');
    assert.equal(recordCount, 0);
  }
  assert.equal((await prisma.drugFormulary.findUnique({ where: { id: medicine.id } })).status, 'INACTIVE');
});

test('laboratory service selection requires an active authoritative laboratory service', async () => {
  const activeLab = await prisma.clinicalService.create({ data: {
    labelAr: `مختبر نشط ${++fixtureCounter}`, labelEn: `Authority Active Lab ${fixtureCounter}`,
    category: 'LABORATORY', status: 'ACTIVE', baseFeeSdg: 3500, baseFeeUsd: 2
  } });
  const inactiveLab = await prisma.clinicalService.create({ data: {
    labelAr: `مختبر غير نشط ${fixtureCounter}`, labelEn: `Authority Inactive Lab ${fixtureCounter}`,
    category: 'LABORATORY', status: 'INACTIVE', baseFeeSdg: 3500, baseFeeUsd: 2
  } });
  const consultation = await prisma.clinicalService.create({ data: {
    labelAr: `استشارة ${fixtureCounter}`, labelEn: `Authority Consultation ${fixtureCounter}`,
    category: 'CONSULTATION', status: 'ACTIVE', baseFeeSdg: 9000, baseFeeUsd: 6
  } });
  const cases = [
    { ids: [inactiveLab.id], status: 409, code: 'CLINICAL_SERVICE_INACTIVE' },
    { ids: [consultation.id], status: 422, code: 'CLINICAL_SERVICE_NOT_LABORATORY' },
    { ids: [crypto.randomUUID()], status: 404, code: 'CLINICAL_SERVICE_NOT_FOUND' },
    { ids: [activeLab.id, inactiveLab.id], status: 409, code: 'CLINICAL_SERVICE_INACTIVE' }
  ];
  for (const entry of cases) {
    const appointment = await createAuthorityTestAppointment();
    const response = await api.post('/api/records').set(auth('doctor')).send({
      patientId: patient1.id, appointmentId: appointment.id, orderedServices: entry.ids,
      servicePriceSdg: 1, serviceCategory: 'LABORATORY'
    });
    assert.equal(response.status, entry.status);
    assert.equal(response.body.error.code, entry.code);
    assert.equal(await prisma.medicalRecord.count({ where: { appointmentId: appointment.id } }), 0);
    assert.equal(await prisma.labOrder.count({ where: { patientId: patient1.id, medicalRecord: { appointmentId: appointment.id } } }), 0);
  }

  const appointment = await createAuthorityTestAppointment();
  const accepted = await api.post('/api/records').set(auth('doctor')).send({
    patientId: patient1.id, appointmentId: appointment.id, orderedServices: [activeLab.id],
    servicePriceSdg: 1, serviceCategory: 'CONSULTATION'
  });
  assert.equal(accepted.status, 201);
  const item = await prisma.labOrderItem.findFirst({ where: { labOrder: { medicalRecord: { appointmentId: appointment.id } } } });
  assert.equal(item.serviceId, activeLab.id);
  assert.equal(Number((await prisma.clinicalService.findUnique({ where: { id: activeLab.id } })).baseFeeSdg), 3500);
});

test('free-text custom medicine remains valid under authoritative selection checks', async () => {
  const appointment = await createAuthorityTestAppointment();
  const response = await api.post('/api/records').set(auth('doctor')).send(
    authorityPrescriptionPayload(appointment, [{
      customDrugName: `Custom authority medicine ${++fixtureCounter}`,
      dosage: 'As directed', duration: 'Two days', qtyPrescribed: 2
    }])
  );
  assert.equal(response.status, 201);
  const item = await prisma.prescribedDrug.findFirst({ where: { prescriptionId: response.body.data.prescription.id } });
  assert.equal(item.drugId, null);
  assert.equal(item.pharmacyReviewStatus, 'PENDING_REVIEW');
});

test('concurrent PENDING confirmation and cancellation commit exactly one audited and notified transition', async () => {
  const appointment = await createConcurrencyAppointment(patient1.id, 'PENDING');
  const beforeAudit = await prisma.tenantAuditLog.count({
    where: { action: 'APPOINTMENT_STATUS_UPDATED', details: { contains: appointment.id } }
  });
  const responses = await Promise.all([
    api.put(`/api/appointments/${appointment.id}/status`).set(auth('reception')).send({ status: 'CONFIRMED' }),
    api.put(`/api/appointments/${appointment.id}/status`).set(auth('reception')).send({ status: 'CANCELLED' })
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const winner = responses.find((response) => response.status === 200);
  const loser = responses.find((response) => response.status === 409);
  assert.equal(loser.body.error.code, 'APPOINTMENT_STATE_CONFLICT');
  assert.ok(['CONFIRMED', 'CANCELLED'].includes(winner.body.status));
  assert.equal((await prisma.appointment.findUnique({ where: { id: appointment.id } })).status, winner.body.status);
  assert.equal(typeof winner.body.whatsAppLinkAr, 'string');
  assert.equal(Object.hasOwn(loser.body, 'whatsAppLinkAr'), false);
  assert.equal(await prisma.tenantAuditLog.count({
    where: { action: 'APPOINTMENT_STATUS_UPDATED', details: { contains: appointment.id } }
  }), beforeAudit + 1);
});

test('concurrent patient cancellation and receptionist check-in preserve exactly one CONFIRMED transition', async () => {
  const fixture = await createAppointmentConcurrencyPatient();
  const appointment = await createConcurrencyAppointment(fixture.patient.id, 'CONFIRMED');
  const responses = await Promise.all([
    api.post(`/api/patient/appointments/${appointment.id}/cancel`).set({ Authorization: `Bearer ${fixture.token}` }),
    api.put(`/api/appointments/${appointment.id}/status`).set(auth('reception')).send({ status: 'CHECKED_IN' })
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const loser = responses.find((response) => response.status === 409);
  assert.equal(loser.body.error.code, 'APPOINTMENT_STATE_CONFLICT');
  const persisted = await prisma.appointment.findUnique({ where: { id: appointment.id } });
  assert.ok(['CHECKED_IN', 'CANCELLED'].includes(persisted.status));
  if (persisted.status === 'CHECKED_IN') {
    assert.equal(responses[0].status, 409);
  } else {
    assert.equal(responses[1].status, 409);
  }
  const successAudits = await prisma.tenantAuditLog.count({
    where: {
      action: { in: ['PATIENT_APPOINTMENT_CANCELLED', 'APPOINTMENT_STATUS_UPDATED'] },
      details: { contains: appointment.id }
    }
  });
  assert.equal(successAudits, 1);
});

test('concurrent patient reschedule and receptionist check-in cannot lose a transition', async () => {
  const fixture = await createAppointmentConcurrencyPatient();
  const appointment = await createConcurrencyAppointment(fixture.patient.id, 'CONFIRMED');
  const newSlot = await findAvailableAppointmentSlot(doctor1.id);
  const responses = await Promise.all([
    api.put(`/api/patient/appointments/${appointment.id}/reschedule`)
      .set({ Authorization: `Bearer ${fixture.token}` })
      .send(newSlot),
    api.put(`/api/appointments/${appointment.id}/status`).set(auth('reception')).send({ status: 'CHECKED_IN' })
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  assert.equal(responses.find((response) => response.status === 409).body.error.code, 'APPOINTMENT_STATE_CONFLICT');
  const persisted = await prisma.appointment.findUnique({ where: { id: appointment.id } });
  assert.ok(['PENDING', 'CHECKED_IN'].includes(persisted.status));
  if (persisted.status === 'PENDING') {
    assert.equal(persisted.appointmentDate, newSlot.appointmentDate);
    assert.equal(responses[1].status, 409);
  } else {
    assert.equal(responses[0].status, 409);
    assert.notEqual(persisted.appointmentDate, newSlot.appointmentDate);
  }
});

test('normal patient cancellation and reschedule remain available only from cancellable states', async () => {
  const fixture = await createAppointmentConcurrencyPatient();
  const cancellable = await createConcurrencyAppointment(fixture.patient.id, 'CONFIRMED');
  const cancelled = await api.post(`/api/patient/appointments/${cancellable.id}/cancel`)
    .set({ Authorization: `Bearer ${fixture.token}` });
  assert.equal(cancelled.status, 200);
  assert.equal((await prisma.appointment.findUnique({ where: { id: cancellable.id } })).status, 'CANCELLED');

  const reschedulable = await createConcurrencyAppointment(fixture.patient.id, 'CONFIRMED');
  const newSlot = await findAvailableAppointmentSlot(doctor1.id);
  const rescheduled = await api.put(`/api/patient/appointments/${reschedulable.id}/reschedule`)
    .set({ Authorization: `Bearer ${fixture.token}` })
    .send(newSlot);
  assert.equal(rescheduled.status, 200);
  assert.equal(rescheduled.body.status, 'PENDING');

  const checkedIn = await createConcurrencyAppointment(fixture.patient.id, 'CHECKED_IN');
  const blockedReschedule = await api.put(`/api/patient/appointments/${checkedIn.id}/reschedule`)
    .set({ Authorization: `Bearer ${fixture.token}` })
    .send(newSlot);
  assert.equal(blockedReschedule.status, 409);
  assert.equal((await prisma.appointment.findUnique({ where: { id: checkedIn.id } })).status, 'CHECKED_IN');
});

test('normal receptionist transitions work and terminal appointment states remain terminal', async () => {
  const appointment = await createConcurrencyAppointment(patient1.id, 'PENDING');
  const confirmed = await api.put(`/api/appointments/${appointment.id}/status`)
    .set(auth('reception')).send({ status: 'CONFIRMED' });
  assert.equal(confirmed.status, 200);
  const checkedIn = await api.put(`/api/appointments/${appointment.id}/status`)
    .set(auth('reception')).send({ status: 'CHECKED_IN' });
  assert.equal(checkedIn.status, 200);

  const terminal = await createConcurrencyAppointment(patient1.id, 'COMPLETED');
  const rejected = await api.put(`/api/appointments/${terminal.id}/status`)
    .set(auth('admin')).send({ status: 'CONFIRMED' });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.error.code, 'ILLEGAL_APPOINTMENT_STATUS_TRANSITION');
  assert.equal((await prisma.appointment.findUnique({ where: { id: terminal.id } })).status, 'COMPLETED');
});

test('receptionist can create a new walk-in atomically and place it in the doctor queue', async () => {
  const slot = await findTodayWalkInSlot(doctor1.id);
  const nationalId = `WALKIN-${Date.now()}-${++fixtureCounter}`;
  const payload = {
    mode: 'NEW', doctorId: doctor1.id, appointmentDate: getClinicDateString(), appointmentTime: slot,
    patient: {
      fullNameAr: 'مريض حضور مباشر', fullNameEn: `Walk-in ${fixtureCounter}`, gender: 'MALE',
      dateOfBirth: '1990-01-01', nationalId, phone: `0999${String(fixtureCounter).padStart(6, '0')}`,
      addressStateId: 1, emergencyContact: 'Self'
    }
  };
  const response = await api.post('/api/appointments/walk-in').set(auth('reception')).send(payload);
  assert.equal(response.status, 201);
  assert.equal(response.body.status, 'CHECKED_IN');
  assert.equal(response.body.doctorId, doctor1.id);
  assert.equal(response.body.appointmentDate, getClinicDateString());
  const patient = await prisma.patient.findUnique({ where: { nationalId } });
  assert.ok(patient);
  const persisted = await prisma.appointment.findUnique({ where: { id: response.body.id } });
  assert.equal(persisted.patientId, patient.id);
  assert.equal((await api.get(`/api/appointments/queue/${doctor1.id}`).query({ date: getClinicDateString() }).set(auth('doctor'))).body.some((item) => item.id === response.body.id), true);
  assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'WALK_IN_APPOINTMENT_CREATED', details: { contains: response.body.id } } }), 1);
});

test('walk-in role authorization and validation are enforced', async () => {
  const body = { mode: 'EXISTING', patientId: patient1.id, doctorId: doctor1.id, appointmentDate: getClinicDateString(), appointmentTime: '09:00' };
  for (const role of ['doctor', 'pharmacy', 'lab']) {
    const response = await api.post('/api/appointments/walk-in').set(auth(role)).send(body);
    assert.equal(response.status, 403);
  }
  const patientFixture = await createAppointmentConcurrencyPatient();
  assert.equal((await api.post('/api/appointments/walk-in').set({ Authorization: `Bearer ${patientFixture.token}` }).send(body)).status, 403);
  assert.equal((await api.post('/api/appointments/walk-in').set(auth('reception')).send({ ...body, doctorId: crypto.randomUUID() })).status, 404);
  assert.equal((await api.post('/api/appointments/walk-in').set(auth('reception')).send({ ...body, appointmentDate: '2099-01-01' })).status, 422);
  assert.equal((await api.post('/api/appointments/walk-in').set(auth('reception')).send({ ...body, appointmentTime: '23:59' })).status, 422);
  assert.equal((await api.post('/api/appointments/walk-in').set(auth('reception')).send({ ...body, status: 'CHECKED_IN' })).status, 422);
  assert.equal((await api.post('/api/appointments/walk-in').set(auth('reception')).send({ ...body, patientId: crypto.randomUUID() })).status, 404);
  const adminSlot = await findTodayWalkInSlot(doctor1.id);
  const adminPatient = await prisma.patient.create({ data: {
    fullNameAr: `مريض مدير مباشر ${fixtureCounter + 1}`, fullNameEn: `Admin walk-in ${fixtureCounter + 1}`,
    gender: 'FEMALE', dateOfBirth: '1991-01-01', phone: `0966${String(++fixtureCounter).padStart(6, '0')}`,
    addressStateId: 1, emergencyContact: 'Self'
  } });
  assert.equal((await api.post('/api/appointments/walk-in').set(auth('admin')).send({ ...body, patientId: adminPatient.id, appointmentTime: adminSlot })).status, 201);
});

test('existing patient walk-in prevents duplicate same-day intake and preserves billing gate', async () => {
  const slot = await findTodayWalkInSlot(doctor1.id);
  const body = { mode: 'EXISTING', patientId: patient1.id, doctorId: doctor1.id, appointmentDate: getClinicDateString(), appointmentTime: slot };
  const first = await api.post('/api/appointments/walk-in').set(auth('reception')).send(body);
  assert.equal(first.status, 201);
  assert.equal(await prisma.patient.count({ where: { id: patient1.id } }), 1);
  const duplicate = await api.post('/api/appointments/walk-in').set(auth('reception')).send({ ...body, appointmentTime: slot });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, 'WALK_IN_ALREADY_EXISTS');
  const start = await api.put(`/api/appointments/${first.body.id}/status`).set(auth('doctor')).send({ status: 'IN_CONSULTATION' });
  assert.equal(start.status, 409);
  assert.equal(start.body.error.code, 'CONSULTATION_PAYMENT_REQUIRED');
});

test('walk-in slot conflicts roll back a newly created patient', async () => {
  const slot = await findTodayWalkInSlot(doctor1.id);
  const existingPatient = await prisma.patient.create({ data: {
    fullNameAr: `مريض تعارض قائم ${fixtureCounter + 1}`, fullNameEn: `Existing conflict patient ${fixtureCounter + 1}`,
    gender: 'MALE', dateOfBirth: '1989-01-01', phone: `0955${String(++fixtureCounter).padStart(6, '0')}`,
    addressStateId: 1, emergencyContact: 'Self'
  } });
  const existing = await api.post('/api/appointments/walk-in').set(auth('reception')).send({
    mode: 'EXISTING', patientId: existingPatient.id, doctorId: doctor1.id, appointmentDate: getClinicDateString(), appointmentTime: slot
  });
  assert.equal(existing.status, 201);
  const nationalId = `WALKIN-CONFLICT-${Date.now()}`;
  const response = await api.post('/api/appointments/walk-in').set(auth('reception')).send({
    mode: 'NEW', doctorId: doctor1.id, appointmentDate: getClinicDateString(), appointmentTime: slot,
    patient: { fullNameAr: 'مريض تعارض', fullNameEn: 'Conflict Walk-in', gender: 'FEMALE', dateOfBirth: '1991-01-01', nationalId, phone: `0988${Date.now().toString().slice(-6)}`, addressStateId: 1 }
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'APPOINTMENT_SLOT_UNAVAILABLE');
  assert.equal(await prisma.patient.count({ where: { nationalId } }), 0);
});

test('concurrent walk-in requests claim one slot and one same-patient appointment', async () => {
  const slot = await findTodayWalkInSlot(doctor1.id);
  const concurrentPatient = await prisma.patient.create({ data: {
    fullNameAr: `مريض تزامن مباشر ${fixtureCounter + 1}`,
    fullNameEn: `Concurrent walk-in ${fixtureCounter + 1}`,
    gender: 'MALE', dateOfBirth: '1990-01-01', phone: `0977${String(++fixtureCounter).padStart(6, '0')}`,
    addressStateId: 1, emergencyContact: 'Self'
  } });
  const makeBody = (patientId) => ({ mode: 'EXISTING', patientId, doctorId: doctor1.id, appointmentDate: getClinicDateString(), appointmentTime: slot });
  const responses = await Promise.all([
    api.post('/api/appointments/walk-in').set(auth('reception')).send(makeBody(concurrentPatient.id)),
    api.post('/api/appointments/walk-in').set(auth('reception')).send(makeBody(concurrentPatient.id))
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal(responses.find((response) => response.status === 409).body.error.code, 'WALK_IN_ALREADY_EXISTS');
  assert.equal(await prisma.appointment.count({ where: { patientId: concurrentPatient.id, appointmentDate: getClinicDateString(), status: 'CHECKED_IN' } }), 1);
});

test('concurrent walk-ins from different patients claim one doctor slot', async () => {
  const slot = await findTodayWalkInSlot(doctor1.id);
  const firstPatient = await createStandaloneTestPatient('Different A');
  const secondPatient = await createStandaloneTestPatient('Different B');
  const request = (patientId) => api.post('/api/appointments/walk-in').set(auth('reception')).send({
    mode: 'EXISTING', patientId, doctorId: doctor1.id, appointmentDate: getClinicDateString(), appointmentTime: slot
  });
  const responses = await Promise.all([request(firstPatient.id), request(secondPatient.id)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal(responses.find((response) => response.status === 409).body.error.code, 'APPOINTMENT_SLOT_UNAVAILABLE');
  assert.equal(await prisma.appointment.count({ where: { doctorId: doctor1.id, appointmentDate: getClinicDateString(), appointmentTime: slot, status: { notIn: ['CANCELLED', 'NO_SHOW'] } } }), 1);
});

test('concurrent new walk-ins roll back the losing Patient atomically', async () => {
  const slot = await findTodayWalkInSlot(doctor1.id);
  const suffix = String(++fixtureCounter).padStart(6, '0').slice(-6);
  const makeRequest = (label) => api.post('/api/appointments/walk-in').set(auth('reception')).send({
    mode: 'NEW', doctorId: doctor1.id, appointmentDate: getClinicDateString(), appointmentTime: slot,
    patient: {
      fullNameAr: `مريض جديد ${label}`, fullNameEn: `New walk-in ${label}`, gender: 'FEMALE', dateOfBirth: '1991-01-01',
      nationalId: `C1-${suffix}-${label}`, phone: `+24995${suffix}${label === 'A' ? '1' : '2'}`, addressStateId: 1
    }
  });
  const responses = await Promise.all([makeRequest('A'), makeRequest('B')]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  const winner = responses.find((response) => response.status === 201);
  const loser = responses.find((response) => response.status === 409);
  assert.equal(loser.body.error.code, 'APPOINTMENT_SLOT_UNAVAILABLE');
  const nationalIds = [`C1-${suffix}-A`, `C1-${suffix}-B`];
  assert.equal(await prisma.patient.count({ where: { nationalId: { in: nationalIds } } }), 1);
  assert.equal(await prisma.appointment.count({ where: { doctorId: doctor1.id, appointmentDate: getClinicDateString(), appointmentTime: slot, status: { notIn: ['CANCELLED', 'NO_SHOW'] } } }), 1);
  assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'WALK_IN_APPOINTMENT_CREATED', details: { contains: winner.body.id } } }), 1);
});

test('walk-in rejects an inactive doctor', async () => {
  const previous = await prisma.doctor.findUnique({ where: { id: doctor2.id }, select: { status: true } });
  await prisma.doctor.update({ where: { id: doctor2.id }, data: { status: 'INACTIVE' } });
  try {
    const response = await api.post('/api/appointments/walk-in').set(auth('reception')).send({
      mode: 'EXISTING', patientId: patient2.id, doctorId: doctor2.id,
      appointmentDate: getClinicDateString(), appointmentTime: '09:00'
    });
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'DOCTOR_NOT_FOUND');
  } finally {
    await prisma.doctor.update({ where: { id: doctor2.id }, data: { status: previous.status } });
  }
});

test('emergency override and transfer atomically claim their observed appointment state', async () => {
  const overrideAppointment = await createConcurrencyAppointment(patient1.id, 'CONFIRMED');
  const overrideResponses = await Promise.all([
    api.post(`/api/appointments/${overrideAppointment.id}/override`).set(auth('reception')).send({ justification: 'Concurrent emergency override test one' }),
    api.post(`/api/appointments/${overrideAppointment.id}/override`).set(auth('reception')).send({ justification: 'Concurrent emergency override test two' })
  ]);
  assert.deepEqual(overrideResponses.map((response) => response.status).sort(), [200, 409]);
  assert.equal(await prisma.emergencyOverride.count({ where: { appointmentId: overrideAppointment.id } }), 1);
  assert.equal(await prisma.tenantAuditLog.count({
    where: { action: 'QUEUE_EMERGENCY_OVERRIDE', details: { contains: overrideAppointment.id } }
  }), 1);

  const transferSlot = await findTransferAppointmentSlot(doctor1.id, doctor2.id);
  const transferAppointment = await prisma.appointment.create({ data: {
    patientId: patient1.id,
    doctorId: doctor1.id,
    appointmentDate: transferSlot.appointmentDate,
    appointmentTime: transferSlot.appointmentTime,
    status: 'CHECKED_IN'
  } });
  const transferred = await api.post(`/api/appointments/${transferAppointment.id}/transfer`)
    .set(auth('reception')).send({ targetDoctorId: doctor2.id });
  assert.equal(transferred.status, 200);
  assert.equal((await prisma.appointment.findUnique({ where: { id: transferAppointment.id } })).doctorId, doctor2.id);
  assert.equal(await prisma.tenantAuditLog.count({
    where: { action: 'PATIENT_INTERNAL_TRANSFER', details: { contains: transferAppointment.id } }
  }), 1);
});

test('staff login succeeds with valid credentials', async () => {
  const response = await api.post('/api/auth/login').send({ username: 'admin@cms.com', password: 'Admin@123' });
  assert.equal(response.status, 200);
  assert.match(response.headers['cache-control'], /(?:^|,)\s*no-store(?:,|$)/);
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
  assert.match(firstEnrollment.headers['cache-control'], /(?:^|,)\s*no-store(?:,|$)/);
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
  assert.match(regenerate.headers['cache-control'], /(?:^|,)\s*no-store(?:,|$)/);
  assert.equal(regenerate.body.recoveryCodes.length, 10);

  const beforeDisable = await prisma.user.findUnique({ where: { id: staff.id }, select: { authVersion: true } });

  const invalidatedRecoveryLogin = await recoveryChallengeFor();
  assert.equal((await verifyRecovery(invalidatedRecoveryLogin, confirmation.body.recoveryCodes[9])).status, 401);

  const beforeFailedDisable = await prisma.user.findUnique({ where: { id: staff.id }, select: { authVersion: true, mfaEnabled: true } });
  const failedDisableAuditCount = await prisma.tenantAuditLog.count({ where: { userId: staff.id, action: 'MFA_DISABLED' } });
  let disable = await api.delete('/api/auth/mfa').set({ Authorization: `Bearer ${staffToken}` })
    .send({ currentPassword: 'wrong-password', recoveryCode: regenerate.body.recoveryCodes[0] });
  assert.equal(disable.status, 401);
  disable = await api.delete('/api/auth/mfa').set({ Authorization: `Bearer ${staffToken}` })
    .send({ currentPassword: password, recoveryCode: 'AAAAA-AAAAA-AAAAA-AAAAA' });
  assert.equal(disable.status, 401);
  const afterFailedDisable = await prisma.user.findUnique({ where: { id: staff.id }, select: { authVersion: true, mfaEnabled: true } });
  assert.equal(afterFailedDisable.authVersion, beforeFailedDisable.authVersion);
  assert.equal(afterFailedDisable.mfaEnabled, true);
  assert.equal(await prisma.tenantAuditLog.count({ where: { userId: staff.id, action: 'MFA_DISABLED' } }), failedDisableAuditCount);
  disable = await api.delete('/api/auth/mfa').set({ Authorization: `Bearer ${staffToken}` })
    .send({ currentPassword: password, recoveryCode: regenerate.body.recoveryCodes[0] });
  assert.equal(disable.status, 200);
  const disabledUser = await prisma.user.findUnique({ where: { id: staff.id } });
  assert.equal(disabledUser.mfaEnabled, false);
  assert.equal(disabledUser.authVersion, beforeDisable.authVersion + 1);
  assert.equal(await prisma.mfaConfiguration.findUnique({ where: { userId: staff.id } }), null);
  assert.equal(await prisma.mfaRecoveryCode.count({ where: { userId: staff.id } }), 0);
  assert.equal(await prisma.tenantAuditLog.count({ where: { userId: staff.id, action: 'MFA_DISABLED' } }), failedDisableAuditCount + 1);

  const staleHttpSession = await api.get('/api/appointments/pending')
    .set({ Authorization: `Bearer ${staffToken}` });
  assert.equal(staleHttpSession.status, 401);
  assert.equal(staleHttpSession.body.error.code, 'SESSION_REVOKED');
  assert.ok((await checkSocketToken(staffToken)).error instanceof Error);

  const newSession = await api.post('/api/auth/login').send({ username, password });
  assert.equal(newSession.status, 200);
  assert.equal(verifyAccessToken(newSession.body.token).av, disabledUser.authVersion);
  assert.equal((await api.get('/api/appointments/pending').set({ Authorization: `Bearer ${newSession.body.token}` })).status, 200);

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

test('admin staff list includes only intended staff roles and excludes patients', async () => {
  const patient = await prisma.user.create({
    data: {
      username: `staff-list-patient-${Date.now()}@example.test`,
      passwordHash: 'not-used',
      role: 'PATIENT',
      status: 'ACTIVE'
    }
  });
  const response = await api.get('/api/auth/users').set(auth('admin'));
  assert.equal(response.status, 200);
  assert.equal(response.body.some((user) => user.id === patient.id), false);
  assert.equal(response.body.every((user) => STAFF_ROLES.includes(user.role)), true);
  for (const role of STAFF_ROLES) assert.equal(response.body.some((user) => user.role === role), true);
  assert.equal((await api.get('/api/auth/users').set(auth('pharmacy'))).status, 403);
});

test('audit log endpoint is ADMIN-only, paginated, filtered, and returns safe actor identity', async () => {
  const admin = await prisma.user.findUnique({ where: { username: 'admin@cms.com' } });
  const marker = `AUDIT_PRESENTATION_TEST_${Date.now()}`;
  const targetId = crypto.randomUUID();
  const audit = await prisma.tenantAuditLog.create({
    data: {
      userId: admin.id,
      action: marker,
      details: JSON.stringify({ appointmentId: targetId, previousStatus: 'ACTIVE', status: 'INACTIVE', passwordHash: 'must-not-return' }),
      ipAddress: '192.0.2.10'
    }
  });
  const unavailableActorAudit = await prisma.tenantAuditLog.create({
    data: {
      userId: crypto.randomUUID(),
      action: `UNKNOWN_AUDIT_EVENT_${Date.now()}`,
      details: 'Legacy event with an unavailable actor.',
      ipAddress: '192.0.2.11',
      timestamp: new Date('2035-03-12T10:15:00.000Z')
    }
  });
  const redactedAudit = await prisma.tenantAuditLog.create({
    data: {
      userId: admin.id,
      action: `LEGACY_REDACTION_TEST_${Date.now()}`,
      details: 'Unexpected provider failure included Bearer attacker-marker-token-value',
      ipAddress: '192.0.2.12'
    }
  });

  assert.equal((await api.get('/api/auth/audit-logs').set(auth('doctor'))).status, 403);
  const response = await api.get(`/api/auth/audit-logs?action=${marker}&page=1&pageSize=10`).set(auth('admin'));
  assert.equal(response.status, 200);
  assert.equal(response.body.items.length, 1);
  assert.equal(response.body.items[0].id, audit.id);
  assert.equal(response.body.items[0].actor.id, admin.id);
  assert.equal(response.body.items[0].actor.username, admin.username);
  assert.equal(response.body.items[0].actor.role, 'ADMIN');
  assert.deepEqual(response.body.items[0].target, { type: 'APPOINTMENT', id: targetId });
  assert.equal(response.body.pagination.pageSize, 10);
  assert.equal(response.body.pagination.total, 1);
  const serialized = JSON.stringify(response.body);
  for (const field of ['passwordHash', 'mfaSecret', 'mfaEnabled', 'authVersion', 'must-not-return']) {
    assert.equal(serialized.includes(field), false);
  }

  const searched = await api.get('/api/auth/audit-logs?search=admin%40cms.com&pageSize=10').set(auth('admin'));
  assert.equal(searched.status, 200);
  assert.ok(searched.body.items.every((entry) => entry.actor?.id === admin.id));
  const roleFiltered = await api.get(`/api/auth/audit-logs?action=${marker}&role=ADMIN&pageSize=10`).set(auth('admin'));
  assert.equal(roleFiltered.status, 200);
  assert.deepEqual(roleFiltered.body.items.map(({ id }) => id), [audit.id]);

  const dateFiltered = await api.get(`/api/auth/audit-logs?action=${unavailableActorAudit.action}&from=2035-03-12&to=2035-03-12&pageSize=10`).set(auth('admin'));
  assert.equal(dateFiltered.status, 200);
  assert.equal(dateFiltered.body.items.length, 1);
  assert.equal(dateFiltered.body.items[0].id, unavailableActorAudit.id);
  assert.equal(dateFiltered.body.items[0].actor, null);
  assert.equal(dateFiltered.body.items[0].action, unavailableActorAudit.action);

  const outsideDate = await api.get(`/api/auth/audit-logs?action=${unavailableActorAudit.action}&from=2035-03-13&to=2035-03-13&pageSize=10`).set(auth('admin'));
  assert.equal(outsideDate.status, 200);
  assert.equal(outsideDate.body.items.length, 0);

  const redacted = await api.get(`/api/auth/audit-logs?action=${redactedAudit.action}&pageSize=10`).set(auth('admin'));
  assert.equal(redacted.status, 200);
  assert.equal(redacted.body.items[0].details, '[Sensitive audit detail redacted]');
  assert.equal(JSON.stringify(redacted.body).includes('attacker-marker-token-value'), false);
  for (const query of ['pageSize=51', 'role=SUPER_ADMIN', 'from=2026-08-30&to=2026-08-01', 'action=invalid%20event']) {
    const invalid = await api.get(`/api/auth/audit-logs?${query}`).set(auth('admin'));
    assertSafeValidationError(invalid);
  }
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

test('staff status endpoint rejects ACTIVE and PENDING_VERIFICATION patient targets without revocation', async () => {
  const patients = await Promise.all([
    prisma.user.create({ data: {
      username: `staff-status-active-patient-${Date.now()}@example.test`,
      passwordHash: 'not-used', role: 'PATIENT', status: 'ACTIVE'
    } }),
    prisma.user.create({ data: {
      username: `staff-status-pending-patient-${Date.now()}@example.test`,
      passwordHash: 'not-used', role: 'PATIENT', status: 'PENDING_VERIFICATION'
    } })
  ]);
  const listener = new Client({ connectionString: process.env.SOCKET_REVOCATION_DATABASE_URL || process.env.DATABASE_URL });
  const events = [];
  await listener.connect();
  await listener.query(`LISTEN ${SOCKET_REVOCATION_CHANNEL}`);
  listener.on('notification', (message) => {
    try {
      const payload = JSON.parse(message.payload);
      if (patients.some((patient) => patient.id === payload.userId)) events.push(payload);
    } catch {}
  });
  try {
    for (const patient of patients) {
      const requestedStatus = patient.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      const response = await api.put(`/api/auth/users/${patient.id}/status`)
        .set(auth('admin')).send({ status: requestedStatus });
      assertSafeAuthorizationDenial(response, 422);
      assert.equal(response.body.error.code, 'STAFF_STATUS_UNSUPPORTED');
      const unchanged = await prisma.user.findUnique({ where: { id: patient.id } });
      assert.equal(unchanged.status, patient.status);
      assert.equal(unchanged.authVersion, patient.authVersion);
      assert.equal(await prisma.tenantAuditLog.count({
        where: { action: 'USER_STATUS_CHANGE', details: { contains: patient.username } }
      }), 0);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(events.length, 0);
  } finally {
    await listener.end();
  }
});

test('staff status transitions revoke old HTTP sessions once and never resurrect them', async () => {
  const username = `status-revocation-${Date.now()}@example.test`;
  const password = 'StatusRevocationPass1';
  const target = await prisma.user.create({
    data: { username, passwordHash: await bcrypt.hash(password, 10), role: 'RECEPTIONIST', status: 'ACTIVE' }
  });
  const endpoint = `/api/auth/users/${target.id}/status`;
  const oldLogin = await api.post('/api/auth/login').send({ username, password });
  assert.equal(oldLogin.status, 200);
  assert.equal((await api.get('/api/patients').set({ Authorization: `Bearer ${oldLogin.body.token}` })).status, 200);

  const noOp = await api.put(endpoint).set(auth('admin')).send({ status: 'ACTIVE' });
  assert.equal(noOp.status, 200);
  assert.equal((await prisma.user.findUnique({ where: { id: target.id } })).authVersion, target.authVersion);
  assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'USER_STATUS_CHANGE', details: { contains: username } } }), 0);

  const transitions = await Promise.all([
    api.put(endpoint).set(auth('admin')).send({ status: 'INACTIVE' }),
    api.put(endpoint).set(auth('admin')).send({ status: 'INACTIVE' })
  ]);
  assert.equal(transitions.every((response) => response.status === 200), true);
  const inactive = await prisma.user.findUnique({ where: { id: target.id } });
  assert.equal(inactive.status, 'INACTIVE');
  assert.equal(inactive.authVersion, target.authVersion + 1);
  assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'USER_STATUS_CHANGE', details: { contains: username } } }), 1);

  let rejected = await api.get('/api/patients').set({ Authorization: `Bearer ${oldLogin.body.token}` });
  assert.equal(rejected.status, 401);
  assert.equal(rejected.body.error.code, 'SESSION_REVOKED');

  const reactivated = await api.put(endpoint).set(auth('admin')).send({ status: 'ACTIVE' });
  assert.equal(reactivated.status, 200);
  const active = await prisma.user.findUnique({ where: { id: target.id } });
  assert.equal(active.authVersion, target.authVersion + 2);
  assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'USER_STATUS_CHANGE', details: { contains: username } } }), 2);

  rejected = await api.get('/api/patients').set({ Authorization: `Bearer ${oldLogin.body.token}` });
  assert.equal(rejected.status, 401);
  assert.equal(rejected.body.error.code, 'SESSION_REVOKED');
  const currentLogin = await api.post('/api/auth/login').send({ username, password });
  assert.equal(currentLogin.status, 200);
  assert.equal((await api.get('/api/patients').set({ Authorization: `Bearer ${currentLogin.body.token}` })).status, 200);
});

test('failed staff status requests do not rotate sessions or create success audits', async () => {
  const username = `status-failure-${Date.now()}@example.test`;
  const target = await prisma.user.create({
    data: { username, passwordHash: await bcrypt.hash('StatusFailurePass1', 10), role: 'RECEPTIONIST', status: 'ACTIVE' }
  });
  const endpoint = `/api/auth/users/${target.id}/status`;
  const invalid = await api.put(endpoint).set(auth('admin')).send({ status: 'DISABLED' });
  assert.equal(invalid.status, 422);
  assert.equal((await api.put(endpoint).set(auth('pharmacy')).send({ status: 'INACTIVE' })).status, 403);
  assert.equal((await api.put('/api/auth/users/00000000-0000-4000-8000-000000000099/status').set(auth('admin')).send({ status: 'INACTIVE' })).status, 500);
  const unchanged = await prisma.user.findUnique({ where: { id: target.id } });
  assert.equal(unchanged.status, target.status);
  assert.equal(unchanged.authVersion, target.authVersion);
  assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'USER_STATUS_CHANGE', details: { contains: username } } }), 0);
});

test('staff status audit failure rolls back status, authVersion, audit, and revocation notification', async () => {
  const username = `status-audit-rollback-${Date.now()}@example.test`;
  const target = await prisma.user.create({
    data: { username, passwordHash: await bcrypt.hash('StatusAuditRollback1', 10), role: 'RECEPTIONIST', status: 'ACTIVE' }
  });
  const functionName = `fail_status_audit_${target.id.replaceAll('-', '_')}`;
  const triggerName = `fail_status_audit_trigger_${target.id.replaceAll('-', '_')}`;
  const listener = new Client({ connectionString: process.env.SOCKET_REVOCATION_DATABASE_URL || process.env.DATABASE_URL });
  const events = [];
  await listener.connect();
  await listener.query(`LISTEN ${SOCKET_REVOCATION_CHANNEL}`);
  listener.on('notification', (message) => {
    try {
      const payload = JSON.parse(message.payload);
      if (payload.userId === target.id) events.push(payload);
    } catch {}
  });
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${functionName}() RETURNS trigger AS $$ BEGIN IF NEW."action" = 'USER_STATUS_CHANGE' AND NEW."details" LIKE '%${username}%' THEN RAISE EXCEPTION 'forced status audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON "TenantAuditLog" FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
  try {
    const response = await api.put(`/api/auth/users/${target.id}/status`).set(auth('admin')).send({ status: 'INACTIVE' });
    assert.equal(response.status, 500);
    assertNoSensitiveErrorLeak(response.body, ['forced status audit failure']);
    const after = await prisma.user.findUnique({ where: { id: target.id } });
    assert.equal(after.status, target.status);
    assert.equal(after.authVersion, target.authVersion);
    assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'USER_STATUS_CHANGE', details: { contains: username } } }), 0);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(events.length, 0);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON "TenantAuditLog"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${functionName}()`);
    await listener.end();
  }
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

test('trusted, multiple, null, and absent origins follow the exact CORS contract', async () => {
  const trustedOrigin = 'http://localhost:5173';
  const trusted = await api.get('/api/health/live').set('Origin', trustedOrigin);
  assert.equal(trusted.status, 200);
  assert.equal(trusted.headers['access-control-allow-origin'], trustedOrigin);
  assert.equal(trusted.headers['access-control-allow-credentials'], undefined);

  const noOrigin = await api.get('/api/health/live');
  assert.equal(noOrigin.status, 200);
  assert.equal(noOrigin.headers['access-control-allow-origin'], undefined);

  const nullOrigin = await api.get('/api/health/live').set('Origin', 'null');
  assert.equal(nullOrigin.status, 403);
  assert.equal(nullOrigin.body.error.code, 'CORS_ORIGIN_FORBIDDEN');

  const origins = ['https://clinic-a.example', 'https://clinic-b.example'];
  const corsApp = express();
  corsApp.use(corsMiddleware(origins));
  corsApp.get('/probe', (req, res) => res.json({ ok: true }));
  corsApp.use(errorHandler);
  for (const origin of origins) {
    const accepted = await request(corsApp).get('/probe').set('Origin', origin);
    assert.equal(accepted.status, 200);
    assert.equal(accepted.headers['access-control-allow-origin'], origin);
    assert.equal(accepted.headers['access-control-allow-credentials'], undefined);
  }
  const rejected = await request(corsApp).get('/probe').set('Origin', 'https://attacker.example');
  assert.equal(rejected.status, 403);
  assert.equal(rejected.body.error.code, 'CORS_ORIGIN_FORBIDDEN');
  assertNoSensitiveErrorLeak(rejected.body);
});

test('production CORS accepts canonical HTTPS origins and rejects malformed values', () => {
  const previous = { ...process.env };
  const secure = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://clinic.invalid/clinic',
    SOCKET_REVOCATION_DATABASE_URL: 'postgresql://clinic.invalid/clinic',
    JWT_SECRET: 'a-secure-jwt-secret-that-is-longer-than-32',
    MEDICAL_ENCRYPTION_KEY: 'a-distinct-medical-key-that-is-over-32-chars',
    MFA_ENCRYPTION_KEY: 'a-third-distinct-mfa-key-that-is-over-32-characters',
    CLINIC_TIME_ZONE: 'Africa/Khartoum',
    VERIFICATION_PROVIDER: 'disabled'
  };
  try {
    Object.assign(process.env, secure);
    process.env.CORS_ALLOWED_ORIGINS = ' https://clinic.example.com , https://clinic.example.com:8443 ';
    assert.deepEqual(validateEnvironment().allowedOrigins, ['https://clinic.example.com', 'https://clinic.example.com:8443']);
    process.env.CORS_ALLOWED_ORIGINS = 'https://clinic.example.com:443';
    assert.deepEqual(validateEnvironment().allowedOrigins, ['https://clinic.example.com']);
    for (const origin of [
      '*',
      'http://clinic.example.com',
      'https://clinic.example.com/path',
      'https://clinic.example.com/',
      'https://clinic.example.com/?x=1',
      'https://clinic.example.com/#fragment',
      'https://user:pass@clinic.example.com',
      'https://'
    ]) {
      process.env.CORS_ALLOWED_ORIGINS = origin;
      assert.throws(() => validateEnvironment(), /canonical explicit HTTPS origins/);
    }
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test('material Helmet headers and production HSTS are maintained', async () => {
  const response = await api.get('/api/health/live');
  assert.equal(response.headers['x-powered-by'], undefined);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
  assert.equal(response.headers['x-frame-options'], 'SAMEORIGIN');
  assert.equal(response.headers['cross-origin-resource-policy'], 'same-site');

  const productionApp = express();
  productionApp.disable('x-powered-by');
  productionApp.use(securityHeadersMiddleware(true));
  productionApp.get('/probe', (req, res) => res.json({ ok: true }));
  const production = await request(productionApp).get('/probe');
  assert.match(production.headers['strict-transport-security'], /max-age=31536000/i);
  assert.match(production.headers['strict-transport-security'], /includeSubDomains/i);
  assert.equal(production.headers['x-powered-by'], undefined);
});

test('representative login limiter returns a safe draft-7 429 response', async () => {
  const limiterApp = express();
  limiterApp.use(createLoginLimiter({ windowMs: 60_000, limit: 2 }));
  limiterApp.post('/login', (req, res) => res.status(401).json({ error: 'Invalid username or password.' }));
  assert.equal((await request(limiterApp).post('/login')).status, 401);
  assert.equal((await request(limiterApp).post('/login')).status, 401);
  const limited = await request(limiterApp).post('/login');
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'LOGIN_RATE_LIMITED');
  assert.ok(limited.headers.ratelimit);
  assert.ok(limited.headers['ratelimit-policy']);
  assert.ok(limited.headers['retry-after']);
  assertNoSensitiveErrorLeak(limited.body, ['password-marker', 'token-marker']);
});

test('Admin reset limiter is composite, safe, and cannot execute a throttled mutation', async () => {
  let handlerExecutions = 0;
  let mutations = 0;
  const limiterApp = express();
  limiterApp.use((req, res, next) => {
    req.user = { id: req.get('x-test-admin') || 'admin-a' };
    next();
  });
  limiterApp.use(createAdminResetLimiter({ windowMs: 60_000, limit: 2 }));
  limiterApp.post('/reset', (req, res) => {
    handlerExecutions += 1;
    return res.status(401).json({ error: 'Administrator reauthentication failed.' });
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.equal((await request(limiterApp).post('/reset').set('x-test-admin', 'admin-a')).status, 401);
  }
  const limited = await request(limiterApp).post('/reset').set('x-test-admin', 'admin-a');
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'ADMIN_RESET_RATE_LIMITED');
  assert.ok(limited.headers.ratelimit);
  assert.ok(limited.headers['ratelimit-policy']);
  assert.equal(handlerExecutions, 2);
  assert.equal(mutations, 0);
  assert.equal((await request(limiterApp).post('/reset').set('x-test-admin', 'admin-b')).status, 401);
  assert.equal(handlerExecutions, 3);
  assertNoSensitiveErrorLeak(limited.body, ['current-password-marker', 'totp-marker']);
});

test('disabled trust proxy ignores spoofed forwarded client IP', async () => {
  const proxyApp = express();
  proxyApp.set('trust proxy', false);
  proxyApp.get('/ip', (req, res) => res.json({ ip: req.ip }));
  const response = await request(proxyApp).get('/ip').set('X-Forwarded-For', '198.51.100.77');
  assert.equal(response.status, 200);
  assert.notEqual(response.body.ip, '198.51.100.77');
});

test('development appointment OTP responses are explicitly non-cacheable', async () => {
  const response = await api.post('/api/appointments/otp/request').send({ phone: `+24991${String(++fixtureCounter).padStart(7, '0').slice(-7)}` });
  assert.equal(response.status, 200);
  assert.equal(typeof response.body.developmentCode, 'string');
  assert.match(response.headers['cache-control'], /(?:^|,)\s*no-store(?:,|$)/);
});

test('patient search is limited to reception and admin', async () => {
  assert.equal((await api.get('/api/patients/search?q=Test').set(auth('reception'))).status, 200);
  assert.equal((await api.get('/api/patients/search?q=Test').set(auth('pharmacy'))).status, 403);
  assert.equal((await api.get('/api/patients/search?q=Test').set(auth('lab'))).status, 403);
});

test('patient identity normalization is deterministic and rejects malformed input', () => {
  assert.equal(normalizePatientPhone('091 234 5678'), normalizePatientPhone('+249912345678'));
  assert.equal(normalizePatientPhone('0912\u000012345'), null);
  assert.equal(normalizePatientPhone('not-a-phone'), null);
  assert.equal(normalizeNationalId('  ab-123  '), 'AB-123');
  assert.equal(normalizeNationalId('AB\u0000123'), null);
});

test('operational patient search is exact for national ID, bounded, and safely projected', async () => {
  const suffix = `${Date.now()}-${++fixtureCounter}`;
  const nationalId = `EXACT-${suffix}`;
  await prisma.patient.create({ data: {
    fullNameAr: `مريض بحث ${suffix}`, fullNameEn: `Search Patient ${suffix}`, gender: 'MALE',
    dateOfBirth: '1988-03-02', nationalId, phone: `+24991${String(fixtureCounter).padStart(7, '0').slice(-7)}`,
    addressStateId: 1, emergencyContact: 'Self', nationalIdAttachmentPath: '/private/national-id.pdf'
  } });
  const partial = await api.get(`/api/patients/search?q=${encodeURIComponent(nationalId.slice(0, -2))}`).set(auth('reception'));
  assert.equal(partial.status, 200);
  assert.equal(partial.body.some((item) => item.fullNameEn === `Search Patient ${suffix}`), false);
  const exact = await api.get(`/api/patients/search?q=${encodeURIComponent(nationalId)}&limit=1`).set(auth('reception'));
  assert.equal(exact.status, 200);
  assert.equal(exact.body.length, 1);
  assert.deepEqual(Object.keys(exact.body[0]).sort(), ['dateOfBirth', 'fileNumber', 'fullNameAr', 'fullNameEn', 'gender', 'id', 'phone', 'status'].sort());
  assert.equal((await api.get('/api/patients/search?q=a&limit=500').set(auth('reception'))).status, 422);
  for (const role of ['doctor', 'pharmacy', 'lab']) assert.equal((await api.get('/api/patients/search?q=Test').set(auth(role))).status, 403);
});

test('patient file numbers are server-assigned, searchable, and immutable', async () => {
  const suffix = String(++fixtureCounter).padStart(7, '0').slice(-7);
  const response = await api.post('/api/patients').set(auth('reception')).send({
    fullNameAr: 'مريض رقم الملف', fullNameEn: 'File Number Patient', gender: 'MALE', dateOfBirth: '1971-07-07',
    phone: `+24998${suffix}`, addressStateId: 1
  });
  assert.equal(response.status, 201);
  assert.match(response.body.fileNumber, /^SHF-\d+$/);
  const patient = await prisma.patient.findUnique({ where: { id: response.body.id }, select: { id: true, fileNumber: true } });
  assert.equal(patient.fileNumber, response.body.fileNumber);
  assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'PATIENT_FILE_CREATED', details: { contains: response.body.fileNumber } } }), 1);
  const injected = await api.post('/api/patients').set(auth('reception')).send({
    fullNameAr: 'مريض حقول محظورة', fullNameEn: 'Forbidden Fields Patient', gender: 'FEMALE', dateOfBirth: '1972-08-08',
    phone: `+24998${String(++fixtureCounter).padStart(7, '0').slice(-7)}`, addressStateId: 1, fileNumber: 'SHF-999999', mrn: 'SHF-999999'
  });
  assert.equal(injected.status, 422);
  assert.equal(await prisma.patient.count({ where: { fileNumber: 'SHF-999999' } }), 0);
  const search = await api.get(`/api/patients/search?q=%20${response.body.fileNumber.toLowerCase()}%20&limit=1`).set(auth('reception'));
  assert.equal(search.status, 200);
  assert.equal(search.body[0].fileNumber, response.body.fileNumber);
  assert.equal(normalizeFileNumber(' shf-1 '), 'SHF-000001');
  assert.equal((await api.get('/api/patients/search?q=SHF-abc').set(auth('reception'))).status, 422);
  await assert.rejects(() => prisma.patient.create({ data: {
    fileNumber: response.body.fileNumber, fullNameAr: 'مريض رقم مكرر', fullNameEn: 'Duplicate File Number',
    gender: 'FEMALE', dateOfBirth: '1975-05-05', phone: `+24998${String(++fixtureCounter).padStart(7, '0').slice(-7)}`,
    addressStateId: 1, emergencyContact: 'Self'
  } }));
  await assert.rejects(() => prisma.patient.update({ where: { id: patient.id }, data: { fileNumber: 'SHF-123456' } }));
  assert.equal((await prisma.patient.findUnique({ where: { id: patient.id }, select: { fileNumber: true } })).fileNumber, response.body.fileNumber);
});

test('patient self-service cannot update the server-authoritative file number', async () => {
  const fixture = await createAppointmentConcurrencyPatient();
  const before = await prisma.patient.findUnique({ where: { id: fixture.patient.id }, select: { fileNumber: true } });
  const response = await api.patch('/api/patient/me').set({ Authorization: `Bearer ${fixture.token}` }).send({ fileNumber: 'SHF-999999' });
  assert.equal(response.status, 422);
  assert.equal((await prisma.patient.findUnique({ where: { id: fixture.patient.id }, select: { fileNumber: true } })).fileNumber, before.fileNumber);
});

test('concurrent Patient creation receives distinct canonical file numbers', async () => {
  const suffix = String(++fixtureCounter).padStart(7, '0').slice(-7);
  const create = (label) => prisma.patient.create({ data: {
    fullNameAr: `مريض رقم متزامن ${label}`, fullNameEn: `Concurrent File ${label}`, gender: 'MALE',
    dateOfBirth: label === 'A' ? '1973-03-03' : '1974-04-04', phone: `+24999${suffix}${label === 'A' ? '1' : '2'}`,
    addressStateId: 1, emergencyContact: 'Self'
  }, select: { id: true, fileNumber: true } });
  const patients = await Promise.all([create('A'), create('B'), create('C'), create('D')]);
  assert.equal(new Set(patients.map((patient) => patient.fileNumber)).size, patients.length);
  assert.ok(patients.every((patient) => /^SHF-\d+$/.test(patient.fileNumber)));
});

test('rolled-back Patient creation consumes but never reuses a file-number sequence value', async () => {
  let rolledBackNumber;
  await assert.rejects(() => prisma.$transaction(async (tx) => {
    const created = await tx.patient.create({ data: {
      fullNameAr: 'مريض تراجع الرقم', fullNameEn: 'Rolled Back File', gender: 'MALE', dateOfBirth: '1976-06-06',
      phone: `+24999${String(++fixtureCounter).padStart(7, '0').slice(-7)}`, addressStateId: 1, emergencyContact: 'Self'
    }, select: { fileNumber: true } });
    rolledBackNumber = created.fileNumber;
    throw new Error('synthetic rollback');
  }));
  const next = await prisma.patient.create({ data: {
    fullNameAr: 'مريض بعد التراجع', fullNameEn: 'After Rollback File', gender: 'FEMALE', dateOfBirth: '1977-07-07',
    phone: `+24999${String(++fixtureCounter).padStart(7, '0').slice(-7)}`, addressStateId: 1, emergencyContact: 'Self'
  }, select: { fileNumber: true } });
  assert.notEqual(next.fileNumber, rolledBackNumber);
});

test('receptionist new-patient creation warns without merging and existing selection remains explicit', async () => {
  const phone = `+24992${String(++fixtureCounter).padStart(7, '0').slice(-7)}`;
  const existing = await prisma.patient.create({ data: {
    fullNameAr: 'مريض مطابق محتمل', fullNameEn: 'Possible Existing Patient', gender: 'FEMALE',
    dateOfBirth: '1993-05-04', phone, addressStateId: 1, emergencyContact: 'Self'
  } });
  const before = await prisma.patient.count();
  const response = await api.post('/api/patients').set(auth('reception')).send({
    fullNameAr: 'اسم جديد مشابه', fullNameEn: 'Similar New Name', gender: 'FEMALE', dateOfBirth: '1993-05-04',
    phone: '092 ' + phone.slice(-7), addressStateId: 1
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'POSSIBLE_PATIENT_DUPLICATE');
  assert.equal(response.body.error.details[0].id, existing.id);
  assert.match(response.body.error.details[0].phoneMasked, /•/);
  assert.equal(Object.hasOwn(response.body.error.details[0], 'nationalId'), false);
  assert.equal(await prisma.patient.count(), before);
});

test('walk-in NEW mode warns on a possible patient duplicate before creating either record', async () => {
  const slot = await findTodayWalkInSlot(doctor1.id);
  const suffix = String(++fixtureCounter).padStart(7, '0').slice(-7);
  const phone = `+24996${suffix}`;
  const existing = await prisma.patient.create({ data: {
    fullNameAr: 'مريض دخول محتمل', fullNameEn: 'Possible Walk-in Patient', gender: 'MALE',
    dateOfBirth: '1986-06-06', phone, addressStateId: 1, emergencyContact: 'Self'
  } });
  const beforePatients = await prisma.patient.count();
  const response = await api.post('/api/appointments/walk-in').set(auth('reception')).send({
    mode: 'NEW', doctorId: doctor1.id, appointmentDate: getClinicDateString(), appointmentTime: slot,
    patient: {
      fullNameAr: 'اسم مشابه للدخول', fullNameEn: 'Similar Walk-in Name', gender: 'MALE',
      dateOfBirth: '1986-06-06', phone, addressStateId: 1
    }
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'POSSIBLE_PATIENT_DUPLICATE');
  assert.equal(response.body.error.details[0].id, existing.id);
  assert.equal(await prisma.patient.count(), beforePatients);
  assert.equal(await prisma.appointment.count({ where: { patientId: existing.id, appointmentDate: getClinicDateString(), appointmentTime: slot } }), 0);
});

test('concurrent receptionist registration preserves database-enforced national-ID uniqueness', async () => {
  const suffix = String(++fixtureCounter).padStart(7, '0').slice(-7);
  const nationalId = `CONCURRENT-${suffix}`;
  const create = (label) => api.post('/api/patients').set(auth('reception')).send({
    fullNameAr: `مريض متزامن ${label}`, fullNameEn: `Concurrent Patient ${label}`, gender: 'FEMALE',
    dateOfBirth: label === 'A' ? '1981-01-01' : '1982-02-02', nationalId,
    phone: `+24997${suffix.slice(0, -1)}${label === 'A' ? '1' : '2'}`, addressStateId: 1
  });
  const responses = await Promise.all([create('A'), create('B')]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal(responses.find((response) => response.status === 409).body.error.code, 'POSSIBLE_PATIENT_DUPLICATE');
  assert.equal(await prisma.patient.count({ where: { nationalId } }), 1);
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

test('Patient A cannot use Patient B direct IDs or discover protected portal resources', async () => {
  const [attacker, victim] = await Promise.all([
    createAppointmentConcurrencyPatient(),
    createAppointmentConcurrencyPatient()
  ]);
  const victimAppointment = await createConcurrencyAppointment(victim.patient.id, 'CONFIRMED');
  const victimRecord = await prisma.medicalRecord.create({ data: {
    patientId: victim.patient.id,
    doctorId: doctor2.id,
    appointmentId: victimAppointment.id,
    symptomsEncrypted: encrypt('victim-only symptoms'),
    diagnosisEncrypted: encrypt('victim-only diagnosis'),
    treatmentEncrypted: encrypt('victim-only treatment'),
    clinicalNotesEncrypted: encrypt('victim-only notes'),
    vitalSignsJson: JSON.stringify({ secret: 'victim-only vital sign' })
  } });
  const victimPrescription = await prisma.prescription.create({ data: {
    medicalRecordId: victimRecord.id,
    patientId: victim.patient.id,
    doctorId: doctor2.id,
    status: 'ACTIVE'
  } });
  const victimLabOrder = await prisma.labOrder.create({ data: {
    medicalRecordId: victimRecord.id,
    patientId: victim.patient.id,
    doctorId: doctor2.id,
    status: 'COMPLETED',
    releasedToPatientAt: new Date(),
    items: { create: { serviceId: service.id, resultValue: 'victim-only result', resultVersion: 1 } }
  } });
  const victimNotification = await prisma.notification.create({ data: {
    userId: victim.user.id,
    title: 'Victim notification title',
    message: 'Victim notification contents'
  } });
  const victimInvoice = await prisma.invoice.create({ data: {
    patientId: victim.patient.id,
    appointmentId: victimAppointment.id,
    totalAmountSdg: 100,
    totalAmountUsd: 0.1,
    invoiceExchangeRate: 1000,
    createdBy: 'direct-id-coverage'
  } });
  const attackerAuth = { Authorization: `Bearer ${attacker.token}` };

  for (const response of [
    await api.get(`/api/patient/appointments/${victimAppointment.id}`).set(attackerAuth),
    await api.post(`/api/patient/appointments/${victimAppointment.id}/cancel`).set(attackerAuth),
    await api.get(`/api/patient/medical-records/${victimRecord.id}`).set(attackerAuth),
    await api.patch(`/api/notifications/${victimNotification.id}/read`).set(attackerAuth)
  ]) {
    assertSafeAuthorizationDenial(response, 404);
    assert.doesNotMatch(JSON.stringify(response.body), /victim-only|Victim notification/i);
  }

  const [appointments, records, prescriptions, labs, notifications] = await Promise.all([
    api.get('/api/patient/appointments').set(attackerAuth),
    api.get('/api/patient/medical-records').set(attackerAuth),
    api.get('/api/patient/prescriptions').set(attackerAuth),
    api.get('/api/patient/lab-results').set(attackerAuth),
    api.get('/api/notifications').set(attackerAuth)
  ]);
  assert.equal(appointments.body.some((item) => item.id === victimAppointment.id), false);
  assert.equal(records.body.some((item) => item.id === victimRecord.id), false);
  assert.equal(prescriptions.body.some((item) => item.id === victimPrescription.id), false);
  assert.equal(labs.body.some((item) => item.id === victimLabOrder.id), false);
  assert.equal(notifications.body.notifications.some((item) => item.id === victimNotification.id), false);

  const paymentAttempt = await api.post(`/api/billing/invoice/${victimInvoice.id}/payments`)
    .set({ ...attackerAuth, 'Idempotency-Key': `patient-idor-${Date.now()}` })
    .send({ payments: [{ amountSdg: 100, paymentMethod: 'CASH' }] });
  assertSafeAuthorizationDenial(paymentAttempt, 403);
  assert.equal(await prisma.payment.count({ where: { invoiceId: victimInvoice.id } }), 0);
  assert.equal((await prisma.appointment.findUnique({ where: { id: victimAppointment.id } })).status, 'CONFIRMED');
  assert.equal((await prisma.notification.findUnique({ where: { id: victimNotification.id } })).isRead, false);
});

test('Doctor A cannot use Doctor B appointment or record IDs for clinical actions', async () => {
  const appointment = await prisma.appointment.create({ data: {
    patientId: patient2.id,
    doctorId: doctor2.id,
    appointmentDate: '2063-03-03',
    appointmentTime: '11:00',
    status: 'IN_CONSULTATION'
  } });
  const record = await prisma.medicalRecord.create({ data: {
    patientId: patient2.id,
    doctorId: doctor2.id,
    appointmentId: appointment.id,
    symptomsEncrypted: encrypt('doctor-b symptoms'),
    diagnosisEncrypted: encrypt('doctor-b diagnosis'),
    treatmentEncrypted: encrypt('doctor-b treatment'),
    clinicalNotesEncrypted: encrypt('doctor-b notes'),
    vitalSignsJson: '{}'
  } });
  const before = await prisma.medicalRecord.findUnique({ where: { id: record.id } });
  const attempts = [
    await api.put(`/api/appointments/${appointment.id}/status`).set(auth('doctor')).send({ status: 'COMPLETED' }),
    await api.put(`/api/records/${record.id}/finalize`).set(auth('doctor')).send({ diagnosis: 'attacker overwrite', treatment: 'attacker plan', vitalSigns: {} }),
    await api.get(`/api/records/${record.id}/summary`).set(auth('doctor')),
    await api.post(`/api/records/${record.id}/send-summary`).set(auth('doctor')).send({})
  ];
  for (const response of attempts) {
    assertSafeAuthorizationDenial(response, 403);
    assert.equal(response.body.error.code, response === attempts[0] ? 'APPOINTMENT_STATUS_FORBIDDEN' : 'RECORD_ACCESS_FORBIDDEN');
    assert.doesNotMatch(JSON.stringify(response.body), /doctor-b symptoms|doctor-b diagnosis|doctor-b treatment|doctor-b notes/i);
  }
  const afterRecord = await prisma.medicalRecord.findUnique({ where: { id: record.id } });
  assert.equal(afterRecord.diagnosisEncrypted, before.diagnosisEncrypted);
  assert.equal(afterRecord.treatmentEncrypted, before.treatmentEncrypted);
  assert.equal((await prisma.appointment.findUnique({ where: { id: appointment.id } })).status, 'IN_CONSULTATION');
  assert.equal(await prisma.prescription.count({ where: { medicalRecordId: record.id } }), 0);
});

test('valid direct IDs do not bypass receptionist, lab, or pharmacist role boundaries', async () => {
  const appointment = await prisma.appointment.create({ data: {
    patientId: patient1.id, doctorId: doctor1.id,
    appointmentDate: '2063-04-04', appointmentTime: '12:00', status: 'IN_CONSULTATION'
  } });
  const record = await prisma.medicalRecord.create({ data: {
    patientId: patient1.id, doctorId: doctor1.id, appointmentId: appointment.id,
    symptomsEncrypted: '', diagnosisEncrypted: encrypt('boundary diagnosis'), treatmentEncrypted: '',
    clinicalNotesEncrypted: '', vitalSignsJson: '{}'
  } });
  const labOrder = await prisma.labOrder.create({ data: {
    medicalRecordId: record.id, patientId: patient1.id, doctorId: doctor1.id,
    status: 'SAMPLE_COLLECTED', items: { create: { serviceId: service.id } }
  }, include: { items: true } });
  const prescription = await prisma.prescription.create({ data: {
    medicalRecordId: record.id, patientId: patient1.id, doctorId: doctor1.id, status: 'ACTIVE',
    prescribedDrugs: { create: {
      drugId: drug.id,
      dosage: 'one',
      duration: 'one day',
      instructionsAr: '',
      instructionsEn: '',
      qtyPrescribed: 1
    } }
  }, include: { prescribedDrugs: true } });
  const staff = await prisma.user.findUnique({ where: { username: 'doctor_cardio@cms.com' } });
  const originalStaffStatus = staff.status;
  const originalDiagnosis = (await prisma.medicalRecord.findUnique({ where: { id: record.id } })).diagnosisEncrypted;

  const roleAttempts = {
    reception: [
      api.put(`/api/records/${record.id}/finalize`).set(auth('reception')).send({ diagnosis: 'x' }),
      api.put(`/api/records/lab-orders/items/${labOrder.items[0].id}/results`).set(auth('reception')).send({ expectedVersion: 0, resultValue: 'x' }),
      api.post(`/api/records/prescriptions/${prescription.id}/dispense`).set(auth('reception')).send({ items: [{ prescribedDrugId: prescription.prescribedDrugs[0].id, qtyToDispense: 1 }] }),
      api.put(`/api/auth/users/${staff.id}/status`).set(auth('reception')).send({ status: 'INACTIVE' })
    ],
    lab: [
      api.put(`/api/records/${record.id}/finalize`).set(auth('lab')).send({ diagnosis: 'x' }),
      api.post('/api/records').set(auth('lab')).send({ patientId: patient1.id, appointmentId: appointment.id, diagnosis: 'x' }),
      api.post(`/api/records/prescriptions/${prescription.id}/dispense`).set(auth('lab')).send({ items: [{ prescribedDrugId: prescription.prescribedDrugs[0].id, qtyToDispense: 1 }] }),
      api.post(`/api/pharmacy/formulary/${drug.id}/batches`).set(auth('lab')).send({ batchNumber: 'LAB-FORBIDDEN', expiryDate: '2065-01-01', receivedQuantity: 1, minReorderLevel: 0 }),
      api.put(`/api/auth/users/${staff.id}/status`).set(auth('lab')).send({ status: 'INACTIVE' })
    ],
    pharmacy: [
      api.put(`/api/records/${record.id}/finalize`).set(auth('pharmacy')).send({ diagnosis: 'x' }),
      api.put(`/api/records/lab-orders/items/${labOrder.items[0].id}/results`).set(auth('pharmacy')).send({ expectedVersion: 0, resultValue: 'x' }),
      api.put(`/api/appointments/${appointment.id}/status`).set(auth('pharmacy')).send({ status: 'COMPLETED' }),
      api.put(`/api/auth/users/${staff.id}/status`).set(auth('pharmacy')).send({ status: 'INACTIVE' })
    ]
  };
  for (const attempts of Object.values(roleAttempts)) {
    for (const pending of attempts) assertSafeAuthorizationDenial(await pending, 403);
  }
  assert.equal((await prisma.medicalRecord.findUnique({ where: { id: record.id } })).diagnosisEncrypted, originalDiagnosis);
  assert.equal((await prisma.labOrderItem.findUnique({ where: { id: labOrder.items[0].id } })).resultValue, null);
  assert.equal((await prisma.prescribedDrug.findUnique({ where: { id: prescription.prescribedDrugs[0].id } })).qtyDispensed, 0);
  assert.equal((await prisma.appointment.findUnique({ where: { id: appointment.id } })).status, 'IN_CONSULTATION');
  assert.equal((await prisma.user.findUnique({ where: { id: staff.id } })).status, originalStaffStatus);
});

test('staff creation strips account-security fields while MFA strict schema rejects them', async () => {
  const username = `mass-assignment-staff-${Date.now()}@example.test`;
  const password = 'MassAssignmentSecure1';
  const staffAttempt = await api.post('/api/auth/users').set(auth('admin')).send({
    username,
    password,
    role: 'RECEPTIONIST',
    status: 'INACTIVE',
    authVersion: 999,
    mfaEnabled: true,
    passwordHash: 'attacker-controlled-hash',
    mfaSecret: 'attacker-controlled-secret',
    emailVerifiedAt: '2000-01-01T00:00:00.000Z',
    createdBy: 'attacker-controlled-actor',
    updatedBy: 'attacker-controlled-actor'
  });
  assert.equal(staffAttempt.status, 201);
  const createdStaff = await prisma.user.findUnique({ where: { username } });
  assert.ok(createdStaff);
  assert.equal(createdStaff.role, 'RECEPTIONIST');
  assert.equal(createdStaff.status, 'ACTIVE');
  assert.equal(createdStaff.authVersion, 0);
  assert.equal(createdStaff.mfaEnabled, false);
  assert.notEqual(createdStaff.passwordHash, 'attacker-controlled-hash');
  assert.equal(await bcrypt.compare(password, createdStaff.passwordHash), true);
  assert.equal(createdStaff.emailVerifiedAt, null);
  assert.equal(await prisma.mfaConfiguration.count({ where: { userId: createdStaff.id } }), 0);
  const creationAudit = await prisma.tenantAuditLog.findFirst({
    where: { action: 'USER_CREATION', details: { contains: username } }
  });
  const adminUser = await prisma.user.findUnique({ where: { username: 'admin@cms.com' } });
  assert.ok(creationAudit);
  assert.equal(creationAudit.userId, adminUser.id);
  assert.equal(creationAudit.details.includes('attacker-controlled-actor'), false);
  assert.equal(JSON.stringify(staffAttempt.body).includes('attacker-controlled'), false);

  const statusTarget = await prisma.user.create({ data: {
    username: `mass-assignment-status-${Date.now()}@example.test`,
    passwordHash: await bcrypt.hash('MassAssignmentStatus1', 10),
    role: 'RECEPTIONIST',
    status: 'ACTIVE'
  } });
  assert.equal(statusTarget.authVersion, 0);
  const statusAttempt = await api.put(`/api/auth/users/${statusTarget.id}/status`).set(auth('admin')).send({
    status: 'INACTIVE',
    role: 'ADMIN',
    authVersion: 999,
    mfaEnabled: true,
    passwordHash: 'attacker-controlled-hash',
    updatedBy: 'attacker-controlled-actor'
  });
  assert.equal(statusAttempt.status, 200);
  const statusPersisted = await prisma.user.findUnique({ where: { id: statusTarget.id } });
  assert.equal(statusPersisted.status, 'INACTIVE');
  assert.equal(statusPersisted.role, 'RECEPTIONIST');
  assert.equal(statusPersisted.authVersion, statusTarget.authVersion + 1);
  assert.notEqual(statusPersisted.authVersion, 999);
  assert.equal(statusPersisted.mfaEnabled, false);
  assert.equal(statusPersisted.passwordHash, statusTarget.passwordHash);
  const statusAudits = await prisma.tenantAuditLog.findMany({
    where: { action: 'USER_STATUS_CHANGE', details: { contains: statusTarget.username } }
  });
  assert.equal(statusAudits.length, 1);
  assert.equal(statusAudits[0].userId, adminUser.id);
  assert.equal(statusAudits[0].details.includes('attacker-controlled-actor'), false);

  const doctorUser = await prisma.user.findUnique({ where: { username: 'doctor@cms.com' } });
  const before = await prisma.user.findUnique({ where: { id: doctorUser.id } });
  const mfaSecretMarker = `FAKE-MFA-SECRET-${Date.now()}-${++fixtureCounter}`;
  const passwordHashMarker = `FAKE-PASSWORD-HASH-${Date.now()}-${++fixtureCounter}`;
  const actorMarker = `FAKE-ACTOR-${Date.now()}-${++fixtureCounter}`;
  const recoveryCodeMarker = `FAKE-RECOVERY-${Date.now()}`;
  const totpMarker = '482731';
  const currentPasswordMarker = 'Doctor@123';
  const mfaAttempt = await api.post('/api/auth/mfa/enroll').set(auth('doctor')).send({
    currentPassword: currentPasswordMarker,
    role: 'ADMIN',
    status: 'INACTIVE',
    authVersion: 999,
    mfaEnabled: true,
    mfaSecret: mfaSecretMarker,
    passwordHash: passwordHashMarker,
    actorUserId: actorMarker,
    recoveryCode: recoveryCodeMarker,
    totpCode: totpMarker
  });
  assertSafeValidationError(mfaAttempt, [
    mfaSecretMarker,
    passwordHashMarker,
    actorMarker,
    recoveryCodeMarker,
    totpMarker,
    currentPasswordMarker
  ]);
  const after = await prisma.user.findUnique({ where: { id: doctorUser.id } });
  assert.deepEqual(
    { role: after.role, status: after.status, authVersion: after.authVersion, mfaEnabled: after.mfaEnabled },
    { role: before.role, status: before.status, authVersion: before.authVersion, mfaEnabled: before.mfaEnabled }
  );
  assert.equal((await prisma.user.findUnique({ where: { id: statusTarget.id } })).authVersion, statusTarget.authVersion + 1);
  assert.equal(await prisma.mfaConfiguration.count({ where: { userId: doctorUser.id } }), 0);
});

test('patient booking and rescheduling derive identity and workflow fields on the server', async () => {
  const actor = await createAppointmentConcurrencyPatient();
  const victim = await createAppointmentConcurrencyPatient();
  const patientAuth = { Authorization: `Bearer ${actor.token}` };
  const firstSlot = await findAvailableAppointmentSlot(doctor1.id);
  const booked = await api.post('/api/patient/appointments').set(patientAuth).send({
    ...firstSlot,
    patientId: victim.patient.id,
    appointmentId: '00000000-0000-4000-8000-000000000077',
    status: 'COMPLETED',
    queuePosition: -999,
    unitPriceSdg: 1,
    paymentStatus: 'PAID',
    actorUserId: victim.user.id
  });
  assert.equal(booked.status, 201);
  const created = await prisma.appointment.findUnique({ where: { id: booked.body.id } });
  assert.equal(created.patientId, actor.patient.id);
  assert.equal(created.doctorId, firstSlot.doctorId);
  assert.equal(created.status, 'PENDING');

  const walkInSlot = await findTodayWalkInSlot(doctor1.id);
  const beforeWalkIns = await prisma.appointment.count({ where: {
    patientId: victim.patient.id,
    appointmentDate: getClinicDateString()
  } });
  const walkInAttempt = await api.post('/api/appointments/walk-in').set(auth('reception')).send({
    mode: 'EXISTING',
    patientId: victim.patient.id,
    doctorId: doctor1.id,
    appointmentDate: getClinicDateString(),
    appointmentTime: walkInSlot,
    status: 'COMPLETED',
    queuePosition: -999,
    paymentStatus: 'PAID',
    actorUserId: victim.user.id
  });
  assertSafeAuthorizationDenial(walkInAttempt, 422);
  assert.equal(await prisma.appointment.count({ where: {
    patientId: victim.patient.id,
    appointmentDate: getClinicDateString()
  } }), beforeWalkIns);

  const secondSlot = await findAvailableAppointmentSlot(doctor2.id);
  const rescheduled = await api.put(`/api/patient/appointments/${created.id}/reschedule`).set(patientAuth).send({
    ...secondSlot,
    patientId: victim.patient.id,
    appointmentId: victim.user.id,
    status: 'COMPLETED',
    paymentStatus: 'PAID',
    updatedBy: victim.user.id
  });
  assert.equal(rescheduled.status, 200);
  const persisted = await prisma.appointment.findUnique({ where: { id: created.id } });
  assert.equal(persisted.patientId, actor.patient.id);
  assert.equal(persisted.doctorId, secondSlot.doctorId);
  assert.equal(persisted.status, 'PENDING');
});

test('clinical submission and finalization ignore hidden ownership and actor fields', async () => {
  const appointment = await createAuthorityTestAppointment();
  const submitted = await api.post('/api/records').set(auth('doctor')).send({
    patientId: patient1.id,
    appointmentId: appointment.id,
    diagnosis: 'Mass-assignment protected diagnosis',
    doctorId: doctor2.id,
    status: 'FINALIZED',
    appointmentStatus: 'CANCELLED',
    recordOwnerId: doctor2.id,
    createdBy: doctor2.userId,
    actorUserId: doctor2.userId,
    finalizedAt: '2000-01-01T00:00:00.000Z'
  });
  assert.equal(submitted.status, 201);
  const submittedRecord = await prisma.medicalRecord.findUnique({ where: { id: submitted.body.recordId } });
  assert.equal(submittedRecord.patientId, patient1.id);
  assert.equal(submittedRecord.doctorId, doctor1.id);
  assert.equal((await prisma.appointment.findUnique({ where: { id: appointment.id } })).status, 'COMPLETED');

  const finalizeAppointment = await createAuthorityTestAppointment();
  const record = await prisma.medicalRecord.create({ data: {
    patientId: patient1.id, doctorId: doctor1.id, appointmentId: finalizeAppointment.id,
    symptomsEncrypted: '', diagnosisEncrypted: encrypt('before finalize'), treatmentEncrypted: '',
    clinicalNotesEncrypted: '', vitalSignsJson: '{}'
  } });
  const finalized = await api.put(`/api/records/${record.id}/finalize`).set(auth('doctor')).send({
    diagnosis: 'After legitimate finalize',
    treatment: 'Server-owned context preserved',
    vitalSigns: {},
    doctorId: doctor2.id,
    patientId: patient2.id,
    appointmentId: unrelatedAppointment.id,
    status: 'CANCELLED',
    actorUserId: doctor2.userId,
    updatedBy: doctor2.userId
  });
  assert.equal(finalized.status, 200);
  const persisted = await prisma.medicalRecord.findUnique({ where: { id: record.id } });
  assert.equal(persisted.patientId, patient1.id);
  assert.equal(persisted.doctorId, doctor1.id);
  assert.equal(persisted.appointmentId, finalizeAppointment.id);
  assert.equal((await prisma.appointment.findUnique({ where: { id: finalizeAppointment.id } })).status, 'COMPLETED');
  assert.equal((await prisma.appointment.findUnique({ where: { id: unrelatedAppointment.id } })).status, 'IN_CONSULTATION');
});

test('lab result CAS ignores hidden release, workflow, version, and actor fields', async () => {
  const fixture = await createResultConcurrencyFixture(2);
  const item = fixture.order.items[0];
  const response = await api.put(`/api/records/lab-orders/items/${item.id}/results`).set(auth('lab')).send({
    expectedVersion: 0,
    resultValue: 'Legitimate laboratory value',
    resultVersion: 999,
    status: 'COMPLETED',
    labOrderStatus: 'COMPLETED',
    labOrderItemStatus: 'RELEASED',
    releasedToPatientAt: '2000-01-01T00:00:00.000Z',
    appointmentStatus: 'COMPLETED',
    actorUserId: '00000000-0000-4000-8000-000000000088',
    updatedBy: '00000000-0000-4000-8000-000000000088'
  });
  assert.equal(response.status, 200);
  const [storedItem, storedOrder, storedAppointment] = await Promise.all([
    prisma.labOrderItem.findUnique({ where: { id: item.id } }),
    prisma.labOrder.findUnique({ where: { id: fixture.order.id } }),
    prisma.appointment.findUnique({ where: { id: fixture.appointment.id } })
  ]);
  assert.equal(storedItem.resultValue, 'Legitimate laboratory value');
  assert.equal(storedItem.resultVersion, 1);
  assert.equal(storedOrder.status, 'SAMPLE_COLLECTED');
  assert.equal(storedOrder.releasedToPatientAt, null);
  assert.equal(storedAppointment.status, 'WAITING_LAB');
});

test('patient profile writes strip identity, verification, role, and financial fields', async () => {
  const actor = await createAppointmentConcurrencyPatient();
  const victim = await createAppointmentConcurrencyPatient();
  const beforeUser = await prisma.user.findUnique({ where: { id: actor.user.id } });
  const response = await api.patch('/api/patient/me')
    .set({ Authorization: `Bearer ${actor.token}` })
    .send({
      emergencyContact: 'Mass Assignment Test Contact',
      patientId: victim.patient.id,
      userId: victim.user.id,
      doctorId: doctor2.id,
      role: 'ADMIN',
      status: 'INACTIVE',
      emailVerifiedAt: '2000-01-01T00:00:00.000Z',
      authVersion: 999,
      mfaEnabled: true,
      invoiceStatus: 'PAID',
      paymentStatus: 'PAID'
    });
  assert.equal(response.status, 200);
  const [afterPatient, afterUser, victimPatient] = await Promise.all([
    prisma.patient.findUnique({ where: { id: actor.patient.id } }),
    prisma.user.findUnique({ where: { id: actor.user.id } }),
    prisma.patient.findUnique({ where: { id: victim.patient.id } })
  ]);
  assert.equal(afterPatient.emergencyContact, 'Mass Assignment Test Contact');
  assert.equal(afterPatient.userId, actor.user.id);
  assert.equal(victimPatient.userId, victim.user.id);
  assert.deepEqual(
    { role: afterUser.role, status: afterUser.status, authVersion: afterUser.authVersion, mfaEnabled: afterUser.mfaEnabled, emailVerifiedAt: afterUser.emailVerifiedAt },
    { role: beforeUser.role, status: beforeUser.status, authVersion: beforeUser.authVersion, mfaEnabled: beforeUser.mfaEnabled, emailVerifiedAt: beforeUser.emailVerifiedAt }
  );
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

test('completed visits remain readable but reject every doctor clinical write', async () => {
  const appointment = await prisma.appointment.create({
    data: {
      patientId: patient1.id,
      doctorId: doctor1.id,
      appointmentDate: '2030-01-07',
      appointmentTime: '09:30',
      status: 'COMPLETED'
    }
  });
  const record = await prisma.medicalRecord.create({
    data: {
      patientId: patient1.id,
      doctorId: doctor1.id,
      appointmentId: appointment.id,
      symptomsEncrypted: encrypt('completed symptoms'),
      diagnosisEncrypted: encrypt('completed diagnosis'),
      treatmentEncrypted: encrypt('completed treatment'),
      clinicalNotesEncrypted: encrypt('completed notes'),
      vitalSignsJson: JSON.stringify({ blood_pressure: '120/80' })
    }
  });

  const summary = await api.get(`/api/records/${appointment.id}/summary`).set(auth('doctor'));
  assert.equal(summary.status, 200);
  assert.equal(summary.body.diagnosis, 'completed diagnosis');

  const rejectedCreate = await api.post('/api/records').set(auth('doctor')).send({
    patientId: patient1.id,
    appointmentId: appointment.id,
    diagnosis: 'attempted overwrite',
    prescribedDrugs: [{ drugId: drug.id, dosage: '1', duration: '1 day', qtyPrescribed: 1 }],
    orderedServices: [service.id]
  });
  assert.equal(rejectedCreate.status, 409);
  assert.equal(rejectedCreate.body.error.code, 'VISIT_ALREADY_COMPLETED');

  const rejectedFinalize = await api.put(`/api/records/${record.id}/finalize`).set(auth('doctor')).send({
    diagnosis: 'attempted finalize', treatment: 'attempted treatment', vitalSigns: {}
  });
  assert.equal(rejectedFinalize.status, 409);
  assert.equal(rejectedFinalize.body.error.code, 'VISIT_ALREADY_COMPLETED');

  const unchanged = await prisma.medicalRecord.findUnique({ where: { id: record.id } });
  assert.equal(decrypt(unchanged.diagnosisEncrypted), 'completed diagnosis');
  assert.equal(decrypt(unchanged.treatmentEncrypted), 'completed treatment');
  assert.equal(await prisma.appointment.findUnique({ where: { id: appointment.id } }).then((row) => row.status), 'COMPLETED');
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

test('automatic pharmacy billing remains pending while medication review is pending', async () => {
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
  const paymentState = await api
    .get(`/api/pharmacy/prescriptions/${fixture.rx.id}/payment-state`)
    .set(auth('pharmacy'));
  assert.equal(paymentState.status, 200);
  assert.equal(paymentState.body.invoice, null);
  assert.equal(paymentState.body.billingPending.code, 'PHARMACY_INVOICE_PENDING');
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

  assert.equal(billing.status, 200);
  assert.equal(billing.body.existing, true);

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
  assert.equal(billing.status, 200);
  assert.equal(billing.body.existing, true);

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

function pharmacyMedicinePayload(suffix, extra = {}) {
  return {
    brandName: `API Brand ${suffix}`,
    labelAr: `دواء واجهة ${suffix}`,
    labelEn: `API Medicine ${suffix}`,
    genericName: `API Generic ${suffix}`,
    strength: '30 mg',
    dosageForm: 'Tablet',
    ...extra
  };
}

test('pharmacy formulary creation is pharmacist-only, strict, inactive, and unpriced', async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const payload = pharmacyMedicinePayload(suffix);
  for (const role of ['admin', 'reception', 'doctor', 'lab']) {
    assert.equal((await api.post('/api/pharmacy/formulary').set(auth(role)).send(payload)).status, 403);
  }
  assert.equal((await api.post('/api/pharmacy/formulary').send(payload)).status, 401);
  const patientUser = await prisma.user.create({
    data: {
      username: `pharmacy-api-patient-${suffix}@example.test`,
      passwordHash: await bcrypt.hash('SyntheticPass123', 10),
      role: 'PATIENT',
      status: 'ACTIVE'
    }
  });
  pharmacyApiPatientToken = signAccessToken({
    id: patientUser.id,
    username: patientUser.username,
    role: patientUser.role,
    authVersion: patientUser.authVersion
  });
  assert.equal((await api.post('/api/pharmacy/formulary')
    .set({ Authorization: `Bearer ${pharmacyApiPatientToken}` }).send(payload)).status, 403);
  for (const injected of [
    { status: 'ACTIVE' }, { unitPriceSdg: 1 }, { identityKey: 'forged' },
    { actorUserId: '10000000-0000-4000-8000-000000000001' }, { ledgerVersion: 0 }
  ]) {
    const response = await api.post('/api/pharmacy/formulary').set(auth('pharmacy')).send({ ...payload, ...injected });
    assert.equal(response.status, 422);
  }
  const created = await api.post('/api/pharmacy/formulary').set(auth('pharmacy')).send(payload);
  assert.equal(created.status, 201);
  assert.equal(created.body.medicine.status, 'INACTIVE');
  assert.equal(created.body.medicine.unitPriceSdg, null);
  assert.equal(created.body.medicine.stock.totalStock, 0);
  assert.equal(Object.hasOwn(created.body.medicine, 'identityKey'), false);
  const stored = await prisma.drugFormulary.findUnique({ where: { id: created.body.medicine.id } });
  assert.equal(stored.identityKey, buildMedicineIdentityKey(payload));
});

test('pharmacy medicine creation with initial stock is atomic and ledger-backed', async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const payload = pharmacyMedicinePayload(suffix, {
    initialBatch: { batchNumber: `INIT-${suffix}`, expiryDate: '2035-05-01', qtyOnHand: 12, minReorderLevel: 3 }
  });
  const response = await api.post('/api/pharmacy/formulary').set(auth('pharmacy')).send(payload);
  assert.equal(response.status, 201);
  const medicineId = response.body.medicine.id;
  const batch = await prisma.inventoryBatch.findFirst({ where: { drugId: medicineId } });
  const movement = await prisma.stockMovement.findFirst({ where: { inventoryBatchId: batch.id } });
  const pharmacist = await prisma.user.findUnique({ where: { username: 'pharma@cms.com' } });
  assert.equal(batch.qtyOnHand, 12);
  assert.equal(movement.movementType, 'RECEIPT');
  assert.equal(movement.quantityDelta, 12);
  assert.equal(movement.resultingBalance, 12);
  assert.equal(movement.actorUserId, pharmacist.id);
  assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'FORMULARY_MEDICINE_CREATED', details: { contains: medicineId } } }), 1);
});

test('medicine creation movement and audit failures roll back all state', async () => {
  for (const failure of ['movement', 'audit']) {
    const suffix = `${failure}-${Date.now()}-${Math.random()}`;
    const payload = pharmacyMedicinePayload(suffix, {
      initialBatch: { batchNumber: `ROLL-${suffix}`, expiryDate: '2035-06-01', qtyOnHand: 7, minReorderLevel: 1 }
    });
    const functionName = `fail_phase2_${failure}`;
    const table = failure === 'movement' ? 'StockMovement' : 'TenantAuditLog';
    const condition = failure === 'movement'
      ? `NEW."referenceType" = 'FORMULARY_INITIAL_BATCH'`
      : `NEW."action" = 'FORMULARY_MEDICINE_CREATED'`;
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${functionName}() RETURNS trigger AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'forced phase2 ${failure} failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${functionName}_trigger BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
    try {
      const response = await api.post('/api/pharmacy/formulary').set(auth('pharmacy')).send(payload);
      assert.equal(response.status, 500);
      assert.equal(await prisma.drugFormulary.count({ where: { identityKey: buildMedicineIdentityKey(payload) } }), 0);
      assert.equal(await prisma.inventoryBatch.count({ where: { batchNumber: payload.initialBatch.batchNumber } }), 0);
      assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'FORMULARY_MEDICINE_CREATED', details: { contains: suffix } } }), 0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${functionName}_trigger ON "${table}"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${functionName}()`);
    }
  }
});

test('equivalent and concurrent proactive medicine duplicates return deterministic conflict', async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const canonical = pharmacyMedicinePayload(suffix);
  const variant = { ...canonical, brandName: `  ${canonical.brandName.toUpperCase()}  `, genericName: canonical.genericName.toUpperCase() };
  assert.equal((await api.post('/api/pharmacy/formulary').set(auth('pharmacy')).send(canonical)).status, 201);
  const duplicate = await api.post('/api/pharmacy/formulary').set(auth('pharmacy')).send(variant);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, 'FORMULARY_MEDICINE_ALREADY_EXISTS');

  const concurrentSuffix = `concurrent-${Date.now()}-${Math.random()}`;
  const concurrent = pharmacyMedicinePayload(concurrentSuffix);
  const responses = await Promise.all([
    api.post('/api/pharmacy/formulary').set(auth('pharmacy')).send(concurrent),
    api.post('/api/pharmacy/formulary').set(auth('pharmacy')).send({ ...concurrent, dosageForm: ' TABLET ' })
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal(responses.find((response) => response.status === 409).body.error.code, 'FORMULARY_MEDICINE_ALREADY_EXISTS');
  assert.equal(await prisma.drugFormulary.count({ where: { identityKey: buildMedicineIdentityKey(concurrent) } }), 1);
});

test('pharmacist batch receipt is strict, allows inactive medicine, and creates receipt ledger', async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const created = await api.post('/api/pharmacy/formulary').set(auth('pharmacy')).send(pharmacyMedicinePayload(suffix));
  const medicineId = created.body.medicine.id;
  for (const role of ['admin', 'reception', 'doctor', 'lab']) {
    assert.equal((await api.post(`/api/pharmacy/formulary/${medicineId}/batches`).set(auth(role)).send({
      batchNumber: 'NOPE', expiryDate: '2035-01-01', receivedQuantity: 1
    })).status, 403);
  }
  for (const expiryDate of ['2026-02-30', getClinicDateString(), '2020-01-01']) {
    assert.equal((await api.post(`/api/pharmacy/formulary/${medicineId}/batches`).set(auth('pharmacy')).send({
      batchNumber: `BAD-${expiryDate}`, expiryDate, receivedQuantity: 1
    })).status, 422);
  }
  const response = await api.post(`/api/pharmacy/formulary/${medicineId}/batches`).set(auth('pharmacy')).send({
    batchNumber: ` Receipt  ${suffix} `, expiryDate: '2036-01-01', receivedQuantity: 9, minReorderLevel: 2
  });
  assert.equal(response.status, 201);
  const batch = await prisma.inventoryBatch.findUnique({ where: { id: response.body.batch.id } });
  const movement = await prisma.stockMovement.findFirst({ where: { inventoryBatchId: batch.id } });
  assert.equal(movement.movementType, 'RECEIPT');
  assert.equal(movement.quantityDelta, 9);
  assert.equal(movement.resultingBalance, 9);
  assert.ok(movement.actorUserId);
  assert.equal(batch.normalizedBatchNumber, normalizeBatchNumber(` Receipt  ${suffix} `));
});

test('duplicate and concurrent batch intake create exactly one lot', async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const created = await api.post('/api/pharmacy/formulary').set(auth('pharmacy')).send(pharmacyMedicinePayload(suffix));
  const url = `/api/pharmacy/formulary/${created.body.medicine.id}/batches`;
  const payload = { batchNumber: `LOT-${suffix}`, expiryDate: '2037-01-01', receivedQuantity: 5, minReorderLevel: 1 };
  assert.equal((await api.post(url).set(auth('pharmacy')).send(payload)).status, 201);
  const duplicate = await api.post(url).set(auth('pharmacy')).send({ ...payload, batchNumber: ` lot-${suffix} ` });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, 'INVENTORY_BATCH_ALREADY_EXISTS');

  const secondPayload = { ...payload, batchNumber: `CON-${suffix}`, expiryDate: '2038-01-01' };
  const responses = await Promise.all([
    api.post(url).set(auth('pharmacy')).send(secondPayload),
    api.post(url).set(auth('pharmacy')).send({ ...secondPayload, batchNumber: ` con-${suffix} ` })
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal(await prisma.inventoryBatch.count({ where: {
    drugId: created.body.medicine.id,
    normalizedBatchNumber: normalizeBatchNumber(secondPayload.batchNumber),
    expiryDate: secondPayload.expiryDate
  } }), 1);
});

test('metadata editing recomputes pre-use identity and freezes used identity while allowing labels', async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const created = await api.post('/api/pharmacy/formulary').set(auth('pharmacy')).send(pharmacyMedicinePayload(suffix));
  const id = created.body.medicine.id;
  const edited = await api.patch(`/api/pharmacy/formulary/${id}/metadata`).set(auth('pharmacy')).send({
    brandName: `Corrected Brand ${suffix}`
  });
  assert.equal(edited.status, 200);
  const preUse = await prisma.drugFormulary.findUnique({ where: { id } });
  assert.equal(preUse.identityKey, buildMedicineIdentityKey(preUse));

  assert.equal((await api.post(`/api/pharmacy/formulary/${id}/batches`).set(auth('pharmacy')).send({
    batchNumber: `USED-${suffix}`, expiryDate: '2039-01-01', receivedQuantity: 3
  })).status, 201);
  const blocked = await api.patch(`/api/pharmacy/formulary/${id}/metadata`).set(auth('pharmacy')).send({ strength: '60 mg' });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, 'FORMULARY_IDENTITY_IMMUTABLE');
  for (const forbidden of [{ status: 'ACTIVE' }, { unitPriceSdg: 20 }, { identityKey: 'forged' }, { qtyOnHand: 0 }]) {
    assert.equal((await api.patch(`/api/pharmacy/formulary/${id}/metadata`).set(auth('pharmacy')).send(forbidden)).status, 422);
  }
  const label = await api.patch(`/api/pharmacy/formulary/${id}/metadata`).set(auth('pharmacy')).send({ labelEn: `Corrected Label ${suffix}` });
  assert.equal(label.status, 200);
  const metadataAudits = await prisma.tenantAuditLog.findMany({ where: {
    action: 'FORMULARY_METADATA_UPDATED', details: { contains: id }
  } });
  assert.equal(metadataAudits.length, 2);
  const labelAudit = metadataAudits.map((entry) => JSON.parse(entry.details))
    .find((details) => details.changedFields.includes('labelEn'));
  assert.equal(labelAudit.changes.labelEn.before, created.body.medicine.labelEn);
  assert.equal(labelAudit.changes.labelEn.after, `Corrected Label ${suffix}`);
});

test('metadata identity collision returns deterministic conflict', async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const firstPayload = pharmacyMedicinePayload(`first-${suffix}`);
  const secondPayload = pharmacyMedicinePayload(`second-${suffix}`);
  const first = await api.post('/api/pharmacy/formulary').set(auth('pharmacy')).send(firstPayload);
  const second = await api.post('/api/pharmacy/formulary').set(auth('pharmacy')).send(secondPayload);
  const response = await api.patch(`/api/pharmacy/formulary/${second.body.medicine.id}/metadata`)
    .set(auth('pharmacy')).send({
      brandName: firstPayload.brandName,
      genericName: firstPayload.genericName,
      strength: firstPayload.strength,
      dosageForm: firstPayload.dosageForm
    });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'FORMULARY_MEDICINE_ALREADY_EXISTS');
});

test('batch and metadata audit failures roll back their mutations', async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const created = await api.post('/api/pharmacy/formulary').set(auth('pharmacy')).send(pharmacyMedicinePayload(suffix));
  const id = created.body.medicine.id;
  for (const action of ['INVENTORY_BATCH_RECEIVED', 'FORMULARY_METADATA_UPDATED']) {
    const functionName = `fail_phase2_audit_${action.toLowerCase()}`;
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${functionName}() RETURNS trigger AS $$ BEGIN IF NEW."action" = '${action}' THEN RAISE EXCEPTION 'forced phase2 audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${functionName}_trigger BEFORE INSERT ON "TenantAuditLog" FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
    try {
      if (action === 'INVENTORY_BATCH_RECEIVED') {
        const response = await api.post(`/api/pharmacy/formulary/${id}/batches`).set(auth('pharmacy')).send({
          batchNumber: `AUDIT-${suffix}`, expiryDate: '2038-06-01', receivedQuantity: 4
        });
        assert.equal(response.status, 500);
        assert.equal(await prisma.inventoryBatch.count({ where: {
          drugId: id, normalizedBatchNumber: normalizeBatchNumber(`AUDIT-${suffix}`)
        } }), 0);
        assert.equal(await prisma.stockMovement.count({ where: { drugId: id } }), 0);
      } else {
        const before = await prisma.drugFormulary.findUnique({ where: { id } });
        const response = await api.patch(`/api/pharmacy/formulary/${id}/metadata`).set(auth('pharmacy')).send({
          labelEn: `Rolled Back Label ${suffix}`
        });
        assert.equal(response.status, 500);
        assert.equal((await prisma.drugFormulary.findUnique({ where: { id } })).labelEn, before.labelEn);
      }
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${functionName}_trigger ON "TenantAuditLog"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${functionName}()`);
    }
  }
});

test('formulary, batch, and movement views are bounded, operational, and admin-readable', async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const created = await api.post('/api/pharmacy/formulary').set(auth('pharmacy')).send(pharmacyMedicinePayload(suffix, {
    initialBatch: { batchNumber: `VIEW-${suffix}`, expiryDate: '2035-01-01', qtyOnHand: 2, minReorderLevel: 5 }
  }));
  const id = created.body.medicine.id;
  const expiredBatch = await prisma.inventoryBatch.create({ data: {
    drugId: id,
    batchNumber: `EXPIRED-${suffix}`,
    normalizedBatchNumber: normalizeBatchNumber(`EXPIRED-${suffix}`),
    expiryDate: '2020-01-01',
    qtyOnHand: 3,
    minReorderLevel: 1
  } });
  await prisma.stockMovement.create({ data: {
    drugId: id,
    inventoryBatchId: expiredBatch.id,
    movementType: 'OPENING_BALANCE',
    quantityDelta: 3,
    resultingBalance: 3,
    actorUserId: null,
    referenceType: 'TEST_LEGACY_OPENING_BALANCE',
    referenceId: expiredBatch.id
  } });
  for (const role of ['pharmacy', 'admin']) {
    const list = await api.get(`/api/pharmacy/formulary?search=${encodeURIComponent(suffix)}&page=1&pageSize=5`).set(auth(role));
    assert.equal(list.status, 200);
    assert.equal(list.body.items.length, 1);
    assert.equal(list.body.items[0].stock.totalStock, 5);
    assert.equal(list.body.items[0].stock.totalOnHand, 5);
    assert.equal(list.body.items[0].stock.usableStock, 2);
    assert.equal(list.body.items[0].stock.expiredStock, 3);
    assert.equal(list.body.items[0].stock.hasExpiredBatch, true);
    assert.equal(list.body.items[0].stock.expiredBatchCount, 1);
    assert.equal(list.body.items[0].stock.nearestExpiry, '2035-01-01');
    assert.equal(list.body.items[0].stock.nearestUnexpiredExpiry, '2035-01-01');
    assert.equal(list.body.items[0].stock.lowStock, true);
    assert.equal(list.body.items[0].stock.lowStockBatchCount, 1);
    assert.equal(Object.hasOwn(list.body.items[0], 'identityKey'), false);
    assert.equal((await api.get(`/api/pharmacy/formulary/${id}`).set(auth(role))).status, 200);
    const batches = await api.get(`/api/pharmacy/formulary/${id}/batches?page=1&pageSize=5`).set(auth(role));
    assert.equal(batches.status, 200);
    assert.equal(batches.body.items[0].expiryDate, '2035-01-01');
    assert.equal(batches.body.items[1].state.expired, true);
    const movements = await api.get(`/api/pharmacy/formulary/${id}/movements?page=1&pageSize=5`).set(auth(role));
    assert.equal(movements.status, 200);
    assert.equal(movements.body.items.length, 2);
    assert.ok(movements.body.items.every((movement) => movement.inventoryBatchId));
  }
  for (const role of ['reception', 'doctor', 'lab']) {
    assert.equal((await api.get('/api/pharmacy/formulary').set(auth(role))).status, 403);
  }
  assert.equal((await api.get('/api/pharmacy/formulary')
    .set({ Authorization: `Bearer ${pharmacyApiPatientToken}` })).status, 403);
  assert.equal((await api.get('/api/pharmacy/formulary?pageSize=101').set(auth('pharmacy'))).status, 422);
  assert.equal((await api.get(`/api/pharmacy/formulary/${id}/movements?page=0`).set(auth('pharmacy'))).status, 422);
  assert.equal((await api.patch(`/api/pharmacy/formulary/${id}/movements`).set(auth('pharmacy')).send({})).status, 404);
  assert.equal((await api.delete(`/api/pharmacy/formulary/${id}/movements`).set(auth('pharmacy'))).status, 404);
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
  assert.doesNotMatch(JSON.stringify(loser.body), /Prisma|PrismaClient|P20\d{2}|SQL|constraint|stack|database|transaction/i);
  const contestedStored = await prisma.labOrderItem.findUnique({ where: { id: contested.id } });
  assert.equal(contestedStored.resultVersion, 1);
  assert.equal(contestedStored.resultValue, winner.body.resultValue);
  const contestedAudits = await prisma.tenantAuditLog.findMany({
    where: { action: 'LAB_RESULTS_LOGGED', details: { contains: contested.id } }
  });
  assert.equal(contestedAudits.length, 1);
  assert.equal(JSON.parse(contestedAudits[0].details).resultVersion, 1);

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

test('simultaneous laboratory release is idempotent and audited once', async () => {
  const fixture = await createResultConcurrencyFixture(1);
  const item = fixture.order.items[0];
  const result = await api.put(`/api/records/lab-orders/items/${item.id}/results`)
    .set(auth('lab')).send({ expectedVersion: 0, resultValue: 'release-ready' });
  assert.equal(result.status, 200);

  const [releaseA, releaseB] = await Promise.all([
    api.put(`/api/records/lab-orders/${fixture.order.id}/release`).set(auth('lab')),
    api.put(`/api/records/lab-orders/${fixture.order.id}/release`).set(auth('lab'))
  ]);
  assert.ok([200].includes(releaseA.status));
  assert.ok([200].includes(releaseB.status));
  const persisted = await prisma.labOrder.findUnique({ where: { id: fixture.order.id } });
  assert.ok(persisted.releasedToPatientAt);
  const releaseAudits = await prisma.tenantAuditLog.findMany({
    where: { action: 'LAB_RESULTS_RELEASED_TO_PATIENT', details: { contains: fixture.order.id } }
  });
  assert.equal(releaseAudits.length, 1);
  const unchanged = await prisma.labOrderItem.findUnique({ where: { id: item.id } });
  assert.equal(unchanged.resultValue, 'release-ready');
  assert.equal(unchanged.resultVersion, 1);
});

test('multi-item laboratory order completes only after every required result commits', async () => {
  const fixture = await createResultConcurrencyFixture(2);
  const [itemA, itemB] = fixture.order.items;
  const first = await api.put(`/api/records/lab-orders/items/${itemA.id}/results`)
    .set(auth('lab')).send({ expectedVersion: 0, resultValue: 'first-result' });
  assert.equal(first.status, 200);
  const interim = await prisma.labOrder.findUnique({ where: { id: fixture.order.id } });
  assert.equal(interim.status, 'SAMPLE_COLLECTED');
  assert.equal((await prisma.appointment.findUnique({ where: { id: fixture.appointment.id } })).status, 'WAITING_LAB');

  const second = await api.put(`/api/records/lab-orders/items/${itemB.id}/results`)
    .set(auth('lab')).send({ expectedVersion: 0, resultValue: 'second-result' });
  assert.equal(second.status, 200);
  const [storedA, storedB, completed, appointment] = await Promise.all([
    prisma.labOrderItem.findUnique({ where: { id: itemA.id } }),
    prisma.labOrderItem.findUnique({ where: { id: itemB.id } }),
    prisma.labOrder.findUnique({ where: { id: fixture.order.id } }),
    prisma.appointment.findUnique({ where: { id: fixture.appointment.id } })
  ]);
  assert.deepEqual([storedA.resultValue, storedB.resultValue], ['first-result', 'second-result']);
  assert.deepEqual([storedA.resultVersion, storedB.resultVersion], [1, 1]);
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(appointment.status, 'IN_CONSULTATION');
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

test('concurrent same-item dispensing never exceeds the prescribed quantity', async () => {
  const fixture = await createPrescriptionFixture({ earlyQty: 6, lateQty: 0, qtyPrescribed: 6 });
  const requestDispense = () => api.post(`/api/records/prescriptions/${fixture.rx.id}/dispense`)
    .set(auth('pharmacy')).send({ items: [{ prescribedDrugId: fixture.item.id, qtyToDispense: 6 }] });
  const responses = await Promise.all([requestDispense(), requestDispense()]);
  assert.equal(responses.filter((response) => response.status === 200).length, 1);
  assert.equal(responses.filter((response) => response.status !== 200).length, 1);
  const losing = responses.find((response) => response.status !== 200);
  assert.doesNotMatch(JSON.stringify(losing.body), /Prisma|P2002|constraint|stack|SQL|database/i);
  const item = await prisma.prescribedDrug.findUnique({ where: { id: fixture.item.id } });
  const batch = await prisma.inventoryBatch.findUnique({ where: { id: fixture.early.id } });
  const movements = await prisma.stockMovement.findMany({ where: { referenceId: fixture.item.id, referenceType: 'PRESCRIBED_DRUG_DISPENSE' } });
  assert.equal(item.qtyDispensed, 6);
  assert.ok(item.qtyDispensed <= item.qtyPrescribed);
  assert.equal(batch.qtyOnHand, 0);
  assert.equal(movements.length, 1);
  assert.equal(movements[0].quantityDelta, -6);
  assert.ok(batch.qtyOnHand >= 0);
});

test('concurrent dispensing against final stock leaves no partial losing transaction', async () => {
  const fixture = await createPrescriptionFixture({ earlyQty: 5, lateQty: 0, qtyPrescribed: 5 });
  const responses = await Promise.all([
    api.post(`/api/records/prescriptions/${fixture.rx.id}/dispense`).set(auth('pharmacy')).send({ items: [{ prescribedDrugId: fixture.item.id, qtyToDispense: 5 }] }),
    api.post(`/api/records/prescriptions/${fixture.rx.id}/dispense`).set(auth('pharmacy')).send({ items: [{ prescribedDrugId: fixture.item.id, qtyToDispense: 5 }] })
  ]);
  assert.equal(responses.filter((response) => response.status === 200).length, 1);
  assert.equal(responses.filter((response) => response.status !== 200).length, 1);
  const batch = await prisma.inventoryBatch.findUnique({ where: { id: fixture.early.id } });
  const item = await prisma.prescribedDrug.findUnique({ where: { id: fixture.item.id } });
  const movements = await prisma.stockMovement.findMany({ where: { referenceId: fixture.item.id, referenceType: 'PRESCRIBED_DRUG_DISPENSE' } });
  assert.equal(batch.qtyOnHand, 0);
  assert.equal(item.qtyDispensed, 5);
  assert.equal(movements.length, 1);
  assert.equal(movements.reduce((sum, movement) => sum + movement.quantityDelta, 0), -5);
  assert.equal(batch.qtyOnHand, 5 + movements.reduce((sum, movement) => sum + movement.quantityDelta, 0));
});

test('concurrent prescriptions sharing one medicine cannot over-consume stock', async () => {
  const fixture = await createPrescriptionFixture({ earlyQty: 5, lateQty: 0, qtyPrescribed: 5 });
  const second = await createAdditionalPaidPrescriptionForDrug({ drugId: fixture.drug.id, qtyPrescribed: 5 });
  const responses = await Promise.all([
    api.post(`/api/records/prescriptions/${fixture.rx.id}/dispense`).set(auth('pharmacy')).send({ items: [{ prescribedDrugId: fixture.item.id, qtyToDispense: 5 }] }),
    api.post(`/api/records/prescriptions/${second.prescription.id}/dispense`).set(auth('pharmacy')).send({ items: [{ prescribedDrugId: second.item.id, qtyToDispense: 5 }] })
  ]);
  assert.equal(responses.filter((response) => response.status === 200).length, 1);
  assert.equal(responses.filter((response) => response.status !== 200).length, 1);
  const batch = await prisma.inventoryBatch.findUnique({ where: { id: fixture.early.id } });
  const items = await prisma.prescribedDrug.findMany({ where: { id: { in: [fixture.item.id, second.item.id] } } });
  const movements = await prisma.stockMovement.findMany({ where: { inventoryBatchId: fixture.early.id, movementType: 'DISPENSE' } });
  assert.ok(items.every((item) => item.qtyDispensed <= item.qtyPrescribed));
  assert.equal(items.reduce((sum, item) => sum + item.qtyDispensed, 0), 5);
  assert.equal(movements.reduce((sum, movement) => sum + movement.quantityDelta, 0), -5);
  assert.equal(batch.qtyOnHand, 0);
  assert.ok(batch.qtyOnHand >= 0);
});

test('concurrent multi-batch FEFO dispensing preserves expiry and ledger ordering', async () => {
  const fixture = await createPrescriptionFixture({ earlyQty: 3, lateQty: 4, qtyPrescribed: 4 });
  const expired = await prisma.inventoryBatch.create({ data: {
    drugId: fixture.drug.id,
    batchNumber: `EXPIRED-${Date.now()}-${Math.random()}`,
    normalizedBatchNumber: normalizeBatchNumber(`EXPIRED-${Date.now()}-${Math.random()}`),
    expiryDate: '2020-01-01',
    qtyOnHand: 10
  } });
  await prisma.stockMovement.create({ data: {
    drugId: fixture.drug.id, inventoryBatchId: expired.id, movementType: 'OPENING_BALANCE',
    quantityDelta: 10, resultingBalance: 10, referenceType: 'TEST_FIXTURE_OPENING_BALANCE',
    referenceId: expired.id, idempotencyKey: `test:opening-balance:${expired.id}`
  } });
  const second = await createAdditionalPaidPrescriptionForDrug({ drugId: fixture.drug.id, qtyPrescribed: 4 });
  const responses = await Promise.all([
    api.post(`/api/records/prescriptions/${fixture.rx.id}/dispense`).set(auth('pharmacy')).send({ items: [{ prescribedDrugId: fixture.item.id, qtyToDispense: 4 }] }),
    api.post(`/api/records/prescriptions/${second.prescription.id}/dispense`).set(auth('pharmacy')).send({ items: [{ prescribedDrugId: second.item.id, qtyToDispense: 4 }] })
  ]);
  assert.ok(responses.filter((response) => response.status === 200).length <= 2);
  const batches = await prisma.inventoryBatch.findMany({ where: { drugId: fixture.drug.id }, orderBy: { expiryDate: 'asc' } });
  assert.equal(batches.find((batch) => batch.id === expired.id).qtyOnHand, 10);
  assert.ok(batches.every((batch) => batch.qtyOnHand >= 0));
  const movements = await prisma.stockMovement.findMany({ where: { drugId: fixture.drug.id } });
  for (const batch of batches) {
    assert.equal(batch.qtyOnHand, movements.filter((movement) => movement.inventoryBatchId === batch.id).reduce((sum, movement) => sum + movement.quantityDelta, 0));
  }
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
  const pharmacistDenied = await api.post(`/api/billing/invoice/${id}/payments`)
    .set(paymentAuth('pharmacy')).send({ payments: [{ amountSdg: 1, paymentMethod: 'CASH' }] });
  assert.equal(pharmacistDenied.status, 403);
  assert.equal(pharmacistDenied.body.error.code, 'INVOICE_PAYMENT_ROLE_FORBIDDEN');
  const partial = await api.post(`/api/billing/invoice/${id}/payments`).set(paymentAuth('reception')).send({ payments: [{ amountSdg: 40, paymentMethod: 'CASH' }] });
  assert.equal(partial.body.paymentStatus, 'PARTIALLY_PAID');
  assert.equal(partial.body.remainingBalanceSdg, total - 40);
  const paid = await api.post(`/api/billing/invoice/${id}/payments`).set(paymentAuth('reception')).send({ payments: [{ amountSdg: total - 40, paymentMethod: 'CARD', transactionReference: `TEST-${Date.now()}` }] });
  assert.equal(paid.body.paymentStatus, 'PAID');
  assert.equal(paid.body.remainingBalanceSdg, 0);
});

test('invoice and payment direct IDs preserve role and patient-appointment context', async () => {
  const victimAppointment = await prisma.appointment.create({ data: {
    patientId: patient2.id, doctorId: doctor2.id,
    appointmentDate: '2064-05-05', appointmentTime: '13:00', status: 'CHECKED_IN'
  } });
  const mismatched = await api.post('/api/billing/invoice').set(auth('reception')).send({
    patientId: patient1.id,
    appointmentId: victimAppointment.id,
    invoiceType: 'CONSULTATION'
  });
  assert.equal(mismatched.status, 409);
  assert.equal(mismatched.body.error.code, 'CONSULTATION_PATIENT_MISMATCH');
  assertSafeAuthorizationDenial(mismatched, 409);
  assert.equal(await prisma.invoice.count({ where: { appointmentId: victimAppointment.id } }), 0);

  const created = await api.post('/api/billing/invoice').set(auth('reception')).send({
    patientId: patient2.id,
    appointmentId: victimAppointment.id,
    invoiceType: 'CONSULTATION'
  });
  assert.equal(created.status, 201);
  const invoiceId = created.body.invoice.id;
  const paymentBody = { payments: [{ amountSdg: 1, paymentMethod: 'CASH' }] };
  for (const role of ['doctor', 'lab']) {
    const denied = await api.post(`/api/billing/invoice/${invoiceId}/payments`)
      .set(paymentAuth(role)).send(paymentBody);
    assertSafeAuthorizationDenial(denied, 403);
  }
  const pharmacistDenied = await api.post(`/api/billing/invoice/${invoiceId}/payments`)
    .set(paymentAuth('pharmacy')).send(paymentBody);
  assertSafeAuthorizationDenial(pharmacistDenied, 403);
  assert.equal(pharmacistDenied.body.error.code, 'INVOICE_PAYMENT_ROLE_FORBIDDEN');
  for (const role of ['doctor', 'lab', 'pharmacy']) {
    const denied = await api.post(`/api/billing/invoice/${invoiceId}/refund`).set(auth(role)).send({
      amountSdg: 1, refundMethod: 'CASH'
    });
    assertSafeAuthorizationDenial(denied, 403);
  }
  assert.equal(await prisma.payment.count({ where: { invoiceId } }), 0);
  assert.equal(await prisma.refund.count({ where: { invoiceId } }), 0);
});

test('billing writes reject or ignore forbidden totals, status, ownership, and actor fields', async () => {
  const forbiddenInvoice = await api.post('/api/billing/invoice').set(auth('reception')).send({
    patientId: patient1.id,
    invoiceType: 'GENERAL',
    items: [{ serviceId: service.id, quantity: 1 }],
    totalAmountSdg: 1,
    paidAmountSdg: 1,
    amountDue: 1,
    paymentStatus: 'PAID',
    invoiceStatus: 'REFUNDED',
    discount: 100,
    createdBy: 'attacker-controlled-actor',
    actorUserId: '00000000-0000-4000-8000-000000000066'
  });
  assertSafeAuthorizationDenial(forbiddenInvoice, 422);

  const invoice = await prisma.invoice.create({ data: {
    patientId: patient1.id,
    totalAmountSdg: 100,
    totalAmountUsd: 0.1,
    invoiceExchangeRate: 1000,
    createdBy: 'mass-assignment-test'
  } });
  const forbiddenPayment = await api.post(`/api/billing/invoice/${invoice.id}/payments`)
    .set(paymentAuth('reception')).send({
      payments: [{ amountSdg: 40, paymentMethod: 'CASH', receivedBy: 'attacker-controlled-actor' }],
      totalAmountSdg: 1,
      paidAmountSdg: 100,
      paymentStatus: 'PAID',
      invoiceStatus: 'PAID',
      discount: 100,
      patientId: patient2.id,
      appointmentId: unrelatedAppointment.id,
      actorUserId: '00000000-0000-4000-8000-000000000066',
      idempotencyKey: 'body-controlled-key'
    });
  assertSafeAuthorizationDenial(forbiddenPayment, 422);
  let persisted = await prisma.invoice.findUnique({ where: { id: invoice.id } });
  assert.equal(persisted.patientId, patient1.id);
  assert.equal(persisted.totalAmountSdg.toNumber(), 100);
  assert.equal(persisted.paymentStatus, 'UNPAID');
  assert.equal(await prisma.payment.count({ where: { invoiceId: invoice.id } }), 0);

  const paid = await api.post(`/api/billing/invoice/${invoice.id}/payments`)
    .set(paymentAuth('reception')).send({ payments: [{ amountSdg: 100, paymentMethod: 'CASH' }] });
  assert.equal(paid.status, 200);
  const refunded = await api.post(`/api/billing/invoice/${invoice.id}/refund`).set(auth('reception')).send({
    amountSdg: 10,
    refundMethod: 'CASH',
    paymentStatus: 'PAID',
    invoiceStatus: 'PAID',
    totalAmountSdg: 1,
    patientId: patient2.id,
    appointmentId: unrelatedAppointment.id,
    actorUserId: '00000000-0000-4000-8000-000000000066',
    createdBy: 'attacker-controlled-actor'
  });
  assert.equal(refunded.status, 201);
  persisted = await prisma.invoice.findUnique({ where: { id: invoice.id } });
  assert.equal(persisted.patientId, patient1.id);
  assert.equal(persisted.totalAmountSdg.toNumber(), 100);
  assert.equal(persisted.paymentStatus, 'PARTIALLY_REFUNDED');
  assert.equal(await prisma.refund.count({ where: { invoiceId: invoice.id, amountSdg: 10 } }), 1);
});

test('pharmacy direct-ID mutations require pharmacist authority even with valid IDs', async () => {
  const medicine = await prisma.drugFormulary.findUnique({ where: { id: drug.id } });
  const patientActor = await createAppointmentConcurrencyPatient();
  const patientAuth = { Authorization: `Bearer ${patientActor.token}` };
  const metadataPayload = { labelEn: medicine.labelEn };
  const batchPayload = {
    batchNumber: `DIRECT-ID-${Date.now()}`,
    expiryDate: '2065-06-06',
    receivedQuantity: 1,
    minReorderLevel: 0
  };
  for (const credentials of [auth('doctor'), auth('reception'), auth('lab'), patientAuth]) {
    assertSafeAuthorizationDenial(
      await api.patch(`/api/pharmacy/formulary/${medicine.id}/metadata`).set(credentials).send(metadataPayload),
      403
    );
    assertSafeAuthorizationDenial(
      await api.post(`/api/pharmacy/formulary/${medicine.id}/batches`).set(credentials).send(batchPayload),
      403
    );
  }

  const fixture = await createPrescriptionFixture({ paid: true, qtyPrescribed: 1 });
  for (const credentials of [auth('doctor'), auth('reception'), auth('lab'), patientAuth]) {
    assertSafeAuthorizationDenial(
      await api.post(`/api/records/prescriptions/${fixture.rx.id}/dispense`).set(credentials)
        .send({ items: [{ prescribedDrugId: fixture.item.id, qtyToDispense: 1 }] }),
      403
    );
  }
  assert.equal((await prisma.prescribedDrug.findUnique({ where: { id: fixture.item.id } })).qtyDispensed, 0);
  assert.equal(await prisma.inventoryBatch.count({ where: { drugId: medicine.id, batchNumber: batchPayload.batchNumber } }), 0);
});

test('pharmacy stock writes reject or strip browser-controlled ledger and balance fields', async () => {
  const fixture = await createPrescriptionFixture({ paid: true, qtyPrescribed: 2, earlyQty: 5, lateQty: 0 });
  const forgedBatchNumber = `FORGED-STOCK-${Date.now()}`;
  const batchAttempt = await api.post(`/api/pharmacy/formulary/${fixture.drug.id}/batches`).set(auth('pharmacy')).send({
    batchNumber: forgedBatchNumber,
    expiryDate: '2066-07-07',
    receivedQuantity: 3,
    minReorderLevel: 0,
    drugId: drug.id,
    qtyOnHand: 999999,
    ledgerVersion: 999,
    movementType: 'DISPENSE',
    quantityDelta: -999999,
    resultingBalance: -999999,
    actorUserId: '00000000-0000-4000-8000-000000000099'
  });
  assertSafeAuthorizationDenial(batchAttempt, 422);
  assert.equal(await prisma.inventoryBatch.count({ where: {
    drugId: fixture.drug.id,
    batchNumber: forgedBatchNumber
  } }), 0);

  const beforeBatch = await prisma.inventoryBatch.findUnique({ where: { id: fixture.early.id } });
  const beforeMovementCount = await prisma.stockMovement.count({ where: { inventoryBatchId: fixture.early.id } });
  const dispensed = await api.post(`/api/records/prescriptions/${fixture.rx.id}/dispense`).set(auth('pharmacy')).send({
    items: [{
      prescribedDrugId: fixture.item.id,
      qtyToDispense: 1,
      drugId: drug.id,
      batchId: fixture.late.id,
      qtyOnHand: 999999,
      qtyDispensed: 999999,
      ledgerVersion: 999,
      movementType: 'RECEIPT',
      quantityDelta: 999999,
      resultingBalance: 999999,
      prescriptionStatus: 'CANCELLED',
      actorUserId: '00000000-0000-4000-8000-000000000099',
      idempotencyKey: 'browser-controlled-key'
    }]
  });
  assert.equal(dispensed.status, 200);
  const [afterBatch, afterItem, afterPrescription, movement, afterMovementCount] = await Promise.all([
    prisma.inventoryBatch.findUnique({ where: { id: fixture.early.id } }),
    prisma.prescribedDrug.findUnique({ where: { id: fixture.item.id } }),
    prisma.prescription.findUnique({ where: { id: fixture.rx.id } }),
    prisma.stockMovement.findFirst({ where: {
      inventoryBatchId: fixture.early.id,
      referenceType: 'PRESCRIBED_DRUG_DISPENSE',
      referenceId: fixture.item.id
    } }),
    prisma.stockMovement.count({ where: { inventoryBatchId: fixture.early.id } })
  ]);
  const pharmacist = await prisma.user.findUnique({ where: { username: 'pharma@cms.com' } });
  assert.equal(afterBatch.qtyOnHand, beforeBatch.qtyOnHand - 1);
  assert.equal(afterBatch.ledgerVersion, beforeBatch.ledgerVersion + 1);
  assert.equal(afterItem.qtyDispensed, 1);
  assert.equal(afterItem.ledgerVersion, fixture.item.ledgerVersion + 1);
  assert.equal(afterPrescription.status, 'PARTIALLY_FILLED');
  assert.equal(afterMovementCount, beforeMovementCount + 1);
  assert.equal(movement.movementType, 'DISPENSE');
  assert.equal(movement.quantityDelta, -1);
  assert.equal(movement.resultingBalance, beforeBatch.qtyOnHand - 1);
  assert.equal(movement.actorUserId, pharmacist.id);
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

test('refund broad P2002 mapping exposes no database metadata or constraint details', async () => {
  const invoice = await paidInvoice(100);
  const marker = `REFUND-P2002-SECRET-${Date.now()}-${++fixtureCounter}`;
  const constraintMarker = `refund_fake_constraint_${Date.now()}_${fixtureCounter}`;
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION reject_test_refund_with_p2002() RETURNS trigger AS $$
    BEGIN
      RAISE unique_violation USING
        MESSAGE = '${marker} SQL INSERT INTO Refund P2002',
        CONSTRAINT = '${constraintMarker}';
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER reject_test_refund_with_p2002_trigger
    BEFORE INSERT ON "Refund"
    FOR EACH ROW EXECUTE FUNCTION reject_test_refund_with_p2002()
  `);
  try {
    const response = await api.post(`/api/billing/invoice/${invoice.id}/refund`).set(auth('reception')).send({
      amountSdg: 10,
      refundMethod: 'CASH'
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'DUPLICATE_REFUND_REFERENCE');
    assert.equal(response.body.error.message, 'Refund transaction reference has already been used.');
    assertNoSensitiveErrorLeak(response.body, [marker, constraintMarker]);
    assert.equal(await prisma.refund.count({ where: { invoiceId: invoice.id } }), 0);
    assert.equal((await prisma.invoice.findUnique({ where: { id: invoice.id } })).paymentStatus, 'PAID');
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_test_refund_with_p2002_trigger ON "Refund"');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_test_refund_with_p2002()');
  }
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

test('ADMIN analytics returns authoritative complete appointment status aggregates', async () => {
  const response = await api.get('/api/admin/analytics').set(auth('admin'));
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body.appointmentStatuses));
  assert.equal(
    response.body.appointmentStatuses.reduce((sum, item) => sum + item.count, 0),
    response.body.totalAppointments
  );
  assert.ok(response.body.appointmentStatuses.every((item) =>
    typeof item.status === 'string' && Number.isInteger(item.count) && item.count >= 0
  ));
  assert.equal((await api.get('/api/admin/analytics').set(auth('doctor'))).status, 403);
  const serialized = JSON.stringify(response.body);
  assert.doesNotMatch(serialized, /passwordHash|mfaSecret|authVersion|diagnosis|clinicalNotes|token/i);
});

test('appointments reject past dates and invalid slots', async () => {
  assert.equal((await api.get(`/api/appointments/slots?doctorId=${doctor1.id}&date=2020-01-01`)).status, 422);
  const response = await api.post('/api/appointments/book').send(await bookingPayload('2030-01-06', '03:00', '0991000010'));
  assert.equal(response.status, 422);
});

test('public booking never attaches an appointment by phone alone', async () => {
  const slot = await findAvailableAppointmentSlot(doctor1.id);
  const phone = `+24993${String(++fixtureCounter).padStart(7, '0').slice(-7)}`;
  const victim = await prisma.patient.create({ data: {
    fullNameAr: 'مريض صاحب الهاتف المشترك', fullNameEn: 'Shared Phone Owner', gender: 'MALE',
    dateOfBirth: '1980-01-01', phone, addressStateId: 1, emergencyContact: 'Self'
  } });
  const otp = await api.post('/api/appointments/otp/request').send({ phone: `093 ${phone.slice(-7)}` });
  assert.equal(otp.status, 200);
  const response = await api.post('/api/appointments/book').send({
    ...slot, fullNameAr: 'مريض آخر بنفس الهاتف', fullNameEn: 'Different Shared Phone Patient', gender: 'FEMALE',
    dateOfBirth: '1995-05-05', phone, addressStateId: 1, otpCode: otp.body.developmentCode
  });
  assert.equal(response.status, 201);
  assert.notEqual(response.body.patientId, victim.id);
  assert.equal(await prisma.appointment.count({ where: { id: response.body.id, patientId: victim.id } }), 0);
  assert.equal(await prisma.patient.count({ where: { phone: normalizePatientPhone(phone) } }), 2);
});

test('public booking reuses only a strong exact identity and rejects mismatched national-ID identity generically', async () => {
  const firstSlot = await findAvailableAppointmentSlot(doctor1.id);
  const phone = `+24994${String(++fixtureCounter).padStart(7, '0').slice(-7)}`;
  const nationalId = `PUBLIC-${String(++fixtureCounter).padStart(7, '0').slice(-7)}`;
  const existing = await prisma.patient.create({ data: {
    fullNameAr: 'مريض تطابق قوي', fullNameEn: 'Strong Match Patient', gender: 'MALE', dateOfBirth: '1987-07-07',
    nationalId, phone, addressStateId: 1, emergencyContact: 'Self'
  } });
  const otp = await api.post('/api/appointments/otp/request').send({ phone });
  const matched = await api.post('/api/appointments/book').send({
    ...firstSlot, fullNameAr: existing.fullNameAr, fullNameEn: existing.fullNameEn, gender: existing.gender,
    dateOfBirth: existing.dateOfBirth, nationalId: nationalId.toLowerCase(), phone, addressStateId: 1, otpCode: otp.body.developmentCode
  });
  assert.equal(matched.status, 201);
  assert.equal(matched.body.patientId, existing.id);
  assert.equal(await prisma.patient.count({ where: { nationalId } }), 1);

  const secondSlot = await findAvailableAppointmentSlot(doctor1.id);
  const otp2 = await api.post('/api/appointments/otp/request').send({ phone });
  const mismatched = await api.post('/api/appointments/book').send({
    ...secondSlot, fullNameAr: 'هوية مختلفة', fullNameEn: 'Different Identity', gender: 'FEMALE',
    dateOfBirth: '1999-09-09', nationalId, phone, addressStateId: 1, otpCode: otp2.body.developmentCode
  });
  assert.equal(mismatched.status, 409);
  assert.equal(mismatched.body.error.code, 'PATIENT_IDENTITY_REVIEW_REQUIRED');
  assert.doesNotMatch(JSON.stringify(mismatched.body), new RegExp(existing.id));
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
  const conflict = responses.find((response) => response.status === 409);
  assert.equal(conflict.body.error.code, 'APPOINTMENT_SLOT_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(conflict.body), /Prisma|P2002|constraint|stack|SQL|database/i);
  assert.equal(await prisma.appointment.count({ where: {
    doctorId: doctor1.id, appointmentDate: date, appointmentTime: '10:00', status: { notIn: ['CANCELLED', 'NO_SHOW'] }
  } }), 1);
});

test('cancelled and no-show appointments release their slots for later booking', async () => {
  const cancelledSlot = await findAvailableAppointmentSlot(doctor1.id);
  const cancelled = await prisma.appointment.create({ data: {
    patientId: patient1.id, doctorId: cancelledSlot.doctorId, appointmentDate: cancelledSlot.appointmentDate,
    appointmentTime: cancelledSlot.appointmentTime, status: 'CANCELLED'
  } });
  const cancelledBooking = await api.post('/api/appointments/book').send(await bookingPayload(cancelledSlot.appointmentDate, cancelledSlot.appointmentTime, `0991${Date.now().toString().slice(-6)}`));
  assert.equal(cancelledBooking.status, 201);
  assert.equal(await prisma.appointment.count({ where: { doctorId: cancelledSlot.doctorId, appointmentDate: cancelledSlot.appointmentDate, appointmentTime: cancelledSlot.appointmentTime, status: { notIn: ['CANCELLED', 'NO_SHOW'] } } }), 1);
  const noShowSlot = await findAvailableAppointmentSlot(doctor1.id);
  await prisma.appointment.create({ data: {
    patientId: patient1.id, doctorId: noShowSlot.doctorId, appointmentDate: noShowSlot.appointmentDate,
    appointmentTime: noShowSlot.appointmentTime, status: 'NO_SHOW'
  } });
  const noShowBooking = await api.post('/api/appointments/book').send(await bookingPayload(noShowSlot.appointmentDate, noShowSlot.appointmentTime, `0992${Date.now().toString().slice(-6)}`));
  assert.equal(noShowBooking.status, 201);
  assert.equal(await prisma.appointment.count({ where: { doctorId: noShowSlot.doctorId, appointmentDate: noShowSlot.appointmentDate, appointmentTime: noShowSlot.appointmentTime, status: { notIn: ['CANCELLED', 'NO_SHOW'] } } }), 1);
  assert.ok(cancelled.id && noShowSlot.appointmentTime);
});

test('cancellation racing with a competing booking preserves one active slot', async () => {
  const slot = await findAvailableAppointmentSlot(doctor1.id);
  const owner = await createAppointmentConcurrencyPatient();
  const appointment = await prisma.appointment.create({ data: {
    patientId: owner.patient.id, doctorId: doctor1.id, appointmentDate: slot.appointmentDate,
    appointmentTime: slot.appointmentTime, status: 'CONFIRMED'
  } });
  const phone = `0922${Date.now().toString().slice(-6)}`;
  const otp = await api.post('/api/appointments/otp/request').send({ phone });
  assert.equal(otp.status, 200);
  const [cancel, booking] = await Promise.all([
    api.post(`/api/patient/appointments/${appointment.id}/cancel`).set({ Authorization: `Bearer ${owner.token}` }),
    api.post('/api/appointments/book').send({ doctorId: doctor1.id, appointmentDate: slot.appointmentDate, appointmentTime: slot.appointmentTime, fullNameAr: 'مريض حجز متنافس', fullNameEn: 'Race Booking Patient', gender: 'FEMALE', dateOfBirth: '1991-01-01', phone, addressStateId: 1, otpCode: otp.body.developmentCode })
  ]);
  assert.ok([200, 409].includes(cancel.status));
  assert.ok([201, 409].includes(booking.status));
  const activeCount = await prisma.appointment.count({ where: { doctorId: doctor1.id, appointmentDate: slot.appointmentDate, appointmentTime: slot.appointmentTime, status: { notIn: ['CANCELLED', 'NO_SHOW'] } } });
  assert.ok(activeCount <= 1);
  const persistedOriginal = await prisma.appointment.findUnique({ where: { id: appointment.id }, select: { status: true } });
  if (cancel.status === 200) assert.equal(persistedOriginal.status, 'CANCELLED');
  if (cancel.status === 409) {
    assert.equal(persistedOriginal.status, 'CONFIRMED');
    assert.equal(booking.status, 409);
    assert.equal(activeCount, 1);
  }
  if (booking.status === 201) {
    assert.equal(activeCount, 1);
    assert.notEqual(booking.body.id, appointment.id);
  }
  if (booking.status === 409) {
    assert.ok([0, 1].includes(activeCount));
    assert.equal(JSON.stringify(booking.body).includes('P2002'), false);
  }
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

  const forbidden = await api
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

  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.error.code, 'PHARMACY_INVOICE_SYSTEM_OWNED');

  const adminForbidden = await api
    .post('/api/billing/invoice')
    .set(auth('admin'))
    .send({
      patientId: patient1.id,
      prescriptionId: fixture.rx.id,
      invoiceType: 'PHARMACY',
      items: [{ descriptionAr: 'مرفوض', descriptionEn: 'Rejected', qty: 1, unitPriceSdg: 1 }]
    });
  assert.equal(adminForbidden.status, 403);
  assert.equal(adminForbidden.body.error.code, 'PHARMACY_INVOICE_SYSTEM_OWNED');

  const response = await requestPharmacyInvoiceForFixture(fixture);

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

test('doctor prescription submission automatically creates one authoritative pharmacy invoice without financial side effects', async () => {
  fixtureCounter += 1;
  const automaticGenericName = `AutomaticInvoice-${fixtureCounter}-${Date.now()}`;
  const standardDrug = await prisma.drugFormulary.create({
    data: {
      brandName: `Automatic Invoice Drug ${fixtureCounter}`,
      labelAr: 'دواء فاتورة تلقائية',
      labelEn: `Automatic Invoice Drug ${fixtureCounter}`,
      genericName: automaticGenericName,
      strength: '10mg',
      dosageForm: 'Tablet',
      identityKey: buildMedicineIdentityKey({
        brandName: `Automatic Invoice Drug ${fixtureCounter}`,
        genericName: automaticGenericName,
        strength: '10mg',
        dosageForm: 'Tablet'
      }),
      unitPriceSdg: 1500,
      status: 'ACTIVE'
    }
  });
  const appointment = await prisma.appointment.create({
    data: {
      patientId: patient1.id,
      doctorId: doctor1.id,
      appointmentDate: `2044-03-${String((fixtureCounter % 27) + 1).padStart(2, '0')}`,
      appointmentTime: `${String(8 + (fixtureCounter % 10)).padStart(2, '0')}:15`,
      status: 'IN_CONSULTATION'
    }
  });
  const beforeStock = await prisma.inventoryBatch.aggregate({
    where: { drugId: standardDrug.id },
    _sum: { qtyOnHand: true }
  });
  const beforeMovements = await prisma.stockMovement.count({ where: { drugId: standardDrug.id } });

  const accepted = await api.post('/api/records').set(auth('doctor')).send({
    patientId: patient1.id,
    appointmentId: appointment.id,
    diagnosis: 'Synthetic integration diagnosis',
    prescribedDrugs: [{
      drugId: standardDrug.id,
      dosage: '1 tablet',
      duration: '2 days',
      qtyPrescribed: 2,
      unitPriceSdg: 1,
      invoiceTotal: 1
    }]
  });
  assert.equal(accepted.status, 201);

  const prescriptionId = accepted.body.data.prescription.id;
  const invoice = await prisma.invoice.findFirst({
    where: { prescriptionId, invoiceType: 'PHARMACY' },
    include: { items: true }
  });
  assert.ok(invoice);
  assert.equal(invoice.items.length, 1);
  assert.equal(invoice.items[0].qty, 2);
  assert.equal(Number(invoice.items[0].unitPriceSdg), Number(standardDrug.unitPriceSdg));
  assert.equal(Number(invoice.totalAmountSdg), Number(standardDrug.unitPriceSdg) * 2);
  const paymentState = await api
    .get(`/api/pharmacy/prescriptions/${prescriptionId}/payment-state`)
    .set(auth('pharmacy'));
  assert.equal(paymentState.status, 200);
  assert.equal(paymentState.body.invoice.id, invoice.id);
  assert.equal(paymentState.body.invoice.outstandingAmountSdg, Number(invoice.totalAmountSdg));
  assert.equal(paymentState.body.dispensingAllowed, false);
  assert.equal(await prisma.payment.count({ where: { invoiceId: invoice.id } }), 0);
  assert.equal(await prisma.stockMovement.count({ where: { drugId: standardDrug.id } }), beforeMovements);
  assert.equal(Number((await prisma.inventoryBatch.aggregate({
    where: { drugId: standardDrug.id }, _sum: { qtyOnHand: true }
  }))._sum.qtyOnHand || 0), Number(beforeStock._sum.qtyOnHand || 0));
});

test('concurrent automatic ensures create one invoice, one item set, and one creation audit', async () => {
  const fixture = await createPrescriptionFixture({ paid: false, qtyPrescribed: 2 });
  const options = {
    prescriptionId: fixture.rx.id,
    actorUserId: doctor1.userId,
    ipAddress: '127.0.0.1',
    trigger: 'CONCURRENT_TEST'
  };
  const [left, right] = await Promise.all([
    ensurePharmacyInvoiceForPrescription(options),
    ensurePharmacyInvoiceForPrescription(options)
  ]);
  assert.equal(left.invoice.id, right.invoice.id);
  assert.deepEqual([left.existing, right.existing].sort(), [false, true]);
  assert.equal(await prisma.invoice.count({
    where: { prescriptionId: fixture.rx.id, invoiceType: 'PHARMACY' }
  }), 1);
  assert.equal(await prisma.invoiceItem.count({ where: { invoiceId: left.invoice.id } }), 1);
  assert.equal(await prisma.tenantAuditLog.count({
    where: { action: 'PHARMACY_INVOICE_AUTOMATICALLY_CREATED', details: { contains: fixture.rx.id } }
  }), 1);
});

test('automatic ensure fails safely for duplicate active or refunded historical pharmacy billing', async () => {
  const duplicateFixture = await createPrescriptionFixture({ paid: false, qtyPrescribed: 2 });
  const first = await ensurePharmacyInvoiceForPrescription({
    prescriptionId: duplicateFixture.rx.id,
    actorUserId: doctor1.userId,
    trigger: 'INVARIANT_TEST'
  });
  await prisma.invoice.create({
    data: {
      patientId: patient1.id,
      prescriptionId: duplicateFixture.rx.id,
      invoiceType: 'PHARMACY',
      totalAmountSdg: 1,
      totalAmountUsd: 1 / 1500,
      invoiceExchangeRate: 1500,
      paymentStatus: 'UNPAID',
      createdBy: doctor1.userId
    }
  });
  const duplicateResult = await ensurePharmacyInvoiceForPrescription({
    prescriptionId: duplicateFixture.rx.id,
    actorUserId: doctor1.userId,
    trigger: 'INVARIANT_TEST'
  });
  assert.equal(duplicateResult.pending, true);
  assert.equal(duplicateResult.code, 'PHARMACY_INVOICE_INVARIANT_VIOLATION');
  assert.equal(await prisma.invoice.count({ where: { prescriptionId: duplicateFixture.rx.id } }), 2);

  const refundedFixture = await createPrescriptionFixture({ paid: false, qtyPrescribed: 2 });
  const refunded = await ensurePharmacyInvoiceForPrescription({
    prescriptionId: refundedFixture.rx.id,
    actorUserId: doctor1.userId,
    trigger: 'REFUND_TEST'
  });
  await prisma.invoice.update({ where: { id: refunded.invoice.id }, data: { paymentStatus: 'REFUNDED' } });
  const refundedResult = await ensurePharmacyInvoiceForPrescription({
    prescriptionId: refundedFixture.rx.id,
    actorUserId: doctor1.userId,
    trigger: 'REFUND_TEST'
  });
  assert.equal(refundedResult.pending, true);
  assert.equal(refundedResult.code, 'PHARMACY_REFUNDED_INVOICE_REVIEW_REQUIRED');
  assert.equal(await prisma.invoice.count({ where: { prescriptionId: refundedFixture.rx.id } }), 1);
  assert.ok(first.invoice.id);
});

test('mixed prescription bills remaining clinic quantity, omits external and fully dispensed items', async () => {
  const fixture = await createPrescriptionFixture({ paid: false, qtyPrescribed: 5 });
  await prisma.prescribedDrug.update({
    where: { id: fixture.item.id },
    data: { qtyDispensed: 2 }
  });
  await prisma.prescribedDrug.createMany({
    data: [{
      prescriptionId: fixture.rx.id,
      drugId: fixture.drug.id,
      dosage: 'completed',
      duration: '1 day',
      instructionsAr: '',
      instructionsEn: '',
      qtyPrescribed: 1,
      qtyDispensed: 1
    }, {
      prescriptionId: fixture.rx.id,
      customDrugName: 'External medicine',
      dosage: 'external',
      duration: '1 day',
      instructionsAr: '',
      instructionsEn: '',
      qtyPrescribed: 9,
      pharmacyReviewStatus: 'EXTERNAL'
    }]
  });
  const result = await ensurePharmacyInvoiceForPrescription({
    prescriptionId: fixture.rx.id,
    actorUserId: doctor1.userId,
    trigger: 'MIXED_TEST'
  });
  assert.equal(result.pending, false);
  assert.equal(result.invoice.items.length, 1);
  assert.equal(result.invoice.items[0].qty, 3);
  assert.equal(Number(result.invoice.totalAmountSdg), Number(fixture.unitPriceSdg) * 3);
});

test('automatic ensure never rewrites an existing paid invoice', async () => {
  const fixture = await createPrescriptionFixture({ paid: true, qtyPrescribed: 3 });
  const before = await prisma.invoice.findUnique({
    where: { id: fixture.invoice.id },
    include: { items: true }
  });
  await prisma.drugFormulary.update({
    where: { id: fixture.drug.id },
    data: { unitPriceSdg: Number(fixture.unitPriceSdg) + 500 }
  });
  const result = await ensurePharmacyInvoiceForPrescription({
    prescriptionId: fixture.rx.id,
    actorUserId: doctor1.userId,
    trigger: 'PAID_REUSE_TEST'
  });
  const after = await prisma.invoice.findUnique({
    where: { id: fixture.invoice.id },
    include: { items: true }
  });
  assert.equal(result.existing, true);
  assert.equal(result.invoice.id, before.id);
  assert.equal(Number(after.totalAmountSdg), Number(before.totalAmountSdg));
  assert.equal(Number(after.items[0].unitPriceSdg), Number(before.items[0].unitPriceSdg));
  assert.equal(after.paymentStatus, 'PAID');
});

test('cancelled prescription cannot receive a new payable pharmacy invoice', async () => {
  const fixture = await createPrescriptionFixture({ paid: false });
  await prisma.prescription.update({ where: { id: fixture.rx.id }, data: { status: 'CANCELLED' } });
  const result = await ensurePharmacyInvoiceForPrescription({
    prescriptionId: fixture.rx.id,
    actorUserId: doctor1.userId,
    trigger: 'CANCELLED_TEST'
  });
  assert.equal(result.pending, true);
  assert.equal(result.code, 'PHARMACY_BILLING_INVALID_STATE');
  assert.equal(await prisma.invoice.count({
    where: { prescriptionId: fixture.rx.id, invoiceType: 'PHARMACY' }
  }), 0);
});

test('repeated automatic pharmacy invoice ensures reuse the same active invoice', async () => {
  const fixture = await createPrescriptionFixture({ paid: false });

  const first = await requestPharmacyInvoiceForFixture(fixture);

  assert.equal(first.status, 201);

  const second = await requestPharmacyInvoiceForFixture(fixture);

  assert.equal(second.status, 200);
  assert.equal(second.body.existing, true);
  assert.equal(second.body.invoice.id, first.body.invoice.id);
});

test('pharmacy invoice rejects formulary medication without configured price', async () => {
  const fixture = await createPrescriptionFixture({
    paid: false,
    unitPriceSdg: null
  });

  const response = await requestPharmacyInvoiceForFixture(fixture);

  assert.equal(response.status, 409);
  assert.equal(
    response.body.error.code,
    'PHARMACY_PRICE_NOT_CONFIGURED'
  );
});

test('pharmacy dispensing stays locked until the pharmacy invoice is fully paid', async () => {
  const fixture = await createPrescriptionFixture({ paid: false });

  const invoiceResponse = await requestPharmacyInvoiceForFixture(fixture);

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
    .set(paymentAuth('pharmacy'))
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
    .set(paymentAuth('pharmacy'))
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

test('pharmacy payment authority is pharmacist-owned and payload values cannot override finance state', async () => {
  const fixture = await createPrescriptionFixture({ paid: false });
  const invoiceResponse = await requestPharmacyInvoiceForFixture(fixture);
  assert.equal(invoiceResponse.status, 201);
  const invoice = invoiceResponse.body.invoice;
  const total = Number(invoice.totalAmountSdg);
  const paymentBody = { payments: [{ amountSdg: total / 2, paymentMethod: 'BANKAK' }] };

  assert.equal((await api.post(`/api/billing/invoice/${invoice.id}/payments`)
    .set('Idempotency-Key', `pharmacy-unauth-${Date.now()}`).send(paymentBody)).status, 401);
  for (const role of ['reception', 'doctor', 'lab', 'admin']) {
    const denied = await api.post(`/api/billing/invoice/${invoice.id}/payments`)
      .set(paymentAuth(role, `pharmacy-role-${role}-${Date.now()}-${++fixtureCounter}`)).send(paymentBody);
    assert.equal(denied.status, 403);
    if (['reception', 'admin'].includes(role)) {
      assert.equal(denied.body.error.code, 'INVOICE_PAYMENT_ROLE_FORBIDDEN');
    } else {
      assert.equal(denied.body.error.code, 'FORBIDDEN');
    }
  }
  const patientDenied = await api.post(`/api/billing/invoice/${invoice.id}/payments`)
    .set({ Authorization: `Bearer ${pharmacyApiPatientToken}`, 'Idempotency-Key': `pharmacy-patient-${Date.now()}` })
    .send(paymentBody);
  assert.equal(patientDenied.status, 403);

  const forged = await api.post(`/api/billing/invoice/${invoice.id}/payments`)
    .set(paymentAuth('pharmacy')).send({
      ...paymentBody,
      totalAmountSdg: 1,
      paymentStatus: 'PAID',
      actorUserId: 'forged',
      role: 'ADMIN',
      unitPriceSdg: 1
    });
  assert.equal(forged.status, 422);
  assert.equal(await prisma.payment.count({ where: { invoiceId: invoice.id } }), 0);

  const beforeStock = await prisma.inventoryBatch.aggregate({
    where: { drugId: fixture.drug.id },
    _sum: { qtyOnHand: true }
  });
  const beforeMovements = await prisma.stockMovement.count({ where: { drugId: fixture.drug.id } });
  const partial = await api.post(`/api/billing/invoice/${invoice.id}/payments`)
    .set(paymentAuth('pharmacy')).send(paymentBody);
  assert.equal(partial.status, 200);
  assert.equal(partial.body.paymentStatus, 'PARTIALLY_PAID');
  assert.equal(partial.body.totalPaidSdg, total / 2);
  assert.equal(partial.body.remainingBalanceSdg, total / 2);

  const pharmacist = await prisma.user.findUnique({ where: { username: 'pharma@cms.com' }, select: { id: true } });
  const storedPayment = await prisma.payment.findFirst({ where: { invoiceId: invoice.id } });
  assert.equal(storedPayment.receivedBy, pharmacist.id);
  assert.equal(Number(storedPayment.amountSdg), total / 2);
  const paymentAudit = await prisma.tenantAuditLog.findFirst({
    where: { action: 'PHARMACY_INVOICE_PAYMENT_RECORDED', details: { contains: invoice.id } }
  });
  assert.ok(paymentAudit);
  assert.equal(paymentAudit.userId, pharmacist.id);
  assert.equal(paymentAudit.details.includes('password'), false);

  assert.equal(Number((await prisma.inventoryBatch.aggregate({
    where: { drugId: fixture.drug.id }, _sum: { qtyOnHand: true }
  }))._sum.qtyOnHand), Number(beforeStock._sum.qtyOnHand));
  assert.equal(await prisma.stockMovement.count({ where: { drugId: fixture.drug.id } }), beforeMovements);

  const blockedDispense = await api.post(`/api/records/prescriptions/${fixture.rx.id}/dispense`)
    .set(auth('pharmacy')).send({ items: [{ prescribedDrugId: fixture.item.id, qtyToDispense: 1 }] });
  assert.equal(blockedDispense.status, 403);
  assert.equal(blockedDispense.body.error.code, 'PHARMACY_PAYMENT_REQUIRED');

  const state = await api.get(`/api/pharmacy/prescriptions/${fixture.rx.id}/payment-state`).set(auth('pharmacy'));
  assert.equal(state.status, 200);
  assert.equal(state.body.invoice.id, invoice.id);
  assert.equal(state.body.invoice.totalAmountSdg, total);
  assert.equal(state.body.invoice.paidAmountSdg, total / 2);
  assert.equal(state.body.invoice.outstandingAmountSdg, total / 2);
  assert.equal(state.body.dispensingAllowed, false);
  assert.deepEqual(state.body.allowedPaymentMethods, ['CASH', 'CARD', 'BANKAK', 'FAWRY']);
  assert.equal((await api.get(`/api/pharmacy/prescriptions/${fixture.rx.id}/payment-state`).set(auth('admin'))).status, 200);
  assert.equal((await api.get(`/api/pharmacy/prescriptions/${fixture.rx.id}/payment-state`).set(auth('reception'))).status, 403);

  const completed = await api.post(`/api/billing/invoice/${invoice.id}/payments`)
    .set(paymentAuth('pharmacy')).send({ payments: [{ amountSdg: total / 2, paymentMethod: 'CASH' }] });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.paymentStatus, 'PAID');
  assert.equal(completed.body.remainingBalanceSdg, 0);

  const duplicate = await api.post(`/api/billing/invoice/${invoice.id}/payments`)
    .set(paymentAuth('pharmacy')).send({ payments: [{ amountSdg: 1, paymentMethod: 'CASH' }] });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, 'INVOICE_ALREADY_PAID');
});

test('concurrent pharmacist full payments cannot double-pay a pharmacy invoice', async () => {
  const fixture = await createPrescriptionFixture({ paid: false });
  const created = await requestPharmacyInvoiceForFixture(fixture);
  assert.equal(created.status, 201);
  const invoice = created.body.invoice;
  const amount = Number(invoice.totalAmountSdg);
  const body = { payments: [{ amountSdg: amount, paymentMethod: 'CASH' }] };
  const [left, right] = await Promise.all([
    api.post(`/api/billing/invoice/${invoice.id}/payments`)
      .set(paymentAuth('pharmacy', `pharmacy-full-left-${Date.now()}-${++fixtureCounter}`)).send(body),
    api.post(`/api/billing/invoice/${invoice.id}/payments`)
      .set(paymentAuth('pharmacy', `pharmacy-full-right-${Date.now()}-${++fixtureCounter}`)).send(body)
  ]);
  assert.deepEqual([left.status, right.status].sort(), [200, 409]);
  assert.equal(await prisma.payment.count({ where: { invoiceId: invoice.id } }), 1);
  assert.equal(Number((await prisma.payment.aggregate({
    where: { invoiceId: invoice.id }, _sum: { amountSdg: true }
  }))._sum.amountSdg), amount);
  assert.equal((await prisma.invoice.findUnique({ where: { id: invoice.id } })).paymentStatus, 'PAID');
  assert.equal(await prisma.tenantAuditLog.count({
    where: { action: 'PHARMACY_INVOICE_PAYMENT_RECORDED', details: { contains: invoice.id } }
  }), 1);
});

test('pharmacy payment audit failure rolls back payment, invoice state, and operation', async () => {
  const fixture = await createPrescriptionFixture({ paid: false });
  const created = await requestPharmacyInvoiceForFixture(fixture);
  assert.equal(created.status, 201);
  const invoice = created.body.invoice;
  const databaseMarker = `PHARMACY-POSTGRES-SECRET-${Date.now()}-${++fixtureCounter}`;
  const constraintMarker = `pharmacy_fake_constraint_${Date.now()}_${fixtureCounter}`;
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION reject_pharmacy_payment_audit() RETURNS trigger AS $$
    BEGIN
      IF NEW."action" = 'PHARMACY_INVOICE_PAYMENT_RECORDED' THEN
        RAISE EXCEPTION '${databaseMarker} | P2002 | SQL INSERT | ${constraintMarker}';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRaw`
    CREATE TRIGGER reject_pharmacy_payment_audit_trigger
    BEFORE INSERT ON "TenantAuditLog"
    FOR EACH ROW EXECUTE FUNCTION reject_pharmacy_payment_audit()
  `;
  try {
    const failed = await api.post(`/api/billing/invoice/${invoice.id}/payments`)
      .set(paymentAuth('pharmacy')).send({
        payments: [{ amountSdg: Number(invoice.totalAmountSdg), paymentMethod: 'CASH' }]
      });
    assert.equal(failed.status, 500);
    assert.deepEqual(failed.body, { error: 'Failed to record split payment.' });
    assertNoSensitiveErrorLeak(failed.body, [databaseMarker, constraintMarker]);
    assert.equal(await prisma.payment.count({ where: { invoiceId: invoice.id } }), 0);
    assert.equal(await prisma.paymentOperation.count({ where: { invoiceId: invoice.id } }), 0);
    assert.equal(await prisma.tenantAuditLog.count({
      where: { action: 'PHARMACY_INVOICE_PAYMENT_RECORDED', details: { contains: invoice.id } }
    }), 0);
    const persisted = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    assert.equal(persisted.paymentStatus, 'UNPAID');
    assert.equal(persisted.ledgerVersion, invoice.ledgerVersion);
  } finally {
    await prisma.$executeRaw`DROP TRIGGER IF EXISTS reject_pharmacy_payment_audit_trigger ON "TenantAuditLog"`;
    await prisma.$executeRaw`DROP FUNCTION IF EXISTS reject_pharmacy_payment_audit()`;
  }
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

  const invoiceResponse = await requestPharmacyInvoiceForFixture(fixture);

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
  const result = await ensurePharmacyInvoiceForPrescription({
    prescriptionId: fixture.rx.id,
    actorUserId: doctor1.userId,
    ipAddress: '127.0.0.1',
    trigger: 'INTEGRATION_TEST'
  });
  if (result.pending) {
    return {
      status: 409,
      body: { error: { code: result.code, message: result.message } }
    };
  }
  return {
    status: result.existing ? 200 : 201,
    body: result
  };
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

async function createAdditionalPaidPrescriptionForDrug({ drugId, patientId = patient2.id, qtyPrescribed = 5, unitPriceSdg = 2500 } = {}) {
  fixtureCounter += 1;
  const appointment = await prisma.appointment.create({
    data: {
      patientId,
      doctorId: doctor1.id,
      appointmentDate: `2032-03-${String(fixtureCounter).padStart(2, '0')}`,
      appointmentTime: '11:00',
      status: 'COMPLETED'
    }
  });
  const record = await prisma.medicalRecord.create({
    data: {
      patientId,
      doctorId: doctor1.id,
      appointmentId: appointment.id,
      symptomsEncrypted: '', diagnosisEncrypted: '', treatmentEncrypted: '', vitalSignsJson: '{}', clinicalNotesEncrypted: ''
    }
  });
  const prescription = await prisma.prescription.create({
    data: {
      medicalRecordId: record.id,
      patientId,
      doctorId: doctor1.id,
      prescribedDrugs: {
        create: {
          drugId,
          dosage: '1 daily',
          duration: '5 days',
          instructionsAr: '',
          instructionsEn: '',
          qtyPrescribed
        }
      }
    },
    include: { prescribedDrugs: true }
  });
  await prisma.invoice.create({
    data: {
      patientId,
      appointmentId: appointment.id,
      prescriptionId: prescription.id,
      invoiceType: 'PHARMACY',
      totalAmountSdg: unitPriceSdg * qtyPrescribed,
      totalAmountUsd: (unitPriceSdg * qtyPrescribed) / 1500,
      invoiceExchangeRate: 1500,
      paymentStatus: 'PAID',
      createdBy: 'integration-test-fixture',
      items: {
        create: {
          descriptionAr: 'دواء اختبار',
          descriptionEn: 'Fixture Drug',
          qty: qtyPrescribed,
          unitPriceSdg,
          unitPriceUsd: unitPriceSdg / 1500
        }
      }
    }
  });
  return { appointment, record, prescription, item: prescription.prescribedDrugs[0] };
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
  assert.match(healedPatient.fileNumber, /^SHF-\d+$/);
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
  assert.ok(await prisma.tenantAuditLog.findFirst({ where: { userId: user.id, action: 'PATIENT_FILE_CREATED', details: { contains: healedPatient.fileNumber } } }));
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
