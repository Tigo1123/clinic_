import test, { before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import nodemailer from 'nodemailer';
import prisma from '../src/db.js';
import appointments from '../src/routes/appointments.js';
import { sendBookingConfirmation, sendStatusUpdateNotification } from '../src/utils/notifications.js';
import { structuredPatientName } from '../src/utils/patientName.js';
import { isolatedDatabaseUrl } from './helpers/testRunner.js';

// Never run these fixtures against an application database, even directly.
isolatedDatabaseUrl(process.env.DATABASE_URL, 'test_notification_guard', process.env.TEST_DATABASE_PORT || '5433');
assert.match(new URL(process.env.DATABASE_URL).searchParams.get('schema'), /^test_/);
const app = express();
app.use(express.json());
app.use('/api/appointments', appointments);
const originalEnv = { ...process.env };
let doctor; let sequence = 0; let delivered = [];
const parts = { firstNameAr: 'اختبار', fatherNameAr: 'بريد', grandfatherNameAr: 'موعد', familyNameAr: 'تجريبي', firstNameEn: 'Synthetic', fatherNameEn: 'Email', grandfatherNameEn: 'Appointment', familyNameEn: 'Test' };
const smtp = { SMTP_HOST: 'smtp.invalid', SMTP_USER: 'synthetic', SMTP_PASS: 'synthetic-test-only', SMTP_FROM_EMAIL: 'clinic@example.invalid' };
before(async () => {
  await prisma.state.upsert({ where: { id: 1 }, update: {}, create: { id: 1, labelAr: 'اختبار', labelEn: 'Test' } });
  doctor = await prisma.doctor.create({ data: {
    user: { create: { username: 'notification-doctor', passwordHash: 'unused-test-hash', role: 'DOCTOR' } },
    fullNameAr: 'طبيب اختبار', fullNameEn: 'Test Doctor', specialtyAr: 'اختبار', specialtyEn: 'Test', consultationFee: 10, weeklySchedule: '{}',
    schedules: { create: { effectiveFrom: '2099-01-01', periods: { create: { dayOfWeek: 'MONDAY', startTime: '09:00', endTime: '12:00', slotDurationMinutes: 30 } } } }
  } });
});
const prismaMockRestorers = [];

function mockPrismaMethod(delegate, name, implementation) {
  const original = delegate[name];
  assert.equal(typeof original, 'function');
  const replacement = mock.fn(implementation);
  prismaMockRestorers.push(() => { delegate[name] = original; });
  delegate[name] = replacement;
  assert.equal(delegate[name], replacement);
  return replacement;
}

afterEach(() => {
  while (prismaMockRestorers.length) prismaMockRestorers.pop()();
  mock.restoreAll();
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});
after(async () => { await prisma.$disconnect(); });
function delivery({ fail = false } = {}) {
  delivered = [];
  Object.assign(process.env, smtp, { NOTIFICATIONS_DISABLED: 'false' });
  return mock.method(nodemailer, 'createTransport', () => ({ sendMail: async mail => {
    delivered.push(mail);
    if (fail) throw new Error('simulated delivery failure');
    return { messageId: 'synthetic-message' };
  } }));
}
async function patient(email, linked = true) {
  const number = ++sequence;
  return prisma.patient.create({ data: {
    ...structuredPatientName(parts), gender: 'MALE', dateOfBirth: '1990-01-01',
    nationalId: `NOTIFICATION-TEST-${number}`, phone: `+25078890${String(number).padStart(4, '0')}`,
    addressState: { connect: { id: 1 } }, emergencyContact: 'Self',
    ...(linked ? { user: { create: { username: `notification-patient-${number}`, passwordHash: 'unused-test-hash', role: 'PATIENT', email } } } : {})
  } });
}
function appointment(p) {
  return { id: 'synthetic-appointment', patientId: p.id, patient: { ...p, phone: '' }, doctor, appointmentDate: '2099-01-05', appointmentTime: '09:00' };
}

test('booking email resolves the correct linked patient User, not supplied patient/doctor email', async () => {
  delivery();
  const p = await patient('correct-patient@example.invalid');
  await patient('other-patient@example.invalid');
  const input = appointment(p);
  input.patient.email = 'wrong-field@example.invalid';
  input.patient.user = { email: 'untrusted-projection@example.invalid' };
  await sendBookingConfirmation(input);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].to, 'correct-patient@example.invalid');
});
for (const [label, linked, email] of [['no linked account', false, undefined], ['null email', true, null], ['empty email', true, '']]) {
  test(`booking with ${label} skips email and retains WhatsApp links`, async () => {
    const transport = delivery();
    const p = await patient(email, linked);
    const input = appointment(p);
    input.patient.email = 'must-not-fallback@example.invalid';
    const result = await sendBookingConfirmation(input);
    assert.equal(transport.mock.callCount(), 0);
    assert.equal(typeof result.whatsAppLinkEn, 'string');
  });
}
test('disabled notifications skip account lookup, transport and notification logs', async () => {
  const transport = delivery();
  const p = await patient('disabled@example.invalid');
  process.env.NOTIFICATIONS_DISABLED = 'true';
  const lookup = mockPrismaMethod(prisma.patient, 'findUnique', () => { throw new Error('disabled lookup'); });
  const logs = mockPrismaMethod(prisma.notificationLog, 'create', () => { throw new Error('disabled log'); });
  const input = appointment(p);
  input.patient.phone = p.phone;
  const result = await sendBookingConfirmation(input);
  assert.ok(result.whatsAppLinkEn.startsWith('https://wa.me/'));
  assert.equal(lookup.mock.callCount(), 0);
  assert.equal(logs.mock.callCount(), 0);
  assert.equal(transport.mock.callCount(), 0);
});
test('missing patient row skips email without trusting a stale projection', async () => {
  const transport = delivery();
  const input = appointment({ id: '00000000-0000-0000-0000-000000000012' });
  input.patient.user = { email: 'stale@example.invalid' };
  assert.ok((await sendBookingConfirmation(input)).smsTextEn);
  assert.equal(transport.mock.callCount(), 0);
});
test('recipient lookup failure is best effort', async () => {
  const transport = delivery();
  const p = await patient('lookup@example.invalid');
  mockPrismaMethod(prisma.patient, 'findUnique', async () => { throw new Error('simulated lookup failure'); });
  assert.ok((await sendBookingConfirmation(appointment(p))).smsTextEn);
  assert.equal(transport.mock.callCount(), 0);
});
for (const loggingFails of [false, true]) {
  test(`delivery failure preserves HTTP booking success and committed appointment (log failure: ${loggingFails})`, async () => {
    delivery({ fail: true });
    const p = await patient(`failure-${loggingFails}@example.invalid`);
    // SMS has no delivery provider. A failed SMS log must also remain
    // contained after the booking transaction; no real messaging occurs.
    const createLog = prisma.notificationLog.create.bind(prisma.notificationLog);
    mockPrismaMethod(prisma.notificationLog, 'create', async args => {
      if (args.data.messageType === 'SMS') throw new Error('simulated SMS-log failure');
      if (loggingFails) throw new Error('simulated email-log failure');
      return createLog(args);
    });
    const otp = await request(app).post('/api/appointments/otp/request').send({ phone: p.phone });
    assert.equal(otp.status, 200);
    const time = loggingFails ? '09:30' : '09:00';
    const booked = await request(app).post('/api/appointments/book').send({
      ...parts, gender: p.gender, dateOfBirth: p.dateOfBirth, nationalId: p.nationalId,
      phone: p.phone, addressStateId: 1, doctorId: doctor.id,
      appointmentDate: '2099-01-05', appointmentTime: time, otpCode: otp.body.developmentCode
    });
    assert.equal(booked.status, 201);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].to, `failure-${loggingFails}@example.invalid`);
    const stored = await prisma.appointment.findFirst({ where: { patientId: p.id, appointmentDate: '2099-01-05', appointmentTime: time } });
    assert.ok(stored);
    assert.equal(stored.status, 'PENDING');
    const reception = await prisma.user.findFirstOrThrow({ where: { role: 'RECEPTIONIST', status: 'ACTIVE' } });
    assert.equal(await prisma.notification.count({ where: { userId: reception.id, entityId: stored.id, type: 'APPOINTMENT_BOOKED' } }), 1);
    assert.equal(booked.body.patient?.user, undefined);
    assert.equal(JSON.stringify(booked.body).includes('@example.invalid'), false);
    const replay = await request(app).post('/api/appointments/book').send({
      ...parts, gender: p.gender, dateOfBirth: p.dateOfBirth, nationalId: p.nationalId,
      phone: p.phone, addressStateId: 1, doctorId: doctor.id,
      appointmentDate: '2099-01-05', appointmentTime: time, otpCode: otp.body.developmentCode
    });
    assert.equal(replay.status, 400);
  });
}

