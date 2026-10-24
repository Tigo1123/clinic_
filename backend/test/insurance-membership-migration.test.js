import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Client } from 'pg';
import { isolatedDatabaseUrl } from './helpers/testRunner.js';
import { repositoryInventory } from '../scripts/audit-clinic-readiness.js';

test('membership migration preserves historical invoices and claims without inventing memberships', async () => {
 const schema = `test_insurance_migration_${process.pid}_${Date.now()}`;
 const client = new Client({ connectionString: isolatedDatabaseUrl(process.env.TEST_DATABASE_URL, schema, process.env.TEST_DATABASE_PORT || '5433') });
 await client.connect();
 try {
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  const inventory = await repositoryInventory();
  const index = inventory.migrations.findIndex(row => row.name === '20261024100000_patient_insurance_membership');
  for (const migration of inventory.migrations.slice(0, index)) await client.query(await fs.readFile(new URL(`../prisma/migrations/${migration.name}/migration.sql`, import.meta.url), 'utf8'));
  await client.query(`
   INSERT INTO "State" VALUES (1, 'الخرطوم', 'Khartoum');
   INSERT INTO "Patient" (id,"fullNameAr","fullNameEn",gender,"dateOfBirth",phone,"addressStateId","emergencyContact") VALUES ('p','مريض','Patient','MALE','1990-01-01','fixture',1,'fixture');
   INSERT INTO "InsuranceCompany" (id,"labelAr","labelEn","copayPercentage") VALUES ('c','تأمين','Insurer',20);
   INSERT INTO "Invoice" (id,"patientId","totalAmountSdg","totalAmountUsd","invoiceExchangeRate","createdBy") VALUES ('i','p',1000,0.666666666666667,1500,'fixture');
   INSERT INTO "InsuranceClaim" (id,"insuranceCompanyId","patientId","invoiceId","claimAmountSdg","claimStatus") VALUES ('claim','c','p','i',800,'SUBMITTED');
   UPDATE "Invoice" SET "insuranceClaimId"='claim' WHERE id='i';
  `);
  const snapshot = async () => Promise.all(['Patient', 'Invoice', 'InsuranceClaim'].map(async table => (await client.query(`SELECT row_to_json(t)::text AS data FROM "${table}" t ORDER BY id`)).rows));
  const before = await snapshot();
  await client.query(await fs.readFile(new URL('../prisma/migrations/20261024100000_patient_insurance_membership/migration.sql', import.meta.url), 'utf8'));
  assert.deepEqual(await snapshot(), before);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM "PatientInsurance"')).rows[0].n, 0);
  assert.equal((await client.query('SELECT active FROM "InsuranceCompany"')).rows[0].active, true);
  await client.query(`INSERT INTO "PatientInsurance" (id,"patientId","insuranceCompanyId","memberNumber","validFrom","validUntil") VALUES ('m','p','c','fixture','2026-01-01','2027-01-01')`);
  await assert.rejects(client.query(`DELETE FROM "InsuranceCompany" WHERE id='c'`), error => ['23001','23503'].includes(error.code));
  await assert.rejects(client.query(`UPDATE "PatientInsurance" SET "validUntil"='2020-01-01' WHERE id='m'`), error => error.code === '23514');
 } finally { await client.end(); }
});
