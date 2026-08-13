import { PrismaClient } from '../src/generated/prisma/index.js';
import { encrypt } from '../src/utils/encryption.js';

if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL !== 'file:./qa.db') {
  throw new Error('Visual QA fixture seed refused outside the isolated qa.db environment.');
}

const prisma = new PrismaClient();
try {
  const patient = await prisma.patient.findFirstOrThrow({ where: { user: { username: 'qa-patient@example.test' } } });
  const doctor = await prisma.doctor.findFirstOrThrow({ where: { user: { username: 'qa-doctor@example.test' } } });
  const service = await prisma.clinicalService.findFirstOrThrow({ where: { category: 'LABORATORY' } });
  const drug = await prisma.drugFormulary.findFirstOrThrow({ orderBy: { genericName: 'asc' } });
  const completedRecord = await prisma.medicalRecord.findFirstOrThrow({ where: { patientId: patient.id }, orderBy: { visitDate: 'desc' } });

  const visualAppointment = await prisma.appointment.create({
    data: { patientId: patient.id, doctorId: doctor.id, appointmentDate: new Date().toISOString().slice(0, 10), appointmentTime: '16:30', status: 'CHECKED_IN' }
  });
  const visualRecord = await prisma.medicalRecord.create({
    data: {
      patientId: patient.id, doctorId: doctor.id, appointmentId: visualAppointment.id,
      symptomsEncrypted: encrypt('QA populated-state symptom'), diagnosisEncrypted: encrypt('QA populated-state diagnosis'),
      treatmentEncrypted: encrypt('QA populated-state treatment'), clinicalNotesEncrypted: encrypt('QA populated-state note'),
      vitalSignsJson: JSON.stringify({ blood_pressure: '118/76', heart_rate: '72', temperature: '36.8', weight: '64' })
    }
  });
  const labOrder = await prisma.labOrder.create({
    data: {
      medicalRecordId: visualRecord.id, patientId: patient.id, doctorId: doctor.id, status: 'SAMPLE_COLLECTED',
      items: { create: [{ serviceId: service.id }, { serviceId: service.id }] }
    }
  });
  const prescription = await prisma.prescription.create({
    data: {
      medicalRecordId: completedRecord.id, patientId: patient.id, doctorId: doctor.id, status: 'ACTIVE',
      prescribedDrugs: { create: { drugId: drug.id, dosage: 'One QA tablet', duration: 'One QA day', instructionsAr: 'للاختبار فقط', instructionsEn: 'For QA only', qtyPrescribed: 4 } }
    }
  });
  console.log(JSON.stringify({ visualAppointmentId: visualAppointment.id, labOrderId: labOrder.id, prescriptionId: prescription.id }));
} finally {
  await prisma.$disconnect();
}
