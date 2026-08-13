import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import prisma from '../src/db.js';
import { app, httpServer } from '../src/server.js';

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
});

test('staff login rejects invalid credentials', async () => {
  const response = await api.post('/api/auth/login').send({ username: 'admin@cms.com', password: 'wrong-password' });
  assert.equal(response.status, 401);
});

test('admin can list staff and pharmacist cannot', async () => {
  assert.equal((await api.get('/api/auth/users').set(auth('admin'))).status, 200);
  assert.equal((await api.get('/api/auth/users').set(auth('pharmacy'))).status, 403);
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

test('lab queue is lab-only', async () => {
  assert.equal((await api.get('/api/records/lab-orders/pending').set(auth('lab'))).status, 200);
  assert.equal((await api.get('/api/records/lab-orders/pending').set(auth('pharmacy'))).status, 403);
});

test('lab results persist and complete the order', async () => {
  const record = await prisma.medicalRecord.findUnique({ where: { appointmentId: relatedAppointment.id } });
  const order = await prisma.labOrder.create({ data: { medicalRecordId: record.id, patientId: patient1.id, doctorId: doctor1.id, status: 'PAID', items: { create: { serviceId: service.id } } }, include: { items: true } });
  const response = await api.put(`/api/records/lab-orders/items/${order.items[0].id}/results`).set(auth('lab')).send({ resultValue: '13.5', referenceRangeMin: 12, referenceRangeMax: 16, isOutOfRange: false });
  assert.equal(response.status, 200);
  assert.equal((await prisma.labOrder.findUnique({ where: { id: order.id } })).status, 'COMPLETED');
});

test('pharmacy dispensing rejects negative quantity', async () => {
  const fixture = await createPrescriptionFixture();
  const response = await api.post(`/api/records/prescriptions/${fixture.rx.id}/dispense`).set(auth('pharmacy')).send({ items: [{ prescribedDrugId: fixture.item.id, qtyToDispense: -1, batchId: fixture.early.id }] });
  assert.notEqual(response.status, 200);
});

test('pharmacy dispensing enforces batch-drug relationship and FEFO', async () => {
  const fixture = await createPrescriptionFixture();
  const otherDrug = await prisma.drugFormulary.create({ data: { labelAr: 'آخر', labelEn: 'Other', genericName: `Other-${Date.now()}`, strength: '1mg', dosageForm: 'Tablet' } });
  const wrong = await prisma.inventoryBatch.create({ data: { drugId: otherDrug.id, batchNumber: `WRONG-${Date.now()}`, expiryDate: '2030-01-01', qtyOnHand: 20 } });
  assert.notEqual((await api.post(`/api/records/prescriptions/${fixture.rx.id}/dispense`).set(auth('pharmacy')).send({ items: [{ prescribedDrugId: fixture.item.id, qtyToDispense: 1, batchId: wrong.id }] })).status, 200);
  assert.notEqual((await api.post(`/api/records/prescriptions/${fixture.rx.id}/dispense`).set(auth('pharmacy')).send({ items: [{ prescribedDrugId: fixture.item.id, qtyToDispense: 1, batchId: fixture.late.id }] })).status, 200);
});

test('pharmacy dispensing prevents over-dispensing and deducts valid FEFO stock', async () => {
  const fixture = await createPrescriptionFixture();
  assert.notEqual((await api.post(`/api/records/prescriptions/${fixture.rx.id}/dispense`).set(auth('pharmacy')).send({ items: [{ prescribedDrugId: fixture.item.id, qtyToDispense: 11, batchId: fixture.early.id }] })).status, 200);
  const response = await api.post(`/api/records/prescriptions/${fixture.rx.id}/dispense`).set(auth('pharmacy')).send({ items: [{ prescribedDrugId: fixture.item.id, qtyToDispense: 10, batchId: fixture.early.id }] });
  assert.equal(response.status, 200);
  assert.equal((await prisma.inventoryBatch.findUnique({ where: { id: fixture.early.id } })).qtyOnHand, 10);
});

test('billing is restricted and split payments set partial then paid', async () => {
  assert.equal((await api.post('/api/billing/invoice').set(auth('pharmacy')).send({ patientId: patient1.id, items: [{ descriptionAr: 'x', descriptionEn: 'x', qty: 1, unitPriceSdg: 100 }] })).status, 403);
  const invoiceResponse = await api.post('/api/billing/invoice').set(auth('reception')).send({ patientId: patient1.id, items: [{ descriptionAr: 'اختبار', descriptionEn: 'Test', qty: 1, unitPriceSdg: 100 }] });
  assert.equal(invoiceResponse.status, 201);
  const id = invoiceResponse.body.invoice.id;
  const partial = await api.post(`/api/billing/invoice/${id}/payments`).set(auth('reception')).send({ payments: [{ amountSdg: 40, paymentMethod: 'CASH' }] });
  assert.equal(partial.body.paymentStatus, 'PARTIALLY_PAID');
  assert.equal(partial.body.remainingBalanceSdg, 60);
  const paid = await api.post(`/api/billing/invoice/${id}/payments`).set(auth('reception')).send({ payments: [{ amountSdg: 60, paymentMethod: 'CARD', transactionReference: `TEST-${Date.now()}` }] });
  assert.equal(paid.body.paymentStatus, 'PAID');
  assert.equal(paid.body.remainingBalanceSdg, 0);
});

test('billing rejects zero, negative, and overpayments', async () => {
  const invoice = await prisma.invoice.create({ data: { patientId: patient1.id, totalAmountSdg: 100, totalAmountUsd: 1, invoiceExchangeRate: 100, createdBy: 'test' } });
  for (const amount of [0, -1, 101]) {
    const response = await api.post(`/api/billing/invoice/${invoice.id}/payments`).set(auth('reception')).send({ payments: [{ amountSdg: amount, paymentMethod: 'CASH' }] });
    assert.notEqual(response.status, 200);
  }
});

test('appointments reject past dates and invalid slots', async () => {
  assert.equal((await api.get(`/api/appointments/slots?doctorId=${doctor1.id}&date=2020-01-01`)).status, 422);
  const response = await api.post('/api/appointments/book').send(bookingPayload('2030-01-06', '03:00', '0991000010'));
  assert.equal(response.status, 422);
});

test('concurrent booking allows exactly one reservation per active doctor slot', async () => {
  const date = '2030-01-13';
  const payload = bookingPayload(date, '10:00', '0991000011');
  const responses = await Promise.all([api.post('/api/appointments/book').send(payload), api.post('/api/appointments/book').send(payload)]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
});

test('debug notification endpoint is absent', async () => {
  assert.equal((await api.post('/api/test-notification').send({ userId: 'x', title: 'x', message: 'x' })).status, 404);
});

test('legacy static attachment URL is not exposed', async () => {
  assert.equal((await api.get('/uploads/secret.pdf')).status, 404);
});

async function createPrescriptionFixture() {
  fixtureCounter += 1;
  const fixtureDrug = await prisma.drugFormulary.create({ data: { labelAr: 'دواء اختبار', labelEn: 'Fixture Drug', genericName: `Fixture-${fixtureCounter}-${Date.now()}`, strength: '1mg', dosageForm: 'Tablet' } });
  const appointment = await prisma.appointment.create({ data: { patientId: patient1.id, doctorId: doctor1.id, appointmentDate: `2031-02-${String(fixtureCounter).padStart(2, '0')}`, appointmentTime: '10:00', status: 'COMPLETED' } });
  const record = await prisma.medicalRecord.create({ data: { patientId: patient1.id, doctorId: doctor1.id, appointmentId: appointment.id, symptomsEncrypted: '', diagnosisEncrypted: '', treatmentEncrypted: '', vitalSignsJson: '{}', clinicalNotesEncrypted: '' } });
  const rx = await prisma.prescription.create({ data: { medicalRecordId: record.id, patientId: patient1.id, doctorId: doctor1.id, prescribedDrugs: { create: { drugId: fixtureDrug.id, dosage: '1 daily', duration: '10 days', instructionsAr: '', instructionsEn: '', qtyPrescribed: 10 } } }, include: { prescribedDrugs: true } });
  const suffix = `${Date.now()}-${Math.random()}`;
  const early = await prisma.inventoryBatch.create({ data: { drugId: fixtureDrug.id, batchNumber: `EARLY-${suffix}`, expiryDate: '2029-01-01', qtyOnHand: 20 } });
  const late = await prisma.inventoryBatch.create({ data: { drugId: fixtureDrug.id, batchNumber: `LATE-${suffix}`, expiryDate: '2030-01-01', qtyOnHand: 20 } });
  return { rx, item: rx.prescribedDrugs[0], early, late };
}

function bookingPayload(date, time, phone) {
  return { doctorId: doctor1.id, appointmentDate: date, appointmentTime: time, fullNameAr: 'مريض حجز', fullNameEn: 'Booking Patient', gender: 'MALE', dateOfBirth: '1990-01-01', phone, addressStateId: 1, otpCode: '1234' };
}