test('pre-commit booking failure releases only its reservation so a valid retry can proceed', async () => {
  const p = await patient('precommit@example.invalid');
  const otp = await request(app).post('/api/appointments/otp/request').send({ phone: p.phone });
  assert.equal(otp.status, 200);
  const base = { ...parts, gender: p.gender, dateOfBirth: p.dateOfBirth, nationalId: p.nationalId, phone: p.phone, addressStateId: 1, doctorId: doctor.id, appointmentDate: '2099-01-12', otpCode: otp.body.developmentCode };
  const invalid = await request(app).post('/api/appointments/book').send({ ...base, appointmentTime: '14:00' });
  assert.equal(invalid.status, 422);
  const valid = await request(app).post('/api/appointments/book').send({ ...base, appointmentTime: '09:00' });
  assert.equal(valid.status, 201);
  const replay = await request(app).post('/api/appointments/book').send({ ...base, appointmentTime: '09:30' });
  assert.equal(replay.status, 400);
});

test('concurrent public booking attempts cannot reuse the same OTP for two appointments', async () => {
  const p = await patient('concurrent-otp@example.invalid');
  const otp = await request(app).post('/api/appointments/otp/request').send({ phone: p.phone });
  assert.equal(otp.status, 200);
  const payload = (time) => ({ ...parts, gender: p.gender, dateOfBirth: p.dateOfBirth, nationalId: p.nationalId, phone: p.phone, addressStateId: 1, doctorId: doctor.id, appointmentDate: '2099-01-19', appointmentTime: time, otpCode: otp.body.developmentCode });
  const responses = await Promise.all([
    request(app).post('/api/appointments/book').send(payload('09:00')),
    request(app).post('/api/appointments/book').send(payload('09:30'))
  ]);
  assert.deepEqual(responses.map(({ status }) => status).sort(), [201, 400]);
  assert.equal(await prisma.appointment.count({ where: { patientId: p.id, appointmentDate: '2099-01-19' } }), 1);
});
test('status notifications retain existing SMS/WhatsApp behavior without adding email', async () => {
  const transport = delivery();
  const p = await patient('status@example.invalid');
  const result = await sendStatusUpdateNotification(appointment(p), 'CONFIRMED');
  assert.ok(result.messageEn.includes('CONFIRMED'));
  assert.equal(transport.mock.callCount(), 0);
});
