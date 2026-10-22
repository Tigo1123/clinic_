import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import prisma from '../src/db.js';
import { app } from '../src/server.js';
import { usdFromSdg } from '../src/utils/money.js';

const api = request(app);
const tokens = {};
let specialty;
let patient;
let sequence = 0;
const unique = () => `${Date.now()}-${++sequence}`;
const auth = role => ({ Authorization: `Bearer ${tokens[role]}` });
const service = (category = 'CLINICAL_PROCEDURE') => { const suffix = unique(); return { code: `test-${suffix}`, labelAr: `خدمة اختبار ${suffix}`, labelEn: `Local service ${suffix}`, category, priceSdg: '17001', status: 'ACTIVE' }; };

before(async () => {
  for (const [role, username, password] of [['admin', 'admin@cms.com', 'Admin@123'], ['reception', 'recep@cms.com', 'Receptionist@123'], ['lab', 'lab@cms.com', 'Labtech@123'], ['doctor', 'doctor@cms.com', 'Doctor@123'], ['pharmacy', 'pharma@cms.com', 'Pharmacist@123']]) {
    const response = await api.post('/api/auth/login').send({ username, password });
    assert.equal(response.status, 200); tokens[role] = response.body.token;
  }
  specialty = await prisma.specialty.findUnique({ where: { code: 'internal-medicine' } });
  patient = await prisma.patient.create({ data: { fullNameAr: 'مريض محلي', fullNameEn: 'Local configuration patient', gender: 'MALE', dateOfBirth: '1990-01-01', phone: '+250788123499', addressStateId: 1, emergencyContact: 'Local fixture' } });
  const username = `patient-${unique()}@example.test`;
  const user = await prisma.user.create({ data: { username, email: username, emailVerifiedAt: new Date(), role: 'PATIENT', passwordHash: await bcrypt.hash('LocalPatient@123', 4) } });
  await prisma.patient.update({ where: { id: patient.id }, data: { userId: user.id } });
  const session = await api.post('/api/auth/login').send({ username, password: 'LocalPatient@123' }).expect(200);
  tokens.patient = session.body.token;
});
after(async () => { await prisma.$disconnect(); });

async function newDoctor() {
  const username = `doctor-${unique()}@example.test`;
  const response = await api.post('/api/auth/users').set(auth('admin')).send({ username, password: 'LocalDoctor@123', role: 'DOCTOR', fullNameAr: 'طبيب جديد', fullNameEn: 'New Local Doctor', specialtyId: specialty.id, consultationFee: 17001 });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return prisma.doctor.findFirst({ where: { user: { username } } });
}

test('new doctor has no arbitrary hours; explicit schedule permits booking; either deactivation preserves appointments', async () => {
  const doctor = await newDoctor();
  assert.deepEqual(JSON.parse(doctor.weeklySchedule), []);
  const date = '2035-09-17';
  const slots = () => api.get(`/api/appointments/slots?doctorId=${doctor.id}&date=${date}`);
  assert.deepEqual((await slots()).body, []);
  const schedule = await api.post(`/api/admin/doctors/${doctor.id}/schedules`).set(auth('admin')).send({ effectiveFrom: date, effectiveTo: null, active: true, periods: [{ dayOfWeek: 'MONDAY', startTime: '09:00', endTime: '10:00', slotDurationMinutes: 30, active: true, breaks: [] }] });
  assert.equal(schedule.status, 200, JSON.stringify(schedule.body));
  assert.deepEqual((await slots()).body, ['09:00', '09:30']);
  const booked = await api.post('/api/patient/appointments').set(auth('patient')).send({ doctorId: doctor.id, appointmentDate: date, appointmentTime: '09:00' }).expect(201);
  const appointment = booked.body;
  const disabled = await api.patch(`/api/admin/doctors/${doctor.id}`).set(auth('admin')).send({ status: 'INACTIVE', fullNameEn: 'Edited Local Doctor', specialtyId: specialty.id });
  assert.equal(disabled.status, 200); assert.equal(disabled.body.account.status, 'INACTIVE');
  assert.equal((await prisma.user.findUnique({ where: { id: doctor.userId } })).status, 'INACTIVE');
  assert.equal((await slots()).status, 404);
  await api.post('/api/patient/appointments').set(auth('patient')).send({ doctorId: doctor.id, appointmentDate: date, appointmentTime: '09:30' }).expect(404);
  assert.ok(!(await api.get('/api/patient/doctors').set(auth('patient'))).body.some(item => item.id === doctor.id));
  assert.ok(!(await api.get('/api/appointments/doctors')).body.some(item => item.id === doctor.id));
  assert.ok(await prisma.appointment.findUnique({ where: { id: appointment.id } }));
  await api.patch(`/api/admin/doctors/${doctor.id}`).set(auth('admin')).send({ status: 'ACTIVE' }).expect(200);
  await api.put(`/api/auth/users/${doctor.userId}/status`).set(auth('admin')).send({ status: 'INACTIVE' }).expect(200);
  assert.equal((await prisma.doctor.findUnique({ where: { id: doctor.id } })).status, 'INACTIVE');
  await api.put(`/api/auth/users/${doctor.userId}/status`).set(auth('admin')).send({ status: 'ACTIVE' }).expect(200);
  assert.deepEqual((await slots()).body, ['09:30']);
  assert.equal((await prisma.appointment.findUnique({ where: { id: appointment.id } })).status, appointment.status);
});

