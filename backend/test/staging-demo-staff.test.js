import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { DateTime } from 'luxon';
import prisma from '../src/db.js';
import { app, shutdown } from '../src/server.js';
import { doctors, staff, specialties, seedDemoStaff, validateDemoEnvironment } from '../scripts/staging-demo-staff.js';

const password = `${randomBytes(24).toString('hex')}aA1`;
const env = {
  ...process.env, DEPLOYMENT_ENV: 'staging', DEMO_SEED_ENABLED: 'true',
  DEMO_STAFF_DATABASE_URL: process.env.DATABASE_URL,
  DEMO_STAFF_CONFIRM_DATABASE: decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1)),
  DEMO_STAFF_PASSWORD: password
};
const api = request(app);
after(async () => { await shutdown(); });
const snapshot = async () => ({
  users: await prisma.user.findMany({ orderBy: { id: 'asc' } }),
  doctors: await prisma.doctor.findMany({ orderBy: { id: 'asc' } }),
  schedules: await prisma.doctorSchedule.findMany({ orderBy: { id: 'asc' }, include: { periods: { orderBy: { id: 'asc' } } } }),
  specialties: await prisma.specialty.findMany({ orderBy: { id: 'asc' } })
});

test('staging gate rejects production, missing opt-in, missing password and wrong target', () => {
  for (const patch of [
    { NODE_ENV: 'production' }, { DEPLOYMENT_ENV: 'production' }, { APP_ENV: 'prod' },
    { ENVIRONMENT: ' Production ' }, { DEMO_SEED_ENABLED: '' }, { DEMO_STAFF_PASSWORD: '' },
    { DEMO_STAFF_CONFIRM_DATABASE: 'wrong' }, { DEMO_STAFF_DATABASE_URL: '' },
    { DEMO_STAFF_DATABASE_URL: 'postgresql://localhost/production', DEMO_STAFF_CONFIRM_DATABASE: 'production' }
  ]) assert.throws(() => validateDemoEnvironment({ ...env, ...patch }));
});

test('CLI seeds 13 accounts, 10 linked doctors, 10 specialties and 21 schedule periods; rerun preserves IDs', async () => {
  const run = () => spawnSync(process.execPath, ['scripts/seed-staging-demo-staff.js'], { env, encoding: 'utf8' });
  const before = await snapshot();
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout.includes(password), false);
  assert.equal(/passwordHash|\$2[aby]\$/.test(first.stdout + first.stderr), false);
  assert.deepEqual(JSON.parse(first.stdout), { event: 'staging_demo_staff_ready', users: 13, doctors: 10, specialties: 10, schedules: 10, periods: 21 });
  const seeded = await snapshot();
  assert.equal(run().status, 0);
  const repeated = await snapshot();
  for (const key of ['users', 'doctors', 'specialties', 'schedules']) assert.deepEqual(repeated[key].map((x) => x.id), seeded[key].map((x) => x.id));
  assert.deepEqual(repeated.schedules, seeded.schedules);
  for (const old of before.users) assert.ok(JSON.stringify(repeated.users.find((u) => u.id === old.id)) === JSON.stringify(old), 'Existing user unchanged');
  for (const old of before.doctors) assert.deepEqual(repeated.doctors.find((d) => d.id === old.id), old);
  for (const item of staff) {
    const user = repeated.users.find((u) => u.username === item.email);
    assert.equal(user.email, item.email); assert.equal(user.role, item.role);
    assert.equal(user.status, 'ACTIVE'); assert.equal(user.mustChangePassword, false);
    assert.ok(user.lastPasswordChange);
  }
  for (const item of specialties) assert.equal(repeated.specialties.filter((s) => s.code === item.code && s.active).length, 1);
  assert.equal(repeated.doctors.length - before.doctors.length, 10);
  for (const code of ['PED', 'OBG', 'ENT', 'DERM', 'OPH']) {
    const specialty = repeated.specialties.find((s) => s.code === code);
    assert.ok(specialty?.active);
    assert.equal(repeated.doctors.filter((d) => d.specialtyId === specialty.id).length, 0);
  }
  for (const { deletionProtected: _oldProtection, ...old } of before.specialties) {
    const { deletionProtected: _newProtection, ...current } = repeated.specialties.find((s) => s.id === old.id);
    assert.deepEqual(current, old); // Assigning demo doctors intentionally marks their specialties as used.
  }
  for (const item of doctors) {
    const user = repeated.users.find((u) => u.username === item.email);
    const profiles = repeated.doctors.filter((d) => d.userId === user.id);
    assert.equal(profiles.length, 1); assert.equal(profiles[0].status, 'ACTIVE');
    assert.equal(profiles[0].fullNameEn, item.fullNameEn);
    assert.equal(profiles[0].specialtyId, repeated.specialties.find((s) => s.code === item.specialtyCode).id);
  }
});

