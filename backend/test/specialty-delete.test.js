import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import request from 'supertest';
import prisma from '../src/db.js';
import { app, shutdown } from '../src/server.js';
import { signAccessToken } from '../src/services/accessTokens.js';

const api = request(app);
let admin;
const tokens = {};
const auth = (token = admin) => ({ Authorization: `Bearer ${token}` });
const createSpecialty = () => prisma.specialty.create({ data: { code: `delete-${randomUUID()}`, nameEn: `Unused ${randomUUID()}`, nameAr: `اختبار ${randomUUID()}` } });
before(async () => {
  const administrator = await prisma.user.findUnique({ where: { username: 'admin@cms.com' } });
  admin = signAccessToken(administrator);
  for (const role of ['RECEPTIONIST', 'LAB_TECH', 'PHARMACIST', 'DOCTOR', 'PATIENT']) {
    const user = await prisma.user.create({ data: { username: `delete-${randomUUID()}@test.local`, passwordHash: administrator.passwordHash, role } });
    tokens[role] = signAccessToken(user);
  }
});
after(async () => shutdown());

test('ADMIN permanently deletes an unused specialty and list no longer contains it', async () => {
  const specialty = await createSpecialty();
  assert.equal((await api.delete(`/api/specialties/${specialty.id}`).set(auth())).status, 204);
  const list = await api.get('/api/specialties').set(auth());
  assert.equal(list.status, 200);
  assert.equal(list.body.some((s) => s.id === specialty.id), false);
  assert.equal(await prisma.specialty.findUnique({ where: { id: specialty.id } }), null);
  assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'SPECIALTY_DELETED', details: { contains: specialty.id } } }), 1);
  assert.equal((await api.delete(`/api/specialties/${specialty.id}`).set(auth())).status, 404);
});

test('unauthenticated and every non-admin role cannot delete', async () => {
  const specialty = await createSpecialty();
  assert.equal((await api.delete(`/api/specialties/${specialty.id}`)).status, 401);
  for (const [role, token] of Object.entries(tokens)) assert.equal((await api.delete(`/api/specialties/${specialty.id}`).set(auth(token))).status, 403, role);
  assert.ok(await prisma.specialty.findUnique({ where: { id: specialty.id } }));
});

test('malformed identifiers return 422 and unknown UUIDs return 404 without database details', async () => {
  for (const [id, status] of [['invalid', 422], [randomUUID(), 404]]) {
    const response = await api.delete(`/api/specialties/${id}`).set(auth());
    assert.equal(response.status, status);
    assert.equal(/Prisma|constraint|SELECT|passwordHash/i.test(JSON.stringify(response.body)), false);
  }
});

test('referenced specialty preserves doctor, account, schedule and all clinical dependencies; deactivate/reactivate still works', async () => {
  const specialty = await createSpecialty();
  const user = await prisma.user.findFirst({ where: { role: 'DOCTOR', username: { startsWith: 'delete-' } } });
  const doctor = await prisma.doctor.create({ data: { userId: user.id, fullNameEn: 'Deletion Safety', fullNameAr: 'اختبار الحذف', specialtyId: specialty.id, specialtyEn: specialty.nameEn, specialtyAr: specialty.nameAr, consultationFee: 100, weeklySchedule: '[]' } });
  const schedule = await prisma.doctorSchedule.create({ data: { doctorId: doctor.id, effectiveFrom: '2020-01-01', periods: { create: { dayOfWeek: 'MONDAY', startTime: '09:00', endTime: '12:00', slotDurationMinutes: 30 } } } });
  const patient = await prisma.patient.create({ data: { fullNameEn: 'Safety Test', fullNameAr: 'اختبار', gender: 'MALE', dateOfBirth: '1990-01-01', phone: '+249911111111', addressStateId: 1, emergencyContact: 'Test' } });
  const appointment = await prisma.appointment.create({ data: { patientId: patient.id, doctorId: doctor.id, appointmentDate: '2020-01-06', appointmentTime: '09:00', status: 'COMPLETED' } });
  const record = await prisma.medicalRecord.create({ data: { patientId: patient.id, doctorId: doctor.id, appointmentId: appointment.id, symptomsEncrypted: 'test', diagnosisEncrypted: 'test', treatmentEncrypted: 'test', clinicalNotesEncrypted: 'test', vitalSignsJson: '{}' } });
  const prescription = await prisma.prescription.create({ data: { patientId: patient.id, doctorId: doctor.id, medicalRecordId: record.id } });
  const lab = await prisma.labOrder.create({ data: { patientId: patient.id, doctorId: doctor.id, medicalRecordId: record.id } });
  const invoice = await prisma.invoice.create({ data: { patientId: patient.id, appointmentId: appointment.id, totalAmountSdg: 100, totalAmountUsd: 1, invoiceExchangeRate: 100, createdBy: user.id } });
  const snapshot = async () => Promise.all([
    prisma.doctor.findUnique({ where: { id: doctor.id } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { id: true, role: true, status: true } }),
    prisma.doctorSchedule.findUnique({ where: { id: schedule.id }, include: { periods: true } }),
    ...[[prisma.appointment, appointment], [prisma.medicalRecord, record], [prisma.prescription, prescription], [prisma.labOrder, lab], [prisma.invoice, invoice]].map(([model, row]) => model.findUnique({ where: { id: row.id } }))
  ]);
  const before = await snapshot();
  const response = await api.delete(`/api/specialties/${specialty.id}`).set(auth());
  assert.equal(response.status, 409); assert.equal(response.body.error.code, 'SPECIALTY_REFERENCED');
  assert.match(response.body.error.message, /deactivate/);
  assert.deepEqual(await snapshot(), before);
  for (const active of [false, true]) {
    const updated = await api.patch(`/api/specialties/${specialty.id}`).set(auth()).send({ nameEn: specialty.nameEn, nameAr: specialty.nameAr, active });
    assert.equal(updated.status, 200); assert.equal(updated.body.active, active);
  }
  await prisma.doctor.update({ where: { id: doctor.id }, data: { specialtyId: null, specialtyEn: 'Changed', specialtyAr: 'تغيير' } });
  assert.equal((await api.delete(`/api/specialties/${specialty.id}`).set(auth())).status, 409, 'Former assignment remains protected');
});

