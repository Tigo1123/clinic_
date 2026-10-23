import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Client } from 'pg';
import { isolatedDatabaseUrl } from './helpers/testRunner.js';
import { repositoryInventory } from '../scripts/audit-clinic-readiness.js';

test('catalog migration preserves existing money/IDs, initializes only four payment references, and retains historical methods', async () => {
  const schema = `test_catalog_migration_${process.pid}_${Date.now()}`;
  const url = isolatedDatabaseUrl(process.env.TEST_DATABASE_URL, schema, process.env.TEST_DATABASE_PORT || '5433');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    const inventory = await repositoryInventory();
    const index = inventory.migrations.findIndex(item => item.name === '20261022110000_admin_catalog_configuration');
    for (const migration of inventory.migrations.slice(0, index)) await client.query(await fs.readFile(new URL(`../prisma/migrations/${migration.name}/migration.sql`, import.meta.url), 'utf8'));
    await client.query(`
      INSERT INTO "State" VALUES (1, 'الخرطوم', 'Khartoum');
      INSERT INTO "User" (id, username, "passwordHash", role) VALUES ('actor', 'local@example.test', 'local-fixture-hash', 'ADMIN');
      INSERT INTO "Patient" (id, "fullNameAr", "fullNameEn", gender, "dateOfBirth", phone, "addressStateId", "emergencyContact") VALUES ('patient', 'مريض اختبار', 'Local fixture', 'MALE', '1990-01-01', 'local-fixture', 1, 'Local contact');
      INSERT INTO "Invoice" (id, "patientId", "totalAmountSdg", "totalAmountUsd", "invoiceExchangeRate", "createdBy") VALUES ('invoice', 'patient', 100, 0.066666666666666666666666666667, 1500, 'actor');
      INSERT INTO "Payment" (id, "invoiceId", "amountSdg", "amountUsd", "paymentMethod", "receivedBy") VALUES ('payment', 'invoice', 100, 0.066666666666666666666666666667, 'CASH', 'actor');
      INSERT INTO "Refund" (id, "invoiceId", "amountSdg", "amountUsd", "refundMethod", "processedBy") VALUES ('refund', 'invoice', 10, 0.006666666666666666666666666667, 'CARD', 'actor');
      INSERT INTO "ClinicalService" (id, "labelAr", "labelEn", "baseFeeSdg", "baseFeeUsd", category) VALUES ('service', 'خدمة قائمة', 'Existing service', 17001, 11.334, 'LABORATORY');
      INSERT INTO "Doctor" (id, "userId", "fullNameAr", "fullNameEn", "specialtyAr", "specialtyEn", "consultationFee", "weeklySchedule", "updatedAt") VALUES ('legacy-doctor', 'actor', 'طبيب قائم', 'Existing doctor', 'تخصص قائم', 'Existing specialty', 17001, '[{"day":"Monday","startTime":"08:00","endTime":"12:00","slotDurationInMinutes":20}]', CURRENT_TIMESTAMP);
      INSERT INTO "DrugFormulary" (id, "brandName", "labelAr", "labelEn", "genericName", strength, "dosageForm", "identityKey", "unitPriceSdg", status, "updatedAt") VALUES ('legacy-drug', 'Local preservation fixture', 'دواء قائم', 'Existing medicine', 'Local fixture', '10 mg', 'tablet', 'local-preservation-fixture', 123, 'ACTIVE', CURRENT_TIMESTAMP);
    `);
    const snapshot = async () => {
      const rows = [];
      for (const table of ['Invoice', 'Payment', 'Refund', 'Doctor', 'DrugFormulary']) {
        rows.push((await client.query(`SELECT row_to_json(t)::text AS data FROM "${table}" t ORDER BY id`)).rows);
      }
      return rows;
    };
    const before = await snapshot();
    await client.query(await fs.readFile(new URL('../prisma/migrations/20261022110000_admin_catalog_configuration/migration.sql', import.meta.url), 'utf8'));
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual((await client.query('SELECT code FROM "PaymentMethod" ORDER BY code')).rows.map(item => item.code), ['BANKAK', 'CARD', 'CASH', 'FAWRY']);
    const service = (await client.query('SELECT id, code, "baseFeeSdg"::text AS price FROM "ClinicalService"')).rows[0];
    assert.equal(service.id, 'service'); assert.equal(service.code, null); assert.equal(Number(service.price), 17001);
    await client.query(`UPDATE "PaymentMethod" SET active = false WHERE code IN ('CASH', 'CARD')`);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM "Payment" WHERE "paymentMethod" = $1', ['CASH'])).rows[0].n, 1);
    // PostgreSQL reports the RESTRICT action as SQLSTATE 23001; some supported
    // server versions surface it through the FK violation class 23503.
    await assert.rejects(client.query(`DELETE FROM "PaymentMethod" WHERE code = 'CASH'`), error => ['23001', '23503'].includes(error.code));
    await assert.rejects(client.query(`INSERT INTO "PaymentMethod" (code, "labelAr", "labelEn") VALUES ('RAW_CARD', 'غير مسموح', 'Unsupported')`), error => error.code === '23514');
  } finally { await client.query('ROLLBACK'); await client.end(); }
});