test('all demo roles log in immediately and receive usable authenticated sessions', async () => {
  for (const item of staff) {
    const response = await api.post('/api/auth/login').send({ username: item.email, password });
    assert.equal(response.status, 200, item.email);
    assert.ok(response.body.token, item.email);
    assert.equal(response.body.user.mustChangePassword, false);
    assert.equal(response.body.user.role, item.role);
    const me = await api.get('/api/notifications').set('Authorization', `Bearer ${response.body.token}`);
    assert.equal(me.status, 200, item.email);
    assert.equal(JSON.stringify(me.body).includes('passwordHash'), false);
  }
});

test('public discovery exposes all 10 doctors and slots match every scheduled weekday', async () => {
  const response = await api.get('/api/appointments/doctors');
  assert.equal(response.status, 200);
  for (const item of doctors) {
    const doctor = await prisma.doctor.findFirst({ where: { user: { username: item.email } } });
    assert.ok(response.body.some((d) => d.id === doctor.id));
    const start = DateTime.now().setZone(env.CLINIC_TIME_ZONE || 'Africa/Khartoum').plus({ days: 7 }).startOf('day');
    for (let i = 0; i < 7; i++) {
      const date = start.plus({ days: i });
      const slots = await api.get('/api/appointments/slots').query({ doctorId: doctor.id, date: date.toISODate() });
      assert.equal(slots.status, 200);
      const expected = [];
      if (item.days.includes(date.setLocale('en').toFormat('cccc').toUpperCase())) {
        for (let time = DateTime.fromISO(`${date.toISODate()}T${item.startTime}`); time.toFormat('HH:mm') < item.endTime; time = time.plus({ minutes: 30 })) expected.push(time.toFormat('HH:mm'));
      }
      assert.deepEqual(slots.body, expected);
    }
  }
});

test('account and schedule conflicts roll back without altering existing data', async () => {
  const user = await prisma.user.findUnique({ where: { username: staff[0].email } });
  await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
  let before = await snapshot();
  await assert.rejects(seedDemoStaff(prisma, env), /Account conflict/);
  assert.ok(JSON.stringify(await snapshot()) === JSON.stringify(before), 'Account conflict rolls back all writes');
  await prisma.user.update({ where: { id: user.id }, data: { role: user.role } });
  const doctor = await prisma.doctor.findFirst({ where: { user: { username: doctors[9].email } } });
  const period = await prisma.doctorSchedulePeriod.findFirst({ where: { schedule: { doctorId: doctor.id } } });
  await prisma.doctorSchedulePeriod.update({ where: { id: period.id }, data: { startTime: '07:00' } });
  before = await snapshot();
  await assert.rejects(seedDemoStaff(prisma, env), /Schedule conflict/);
  assert.ok(JSON.stringify(await snapshot()) === JSON.stringify(before), 'Schedule conflict rolls back all writes');
  await prisma.doctorSchedulePeriod.update({ where: { id: period.id }, data: { startTime: period.startTime } });
});

test('rerun preserves clinical history, bookings, and schedule exceptions', async () => {
  const doctor = await prisma.doctor.findFirst({ where: { user: { username: doctors[0].email } } });
  const state = await prisma.state.upsert({ where: { id: 1 }, update: {}, create: { id: 1, labelAr: 'اختبار', labelEn: 'Test' } });
  const patient = await prisma.patient.create({ data: { fullNameAr: 'اختبار', fullNameEn: 'Demo Seed Preservation Test', gender: 'MALE', dateOfBirth: '1990-01-01', phone: '+249911111111', addressStateId: state.id, emergencyContact: 'Test' } });
  const appointment = await prisma.appointment.create({ data: { doctorId: doctor.id, patientId: patient.id, appointmentDate: '2020-01-01', appointmentTime: '09:00', status: 'COMPLETED' } });
  const record = await prisma.medicalRecord.create({ data: { doctorId: doctor.id, patientId: patient.id, appointmentId: appointment.id, symptomsEncrypted: 'test', diagnosisEncrypted: 'test', treatmentEncrypted: 'test', vitalSignsJson: '{}', clinicalNotesEncrypted: 'test' } });
  const prescription = await prisma.prescription.create({ data: { doctorId: doctor.id, patientId: patient.id, medicalRecordId: record.id } });
  const lab = await prisma.labOrder.create({ data: { doctorId: doctor.id, patientId: patient.id, medicalRecordId: record.id } });
  const exception = await prisma.doctorScheduleException.create({ data: { doctorId: doctor.id, date: '2020-01-02', type: 'FULL_DAY_LEAVE' } });
  await seedDemoStaff(prisma, env);
  for (const [model, original] of [[prisma.patient, patient], [prisma.appointment, appointment], [prisma.medicalRecord, record], [prisma.prescription, prescription], [prisma.labOrder, lab], [prisma.doctorScheduleException, exception]]) {
    assert.deepEqual(await model.findUnique({ where: { id: original.id } }), original);
  }
});
