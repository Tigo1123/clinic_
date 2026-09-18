import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import prisma from '../src/db.js';
import { app } from '../src/server.js';

const api = request(app);
let adminToken; let receptionistToken; let doctorToken; let labToken; let pharmacyToken; let doctor;
const auth = (token) => ({ Authorization: `Bearer ${token}` });
async function login(username, password) { const response = await api.post('/api/auth/login').send({ username, password }); assert.equal(response.status, 200); return response.body.token; }

before(async () => {
  adminToken = await login('admin@cms.com', 'Admin@123');
  receptionistToken = await login('recep@cms.com', 'Receptionist@123');
  doctorToken = await login('doctor@cms.com', 'Doctor@123');
  labToken = await login('lab@cms.com', 'Labtech@123');
  pharmacyToken = await login('pharma@cms.com', 'Pharmacist@123');
  doctor = await prisma.doctor.findFirst({ where: { user: { username: 'doctor@cms.com' } }, include: { specialty: true } });
});

after(async () => { await prisma.$disconnect(); });

test('ADMIN can list and inspect safe doctor management DTOs', async () => {
  const list = await api.get('/api/admin/doctors').set(auth(adminToken));
  assert.equal(list.status, 200); assert.ok(list.body.some((item) => item.id === doctor.id));
  const detail = await api.get(`/api/admin/doctors/${doctor.id}`).set(auth(adminToken));
  assert.equal(detail.status, 200); assert.equal(detail.body.id, doctor.id);
  assert.equal(Object.hasOwn(detail.body, 'weeklySchedule'), false);
  assert.equal(Object.hasOwn(detail.body, 'passwordHash'), false);
  assert.equal(Object.hasOwn(detail.body, 'authVersion'), false);
});

test('ADMIN can create, edit, and deactivate a specialty without deleting it', async () => {
  const code = `phase1b3a-${Date.now()}`;
  const created = await api.post('/api/specialties').set(auth(adminToken)).send({ code, nameAr: 'تخصص اختبار', nameEn: 'Test Specialty', active: true });
  assert.equal(created.status, 201);
  const edited = await api.patch(`/api/specialties/${created.body.id}`).set(auth(adminToken)).send({ nameAr: 'تخصص معدل', nameEn: 'Edited Specialty', active: false });
  assert.equal(edited.status, 200); assert.equal(edited.body.active, false);
  const retained = await prisma.specialty.findUnique({ where: { id: created.body.id } });
  assert.equal(retained.active, false); await prisma.specialty.delete({ where: { id: created.body.id } });
});

test('duplicate specialty codes and invalid specialty assignments are rejected safely', async () => {
  const existing = await prisma.specialty.findFirst({});
  const duplicate = await api.post('/api/specialties').set(auth(adminToken)).send({ code: existing.code, nameAr: 'مكرر', nameEn: 'Duplicate' });
  assert.equal(duplicate.status, 409); assert.equal(duplicate.body.error.code, 'SPECIALTY_CODE_EXISTS');
  const invalid = await api.patch(`/api/admin/doctors/${doctor.id}`).set(auth(adminToken)).send({ specialtyId: '00000000-0000-0000-0000-000000000000' });
  assert.equal(invalid.status, 422); assert.equal(invalid.body.error.code, 'SPECIALTY_INACTIVE_OR_NOT_FOUND');
});

test('ADMIN can update doctor profile, specialty, and status without changing schedules', async () => {
  const original = { fullNameAr: doctor.fullNameAr, fullNameEn: doctor.fullNameEn, specialtyId: doctor.specialtyId, status: doctor.status };
  const scheduleCount = await prisma.doctorSchedule.count({ where: { doctorId: doctor.id } });
  const updated = await api.patch(`/api/admin/doctors/${doctor.id}`).set(auth(adminToken)).send({ fullNameEn: 'Managed Doctor', status: 'INACTIVE', specialtyId: doctor.specialtyId });
  assert.equal(updated.status, 200); assert.equal(updated.body.status, 'INACTIVE');
  assert.equal(await prisma.doctorSchedule.count({ where: { doctorId: doctor.id } }), scheduleCount);
  assert.equal((await api.get('/api/appointments/doctors')).body.some((item) => item.id === doctor.id), false);
  await prisma.doctor.update({ where: { id: doctor.id }, data: original });
});

test('inactive specialties are excluded from patient doctor discovery while legacy doctors remain safe', async () => {
  const originalSpecialtyId = doctor.specialtyId;
  let specialty = originalSpecialtyId ? await prisma.specialty.findUnique({ where: { id: originalSpecialtyId } }) : null;
  let createdSpecialty = false;
  if (!specialty) {
    specialty = await prisma.specialty.create({ data: { code: `phase1b3a-inactive-${Date.now()}`, nameAr: 'تخصص مؤقت', nameEn: 'Temporary Specialty', active: true } });
    createdSpecialty = true;
    await prisma.doctor.update({ where: { id: doctor.id }, data: { specialtyId: specialty.id } });
  }
  try {
    await prisma.specialty.update({ where: { id: specialty.id }, data: { active: false } });
    const publicDoctors = await api.get('/api/appointments/doctors');
    assert.equal(publicDoctors.status, 200); assert.equal(publicDoctors.body.some((item) => item.id === doctor.id), false);
    const patientDoctors = await api.get('/api/patient/doctors');
    assert.equal(patientDoctors.status, 401); // patient route remains authenticated and ownership-protected
  } finally {
    await prisma.specialty.update({ where: { id: specialty.id }, data: { active: true } });
    if (createdSpecialty) {
      await prisma.doctor.update({ where: { id: doctor.id }, data: { specialtyId: originalSpecialtyId } });
      await prisma.specialty.delete({ where: { id: specialty.id } });
    }
  }
});

test('all non-admin roles and unauthenticated callers are denied doctor management mutations', async () => {
  const payload = { fullNameEn: 'Denied Update' };
  assert.equal((await api.patch(`/api/admin/doctors/${doctor.id}`).send(payload)).status, 401);
  for (const token of [receptionistToken, doctorToken, labToken, pharmacyToken]) assert.equal((await api.patch(`/api/admin/doctors/${doctor.id}`).set(auth(token)).send(payload)).status, 403);
});

test('unknown doctor identifiers return a sanitized 404', async () => {
  const response = await api.get('/api/admin/doctors/00000000-0000-0000-0000-000000000000').set(auth(adminToken));
  assert.equal(response.status, 404); assert.equal(response.body.error.code, 'DOCTOR_NOT_FOUND');
});