test('bookability checks account and specialty even for legacy inconsistent profile status', async () => {
  const doctor = await newDoctor();
  await prisma.doctor.update({ where: { id: doctor.id }, data: { weeklySchedule: '[{"day":"Monday","startTime":"09:00","endTime":"10:00","slotDurationInMinutes":30}]' } });
  await prisma.user.update({ where: { id: doctor.userId }, data: { status: 'INACTIVE' } });
  await api.get(`/api/appointments/slots?doctorId=${doctor.id}&date=2035-09-17`).expect(404);
  assert.ok(!(await api.get('/api/appointments/doctors')).body.some(item => item.id === doctor.id));
});

test('specialties reject duplicate normalized names/codes and referenced deletion, and support archive/edit', async () => {
  const suffix = unique();
  const payload = { code: `specialty-${suffix}`, nameAr: `تخصص ${suffix}`, nameEn: `Specialty ${suffix}`, active: true };
  const created = await api.post('/api/specialties').set(auth('admin')).send(payload).expect(201);
  await api.post('/api/specialties').set(auth('admin')).send({ ...payload, code: `other-${suffix}`, nameEn: ` ${payload.nameEn.toUpperCase()} ` }).expect(409);
  await api.post('/api/specialties').set(auth('admin')).send({ ...payload, nameAr: `آخر ${suffix}`, nameEn: `Different ${suffix}` }).expect(409);
  const doctor = await newDoctor();
  await api.patch(`/api/admin/doctors/${doctor.id}`).set(auth('admin')).send({ specialtyId: created.body.id }).expect(200);
  await api.delete(`/api/specialties/${created.body.id}`).set(auth('admin')).expect(409);
  await api.patch(`/api/specialties/${created.body.id}`).set(auth('admin')).send({ ...payload, nameEn: `Edited ${suffix}`, active: false }).expect(200);
  await api.get(`/api/appointments/slots?doctorId=${doctor.id}&date=2035-09-17`).expect(404);
  const unreferenced = await api.post('/api/specialties').set(auth('admin')).send({ code: `unused-${suffix}`, nameAr: `غير مستخدم ${suffix}`, nameEn: `Unused ${suffix}` }).expect(201);
  await api.delete(`/api/specialties/${unreferenced.body.id}`).set(auth('admin')).expect(204);
});

for (const category of ['CONSULTATION', 'CLINICAL_PROCEDURE', 'RADIOLOGY', 'LABORATORY']) test(`${category}: create/edit/archive, exact price conversion, duplicate protection and invoice preservation`, async () => {
  const payload = service(category);
  const created = await api.post('/api/admin/catalog/services').set(auth('admin')).send(payload).expect(201);
  const stored = await prisma.clinicalService.findUnique({ where: { id: created.body.id } });
  assert.equal(stored.baseFeeSdg.toString(), '17001');
  assert.equal(stored.baseFeeUsd.toString(), usdFromSdg('17001').toString());
  await api.post('/api/admin/catalog/services').set(auth('admin')).send(payload).expect(409);
  await api.post('/api/admin/catalog/services').set(auth('admin')).send({ ...payload, code: `other-${unique()}`, labelEn: ` ${payload.labelEn.toUpperCase()} ` }).expect(409);
  const invoice = await prisma.invoice.create({ data: { patientId: patient.id, totalAmountSdg: '17001', totalAmountUsd: usdFromSdg('17001'), invoiceExchangeRate: '1500', createdBy: crypto.randomUUID(), items: { create: { descriptionAr: payload.labelAr, descriptionEn: payload.labelEn, unitPriceSdg: '17001', unitPriceUsd: usdFromSdg('17001') } } }, include: { items: true } });
  await api.patch(`/api/admin/catalog/services/${stored.id}`).set(auth('admin')).send({ labelEn: `Edited ${payload.labelEn}`, priceSdg: '19001', status: 'INACTIVE' }).expect(200);
  assert.ok(!(await api.get('/api/billing/services')).body.some(item => item.id === stored.id));
  assert.deepEqual((await prisma.invoice.findUnique({ where: { id: invoice.id }, include: { items: true } })).items, invoice.items);
  await api.post('/api/billing/invoice').set(auth('reception')).send({ patientId: patient.id, invoiceType: 'GENERAL', items: [{ serviceId: stored.id, quantity: 1 }] }).expect(404);
  await api.patch(`/api/admin/catalog/services/${stored.id}`).set(auth('admin')).send({ category: 'CONSULTATION' }).expect(422);
});

