import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { Client } from 'pg';
import { app } from '../src/server.js';
import prisma from '../src/db.js';

const api = request(app);
let pg;
let schema;
let doctorToken;
let otherDoctorToken;
let pharmacistToken;
let receptionistToken;
let doctor;
let patient;
let actorUserId;
let counter = 0;

async function login(username, password) {
  const response = await api.post('/api/auth/login').send({ username, password });
  assert.equal(response.status, 200);
  return response.body.token;
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function createAppointment(status = 'IN_CONSULTATION') {
  counter += 1;
  return prisma.appointment.create({ data: {
    patientId: patient.id,
    doctorId: doctor.id,
    appointmentDate: `2088-06-${String(counter).padStart(2, '0')}`,
    appointmentTime: '10:00',
    status
  } });
}

async function createAuditFailureTrigger() {
  await pg.query(`CREATE OR REPLACE FUNCTION "${schema}".test_reject_clinical_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.action IN ('MEDICAL_RECORD_CREATED', 'MEDICAL_RECORD_FINALIZED', 'PRESCRIPTION_DISPENSED') THEN
        RAISE EXCEPTION 'forced clinical audit insert failure';
      END IF;
      RETURN NEW;
    END;
  $$`);
  await pg.query(`CREATE TRIGGER test_reject_clinical_audit BEFORE INSERT ON "${schema}"."TenantAuditLog" FOR EACH ROW EXECUTE FUNCTION "${schema}".test_reject_clinical_audit()`);
}

async function dropAuditFailureTrigger() {
  await pg.query(`DROP TRIGGER IF EXISTS test_reject_clinical_audit ON "${schema}"."TenantAuditLog"`);
  await pg.query(`DROP FUNCTION IF EXISTS "${schema}".test_reject_clinical_audit()`);
}

before(async () => {
  doctorToken = await login('doctor@cms.com', 'Doctor@123');
  otherDoctorToken = await login('doctor_cardio@cms.com', 'Doctor@123');
  pharmacistToken = await login('pharma@cms.com', 'Pharmacist@123');
  receptionistToken = await login('recep@cms.com', 'Receptionist@123');
  doctor = await prisma.doctor.findFirst({ where: { user: { username: 'doctor@cms.com' } } });
  actorUserId = (await prisma.user.findUnique({ where: { username: 'doctor@cms.com' }, select: { id: true } })).id;
  patient = await prisma.patient.create({ data: {
    fullNameAr: 'مريض اختبار تدقيق',
    fullNameEn: 'Synthetic Clinical Audit Patient',
    gender: 'MALE',
    dateOfBirth: '1990-01-01',
    phone: `+250788${String(Date.now()).slice(-6)}`,
    addressStateId: 1,
    emergencyContact: 'Synthetic Contact'
  } });
  pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  ({ schema } = (await pg.query('SELECT current_schema() AS schema')).rows[0]);
});

after(async () => {
  if (pg) {
    await dropAuditFailureTrigger();
    await pg.end();
  }
  await prisma.$disconnect();
});

test('consultation creation and finalization audit actor and record identifiers without clinical content', async () => {
  const appointment = await createAppointment();
  const marker = `CLINICAL-PHI-MARKER-${Date.now()}`;
  const created = await api.post('/api/records').set(auth(doctorToken)).send({
    patientId: patient.id, appointmentId: appointment.id,
    diagnosis: marker, symptoms: marker, clinicalNotes: marker
  });
  assert.equal(created.status, 201);
  const createAudit = await prisma.tenantAuditLog.findFirst({ where: {
    action: 'MEDICAL_RECORD_CREATED', details: { contains: created.body.recordId }
  } });

  const finalizableAppointment = await createAppointment();
  const finalizableRecord = await prisma.medicalRecord.create({ data: {
    patientId: patient.id, doctorId: doctor.id, appointmentId: finalizableAppointment.id,
    symptomsEncrypted: '', diagnosisEncrypted: '', treatmentEncrypted: '',
    clinicalNotesEncrypted: '', vitalSignsJson: '{}'
  } });
  const finalized = await api.put(`/api/records/${finalizableRecord.id}/finalize`).set(auth(doctorToken)).send({
    diagnosis: marker, clinicalNotes: marker
  });
  assert.equal(finalized.status, 200);
  const finalizeAudit = await prisma.tenantAuditLog.findFirst({ where: {
    action: 'MEDICAL_RECORD_FINALIZED', details: { contains: finalizableRecord.id }
  } });
  assert.deepEqual({
    create: createAudit && {
      actorId: createAudit.userId,
      details: JSON.parse(createAudit.details),
      containsClinicalMarker: createAudit.details.includes(marker)
    },
    finalize: finalizeAudit && {
      actorId: finalizeAudit.userId,
      details: JSON.parse(finalizeAudit.details),
      containsClinicalMarker: finalizeAudit.details.includes(marker)
    }
  }, {
    create: {
      actorId: actorUserId,
      details: {
        medicalRecordId: created.body.recordId,
        patientId: patient.id,
        appointmentId: appointment.id,
        doctorId: doctor.id,
        prescriptionId: null,
        labOrderId: null
      },
      containsClinicalMarker: false
    },
    finalize: {
      actorId: actorUserId,
      details: {
        medicalRecordId: finalizableRecord.id,
        patientId: patient.id,
        appointmentId: finalizableAppointment.id,
        doctorId: doctor.id,
        prescriptionId: null
      },
      containsClinicalMarker: false
    }
  });
});

test('dispensing audits successful stock mutation with pharmacist actor and affected identifiers only', async () => {
  const fixture = await createPaidPrescriptionFixture();
  const pharmacistId = (await prisma.user.findUnique({ where: { username: 'pharma@cms.com' }, select: { id: true } })).id;
  const response = await api.post(`/api/records/prescriptions/${fixture.prescription.id}/dispense`)
    .set(auth(pharmacistToken)).send({ items: [{ prescribedDrugId: fixture.item.id, qtyToDispense: 1 }] });
  assert.equal(response.status, 200);
  const audit = await prisma.tenantAuditLog.findFirst({ where: {
    action: 'PRESCRIPTION_DISPENSED', details: { contains: fixture.prescription.id }
  } });
  assert.ok(audit);
  assert.equal(audit.userId, pharmacistId);
  assert.deepEqual(JSON.parse(audit.details), {
    prescriptionId: fixture.prescription.id,
    prescribedDrugIds: [fixture.item.id]
  });
});

test('clinical audit insertion failures roll back consultation, finalization, and dispensing mutations', async () => {
  const createAppointmentRow = await createAppointment();
  const finalizeAppointmentRow = await createAppointment();
  const finalizeRecord = await prisma.medicalRecord.create({ data: {
    patientId: patient.id, doctorId: doctor.id, appointmentId: finalizeAppointmentRow.id,
    symptomsEncrypted: 'synthetic-before', diagnosisEncrypted: 'synthetic-before', treatmentEncrypted: '',
    clinicalNotesEncrypted: '', vitalSignsJson: '{}'
  } });
  const fixture = await createPaidPrescriptionFixture();
  const previousDiagnosis = finalizeRecord.diagnosisEncrypted;
  const previousStock = fixture.batch.qtyOnHand;
  const previousDispensed = fixture.item.qtyDispensed;

  await createAuditFailureTrigger();
  try {
    const createResponse = await api.post('/api/records').set(auth(doctorToken)).send({
      patientId: patient.id, appointmentId: createAppointmentRow.id, diagnosis: 'Synthetic diagnosis'
    });
    const createState = {
      status: createResponse.status,
      recordCount: await prisma.medicalRecord.count({ where: { appointmentId: createAppointmentRow.id } }),
      appointmentStatus: (await prisma.appointment.findUnique({ where: { id: createAppointmentRow.id } })).status,
      auditCount: await prisma.tenantAuditLog.count({ where: { action: 'MEDICAL_RECORD_CREATED', details: { contains: createAppointmentRow.id } } })
    };

    const finalizeResponse = await api.put(`/api/records/${finalizeRecord.id}/finalize`).set(auth(doctorToken)).send({ diagnosis: 'Synthetic replacement' });
    const finalizeState = {
      status: finalizeResponse.status,
      diagnosisEncrypted: (await prisma.medicalRecord.findUnique({ where: { id: finalizeRecord.id } })).diagnosisEncrypted,
      appointmentStatus: (await prisma.appointment.findUnique({ where: { id: finalizeAppointmentRow.id } })).status,
      auditCount: await prisma.tenantAuditLog.count({ where: { action: 'MEDICAL_RECORD_FINALIZED', details: { contains: finalizeRecord.id } } })
    };

    const dispenseResponse = await api.post(`/api/records/prescriptions/${fixture.prescription.id}/dispense`)
      .set(auth(pharmacistToken)).send({ items: [{ prescribedDrugId: fixture.item.id, qtyToDispense: 1 }] });
    const dispenseState = {
      status: dispenseResponse.status,
      stock: (await prisma.inventoryBatch.findUnique({ where: { id: fixture.batch.id } })).qtyOnHand,
      qtyDispensed: (await prisma.prescribedDrug.findUnique({ where: { id: fixture.item.id } })).qtyDispensed,
      movementCount: await prisma.stockMovement.count({ where: { referenceId: fixture.item.id, referenceType: 'PRESCRIBED_DRUG_DISPENSE' } }),
      auditCount: await prisma.tenantAuditLog.count({ where: { action: 'PRESCRIPTION_DISPENSED', details: { contains: fixture.prescription.id } } })
    };

    assert.deepEqual({ createState, finalizeState, dispenseState }, {
      createState: { status: 500, recordCount: 0, appointmentStatus: 'IN_CONSULTATION', auditCount: 0 },
      finalizeState: { status: 500, diagnosisEncrypted: previousDiagnosis, appointmentStatus: 'IN_CONSULTATION', auditCount: 0 },
      dispenseState: { status: 500, stock: previousStock, qtyDispensed: previousDispensed, movementCount: 0, auditCount: 0 }
    });
  } finally {
    await dropAuditFailureTrigger();
  }
});

test('rejected and unauthorized clinical writes create no success audit events', async () => {
  const appointment = await createAppointment();
  const denied = await api.post('/api/records').set(auth(receptionistToken)).send({
    patientId: patient.id, appointmentId: appointment.id, diagnosis: 'Synthetic diagnosis'
  });
  assert.equal(denied.status, 403);
  assert.equal(await prisma.medicalRecord.count({ where: { appointmentId: appointment.id } }), 0);
  assert.equal(await prisma.tenantAuditLog.count({ where: {
    action: 'MEDICAL_RECORD_CREATED', details: { contains: appointment.id }
  } }), 0);

  const wrongDoctorAppointment = await createAppointment();
  const wrongDoctor = await api.post('/api/records').set(auth(otherDoctorToken)).send({
    patientId: patient.id, appointmentId: wrongDoctorAppointment.id, diagnosis: 'Synthetic diagnosis'
  });
  assert.equal(wrongDoctor.status, 403);
  assert.equal(await prisma.medicalRecord.count({ where: { appointmentId: wrongDoctorAppointment.id } }), 0);
  assert.equal(await prisma.tenantAuditLog.count({ where: {
    action: 'MEDICAL_RECORD_CREATED', details: { contains: wrongDoctorAppointment.id }
  } }), 0);

  const fixture = await createPaidPrescriptionFixture();
  const before = await prisma.tenantAuditLog.count({ where: { action: 'PRESCRIPTION_DISPENSED' } });
  const invalid = await api.post(`/api/records/prescriptions/${fixture.prescription.id}/dispense`)
    .set(auth(receptionistToken)).send({ items: [{ prescribedDrugId: fixture.item.id, qtyToDispense: 1 }] });
  assert.equal(invalid.status, 403);
  assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'PRESCRIPTION_DISPENSED' } }), before);
});

