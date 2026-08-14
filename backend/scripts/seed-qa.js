import bcrypt from 'bcryptjs';
import { PrismaClient } from '../src/generated/prisma/index.js';
import { assertIsolatedPostgres } from './assert-isolated-postgres.js';

assertIsolatedPostgres({ purpose: 'QA seed', requiredDatabaseFragment: 'qa', requiredSchemaPrefix: 'qa_' });
if (!process.env.QA_PASSWORD || process.env.QA_PASSWORD.length < 12) {
  throw new Error('QA_PASSWORD must contain at least 12 characters.');
}

const prisma = new PrismaClient();
const passwordHash = await bcrypt.hash(process.env.QA_PASSWORD, 10);
const schedule = JSON.stringify([
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
].map((day) => ({ day, startTime: '08:00', endTime: '17:00', slotDurationInMinutes: 30 })));

async function upsertUser(username, role) {
  return prisma.user.upsert({
    where: { username },
    update: { passwordHash, role, status: 'ACTIVE', preferredLanguage: 'en' },
    create: { username, passwordHash, role, status: 'ACTIVE', preferredLanguage: 'en' }
  });
}

try {
  const [admin, receptionist, doctorUser, laboratory, pharmacy, patientUser, secondPatientUser, disposableStaff] = await Promise.all([
    upsertUser('qa-admin@example.test', 'ADMIN'),
    upsertUser('qa-reception@example.test', 'RECEPTIONIST'),
    upsertUser('qa-doctor@example.test', 'DOCTOR'),
    upsertUser('qa-lab@example.test', 'LAB_TECH'),
    upsertUser('qa-pharmacy@example.test', 'PHARMACIST'),
    upsertUser('qa-patient@example.test', 'PATIENT'),
    upsertUser('qa-patient-b@example.test', 'PATIENT'),
    upsertUser('qa-disposable-staff@example.test', 'RECEPTIONIST')
  ]);

  const doctor = await prisma.doctor.upsert({
    where: { userId: doctorUser.id },
    update: { weeklySchedule: schedule, status: 'ACTIVE' },
    create: {
      userId: doctorUser.id,
      fullNameAr: 'د. اختبار سير العمل',
      fullNameEn: 'Dr. QA Workflow',
      specialtyAr: 'طب تجريبي',
      specialtyEn: 'QA General Medicine',
      consultationFee: 12000,
      weeklySchedule: schedule,
      status: 'ACTIVE'
    }
  });

  const patient = await prisma.patient.upsert({
    where: { userId: patientUser.id },
    update: {},
    create: {
      userId: patientUser.id,
      fullNameAr: 'مريض اختبار سير العمل',
      fullNameEn: 'QA Workflow Patient',
      gender: 'FEMALE',
      dateOfBirth: '1994-06-15',
      phone: '+250788990001',
      addressStateId: 1,
      addressDetails: 'Fictional QA address',
      emergencyContact: 'QA Contact'
    }
  });

  const secondPatient = await prisma.patient.upsert({
    where: { userId: secondPatientUser.id },
    update: {},
    create: {
      userId: secondPatientUser.id,
      fullNameAr: 'مريض اختبار ثان',
      fullNameEn: 'QA Second Patient',
      gender: 'MALE',
      dateOfBirth: '1991-02-10',
      phone: '+250788990002',
      addressStateId: 1,
      emergencyContact: 'QA Contact'
    }
  });

  await prisma.user.updateMany({
    where: { id: { in: [patientUser.id, secondPatientUser.id] } },
    data: { emailVerifiedAt: new Date('2026-01-01T00:00:00Z'), phoneVerifiedAt: new Date('2026-01-01T00:00:00Z') }
  });

  const drug = await prisma.drugFormulary.findFirst({ orderBy: { genericName: 'asc' } });
  const service = await prisma.clinicalService.findFirst({ where: { category: 'LABORATORY' } });
  if (!drug || !service) throw new Error('Base seed did not create required drug/service fixtures.');

  const latestBatch = await prisma.inventoryBatch.findFirst({ where: { drugId: drug.id }, orderBy: { expiryDate: 'desc' } });
  if (!latestBatch || latestBatch.expiryDate < '2027-01-01') throw new Error('Base seed did not create a usable QA inventory batch.');

  console.log(JSON.stringify({
    seeded: true,
    users: { admin: admin.id, receptionist: receptionist.id, doctor: doctorUser.id, laboratory: laboratory.id, pharmacy: pharmacy.id, disposableStaff: disposableStaff.id },
    fixtures: { doctor: doctor.id, patient: patient.id, secondPatient: secondPatient.id, drug: drug.id, labService: service.id, fefoBatch: latestBatch.id }
  }));
} finally {
  await prisma.$disconnect();
}