test('catalog rejects invalid prices, unsupported metadata and non-admin roles; list is filtered and paginated', async () => {
  for (const priceSdg of ['0', '-1', '1.5', 'NaN', '1000000001']) await api.post('/api/admin/catalog/services').set(auth('admin')).send({ ...service(), priceSdg }).expect(422);
  await api.post('/api/admin/catalog/services').set(auth('admin')).send({ ...service('LABORATORY'), referenceRangeMin: 5 }).expect(422);
  for (const role of ['doctor', 'reception', 'lab', 'pharmacy']) {
    await api.post('/api/admin/catalog/services').set(auth(role)).send(service()).expect(403);
    await api.patch('/api/admin/catalog/payment-methods/CASH').set(auth(role)).send({ active: false }).expect(403);
  }
  await api.get('/api/admin/catalog/services').expect(401);
  const page = await api.get('/api/admin/catalog/services?page=1&pageSize=2&category=LABORATORY').set(auth('admin')).expect(200);
  assert.ok(page.body.items.length <= 2); assert.ok(page.body.items.every(item => item.category === 'LABORATORY'));
});

test('inactive payment methods cannot receive new money; existing history and idempotent payment replay survive', async () => {
  const invoice = await prisma.invoice.create({ data: { patientId: patient.id, totalAmountSdg: '200', totalAmountUsd: usdFromSdg('200'), invoiceExchangeRate: '1500', createdBy: crypto.randomUUID() } });
  const key = `method-test-${unique()}`;
  const payload = { payments: [{ amountSdg: 100, paymentMethod: 'CARD', transactionReference: `pos-${unique()}` }] };
  await api.post(`/api/billing/invoice/${invoice.id}/payments`).set({ ...auth('reception'), 'Idempotency-Key': key }).send(payload).expect(200);
  await api.patch('/api/admin/catalog/payment-methods/CARD').set(auth('admin')).send({ active: false, labelEn: 'Card / POS manual' }).expect(200);
  assert.ok(!(await api.get('/api/billing/payment-methods').set(auth('reception'))).body.some(item => item.code === 'CARD'));
  await api.post(`/api/billing/invoice/${invoice.id}/payments`).set({ ...auth('reception'), 'Idempotency-Key': key }).send(payload).expect(200);
  await api.post(`/api/billing/invoice/${invoice.id}/payments`).set({ ...auth('reception'), 'Idempotency-Key': `new-${unique()}` }).send({ payments: [{ amountSdg: 100, paymentMethod: 'CARD' }] }).expect(409);
  assert.equal(await prisma.payment.count({ where: { invoiceId: invoice.id } }), 1);
  const all = await api.get('/api/admin/catalog/payment-methods').set(auth('admin')).expect(200);
  assert.equal(all.body.find(item => item.code === 'CARD').active, false);
  await api.patch('/api/admin/catalog/payment-methods/CARD').set(auth('admin')).send({ active: true }).expect(200);
  await api.post(`/api/billing/invoice/${invoice.id}/payments`).set({ ...auth('reception'), 'Idempotency-Key': `enabled-${unique()}` }).send({ payments: [{ amountSdg: 100, paymentMethod: 'CARD' }] }).expect(200);
  assert.equal((await prisma.invoice.findUnique({ where: { id: invoice.id } })).paymentStatus, 'PAID');
  await api.patch('/api/admin/catalog/payment-methods/CARD').set(auth('admin')).send({ cardNumber: 'not-accepted' }).expect(422);
});