async function createPaidPrescriptionFixture() {
  counter += 1;
  const suffix = `${Date.now()}-${counter}`;
  const appointment = await createAppointment('COMPLETED');
  const record = await prisma.medicalRecord.create({ data: {
    patientId: patient.id, doctorId: doctor.id, appointmentId: appointment.id,
    symptomsEncrypted: '', diagnosisEncrypted: '', treatmentEncrypted: '', clinicalNotesEncrypted: '', vitalSignsJson: '{}'
  } });
  const drug = await prisma.drugFormulary.create({ data: {
    brandName: `Clinical Audit Fixture ${suffix}`,
    labelAr: 'دواء تدقيق اصطناعي',
    labelEn: `Clinical Audit Fixture ${suffix}`,
    genericName: `ClinicalAudit-${suffix}`,
    strength: '1mg',
    dosageForm: 'Tablet',
    identityKey: `clinical-audit-${suffix}`,
    unitPriceSdg: 2500,
    status: 'ACTIVE'
  } });
  const prescription = await prisma.prescription.create({ data: {
    medicalRecordId: record.id, patientId: patient.id, doctorId: doctor.id,
    prescribedDrugs: { create: {
      drugId: drug.id, dosage: 'Synthetic dose', duration: 'One day',
      instructionsAr: '', instructionsEn: '', qtyPrescribed: 2
    } }
  }, include: { prescribedDrugs: true } });
  const batch = await prisma.inventoryBatch.create({ data: {
    drugId: drug.id, batchNumber: `CLINICAL-AUDIT-${suffix}`,
    normalizedBatchNumber: `CLINICAL-AUDIT-${suffix}`, expiryDate: '2099-01-01', qtyOnHand: 3
  } });
  await prisma.invoice.create({ data: {
    patientId: patient.id, appointmentId: appointment.id, prescriptionId: prescription.id,
    invoiceType: 'PHARMACY', totalAmountSdg: 5000, totalAmountUsd: 5000 / 1500,
    invoiceExchangeRate: 1500, paymentStatus: 'PAID', createdBy: 'clinical-audit-test',
    items: { create: {
      descriptionAr: drug.labelAr, descriptionEn: drug.labelEn,
      qty: 2, unitPriceSdg: 2500, unitPriceUsd: 2500 / 1500
    } }
  } });
  return { appointment, record, prescription, item: prescription.prescribedDrugs[0], drug, batch };
}
