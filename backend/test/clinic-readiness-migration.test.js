import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Client } from 'pg';
import { isolatedDatabaseUrl } from './helpers/testRunner.js';
import { inspectDatabase, repositoryInventory } from '../scripts/audit-clinic-readiness.js';

test('index migration preserves populated clinical/financial rows and existing safeguards', async () => {
  const schema = `test_readiness_migration_${process.pid}_${Date.now()}`;
  const url = isolatedDatabaseUrl(process.env.TEST_DATABASE_URL, schema, process.env.TEST_DATABASE_PORT || '5433');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    const inventory = await repositoryInventory();
    const migrationIndex = inventory.migrations.findIndex(item => item.name === '20261022100000_patient_workflow_query_indexes');
    for (const migration of inventory.migrations.slice(0, migrationIndex)) {
      await client.query(await fs.readFile(new URL(`../prisma/migrations/${migration.name}/migration.sql`, import.meta.url), 'utf8'));
    }
    // Realistic relationships, entirely within the newly created local schema.
    await client.query(`
      INSERT INTO "State" VALUES (1, 'الخرطوم', 'Khartoum');
      INSERT INTO "User" (id, username, "passwordHash", role) VALUES ('u', 'fixture@example.test', 'test-only-hash', 'DOCTOR');
      INSERT INTO "Patient" (id, "fullNameAr", "fullNameEn", gender, "dateOfBirth", phone, "addressStateId", "emergencyContact") VALUES ('p', 'مريض محلي', 'Local patient', 'MALE', '1990-01-01', 'local-fixture', 1, 'Local contact');
      INSERT INTO "Doctor" (id, "userId", "fullNameAr", "fullNameEn", "specialtyAr", "specialtyEn", "consultationFee", "weeklySchedule") VALUES ('d', 'u', 'طبيب محلي', 'Local doctor', 'باطنية', 'Internal medicine', 123.45, '[]');
      INSERT INTO "Appointment" (id, "patientId", "doctorId", "appointmentDate", "appointmentTime") VALUES ('a', 'p', 'd', '2030-01-01', '09:00');
      INSERT INTO "MedicalRecord" (id, "patientId", "doctorId", "appointmentId", "symptomsEncrypted", "diagnosisEncrypted", "treatmentEncrypted", "vitalSignsJson", "clinicalNotesEncrypted") VALUES ('r', 'p', 'd', 'a', 'fixture', 'fixture', 'fixture', '{}', 'fixture');
      INSERT INTO "Prescription" (id, "patientId", "doctorId", "medicalRecordId") VALUES ('rx', 'p', 'd', 'r');
      INSERT INTO "LabOrder" (id, "patientId", "doctorId", "medicalRecordId") VALUES ('lab', 'p', 'd', 'r');
      INSERT INTO "Invoice" (id, "patientId", "totalAmountSdg", "totalAmountUsd", "invoiceExchangeRate", "createdBy") VALUES ('i', 'p', 123.45, 0.0823, 1500, 'u');
      INSERT INTO "Payment" (id, "invoiceId", "amountSdg", "amountUsd", "paymentMethod", "receivedBy") VALUES ('pay', 'i', 23.45, 0.015633333333333333333333333333, 'CASH', 'u');
    `);
    const tables = ['Appointment', 'MedicalRecord', 'Prescription', 'LabOrder', 'Invoice', 'Payment'];
    const snapshot = async () => Promise.all(tables.map(async table => (await client.query(`SELECT row_to_json(t)::text AS data FROM "${table}" t ORDER BY id`)).rows));
    const before = await snapshot();
    const migration = inventory.migrations[migrationIndex];
    const sql = await fs.readFile(new URL(`../prisma/migrations/${migration.name}/migration.sql`, import.meta.url), 'utf8');
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER)\s/i);
    await client.query(sql);
    assert.deepEqual(await snapshot(), before);
    const indexes = (await client.query('SELECT indexname FROM pg_indexes WHERE schemaname = $1', [schema])).rows.map(row => row.indexname);
    assert.ok(indexes.includes('Appointment_active_doctor_slot_key'));
    for (const table of tables) assert.ok(indexes.some(name => name.startsWith(table) && /(?:patientId|invoiceId)_/.test(name)), table);
    const report = await inspectDatabase({ connectionString: url, inventory });
    assert.equal(report.readOnly, true);
    assert.equal(report.counts.Patient, '1');
    assert.equal(report.counts.Payment, '1');
    assert.equal(report.target.local, true);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
    // Retain the isolated schema for inspection; no reset/drop cleanup.
  }
});