test('legacy name references and protected pre-migration entries are not deleted', async () => {
  const specialty = await createSpecialty();
  await prisma.specialty.update({ where: { id: specialty.id }, data: { deletionProtected: true } });
  assert.equal((await api.delete(`/api/specialties/${specialty.id}`).set(auth())).status, 409);
  const doctor = await prisma.doctor.findFirst({ where: { fullNameEn: 'Deletion Safety' } });
  const legacy = await createSpecialty();
  await prisma.doctor.update({ where: { id: doctor.id }, data: { specialtyId: null, specialtyEn: legacy.nameEn, specialtyAr: legacy.nameAr } });
  assert.equal((await api.delete(`/api/specialties/${legacy.id}`).set(auth())).status, 409);
  await prisma.doctor.update({ where: { id: doctor.id }, data: { specialtyEn: 'Changed again', specialtyAr: 'تغيير آخر' } });
  assert.equal((await api.delete(`/api/specialties/${legacy.id}`).set(auth())).status, 409);
});

test('foreign key prevents direct deletion from silently unlinking an assigned doctor', async () => {
  const specialty = await createSpecialty();
  const doctor = await prisma.doctor.findFirst({ where: { fullNameEn: 'Deletion Safety' } });
  await prisma.doctor.update({ where: { id: doctor.id }, data: { specialtyId: specialty.id } });
  await assert.rejects(prisma.specialty.delete({ where: { id: specialty.id } }), { code: 'P2003' });
  assert.equal((await prisma.doctor.findUnique({ where: { id: doctor.id } })).specialtyId, specialty.id);
});

test('creating a specialty matching a legacy doctor protects it even after renaming', async () => {
  const doctor = await prisma.doctor.findFirst({ where: { fullNameEn: 'Deletion Safety' } });
  const name = `Legacy ${randomUUID()}`;
  await prisma.doctor.update({ where: { id: doctor.id }, data: { specialtyId: null, specialtyEn: name, specialtyAr: name } });
  const specialty = await prisma.specialty.create({ data: { code: `legacy-${randomUUID()}`, nameEn: name, nameAr: name } });
  assert.equal(specialty.deletionProtected, true);
  await prisma.specialty.update({ where: { id: specialty.id }, data: { nameEn: 'Renamed', nameAr: 'تغيير', deletionProtected: false } });
  assert.equal((await api.delete(`/api/specialties/${specialty.id}`).set(auth())).status, 409);
});

test('migration protects pre-existing specialties, preserves rows, and leaves new unused entries deletable', async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const schema = `specialty_migration_${randomUUID().replaceAll('-', '')}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    const directory = new URL('../prisma/migrations/', import.meta.url);
    const migration = '20260916000000_specialty_safe_deletion';
    for (const name of readdirSync(directory).filter((name) => name < migration).sort()) {
      if (!/^\d/.test(name)) continue;
      await client.query(readFileSync(new URL(`${name}/migration.sql`, directory), 'utf8'));
    }
    const id = randomUUID();
    await client.query('INSERT INTO "Specialty" (id, code, "nameEn", "nameAr", "updatedAt") VALUES ($1, $2, $3, $4, NOW())', [id, 'old-unused', 'Existing', 'سابق']);
    const before = (await client.query('SELECT * FROM "Specialty" WHERE id = $1', [id])).rows[0];
    await client.query(readFileSync(new URL(`${migration}/migration.sql`, directory), 'utf8'));
    const { deletionProtected, ...after } = (await client.query('SELECT * FROM "Specialty" WHERE id = $1', [id])).rows[0];
    assert.equal(deletionProtected, true); assert.deepEqual(after, before);
    const fresh = (await client.query('INSERT INTO "Specialty" (id, code, "nameEn", "nameAr", "updatedAt") VALUES ($1, $2, $3, $4, NOW()) RETURNING "deletionProtected"', [randomUUID(), 'new-unused', 'New', 'جديد'])).rows[0];
    assert.equal(fresh.deletionProtected, false);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});

test('assignment committed while DELETE waits is protected rather than unlinked', async () => {
  const specialty = await createSpecialty();
  const doctor = await prisma.doctor.findFirst({ where: { fullNameEn: 'Deletion Safety' } });
  let locked;
  let release;
  const ready = new Promise((resolve) => { locked = resolve; });
  const finish = new Promise((resolve) => { release = resolve; });
  const assignment = prisma.$transaction(async (tx) => {
    await tx.doctor.update({ where: { id: doctor.id }, data: { specialtyId: specialty.id } });
    locked();
    await finish;
  });
  await ready;
  const deletion = api.delete(`/api/specialties/${specialty.id}`).set(auth()).then((response) => response);
  release();
  await assignment;
  assert.equal((await deletion).status, 409);
  assert.equal((await prisma.doctor.findUnique({ where: { id: doctor.id } })).specialtyId, specialty.id);
});
