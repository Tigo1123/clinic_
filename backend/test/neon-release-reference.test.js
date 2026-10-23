import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Client } from 'pg';
import { isolatedDatabaseUrl } from './helpers/testRunner.js';

const sourceSchema = new URL(process.env.TEST_DATABASE_URL).searchParams.get('schema');
const url = isolatedDatabaseUrl(process.env.TEST_DATABASE_URL, sourceSchema, process.env.TEST_DATABASE_PORT || '5433');
if (url !== process.env.DATABASE_URL || url !== process.env.DIRECT_URL) throw new Error('Isolated test URLs required');
const schema = `test_release_reference_${process.pid}_${Date.now()}`;
const client = new Client({ connectionString: url });
// Execute the exact reviewed SQL, substituting only the isolated test schema.
const sql = (await fs.readFile(new URL('../reference-data/production-specialties.sql', import.meta.url), 'utf8')).replaceAll('public."Specialty"', `"${schema}"."Specialty"`);
const expected = JSON.parse(await fs.readFile(new URL('../../docs/clinic-readiness/proposed-specialties.json', import.meta.url), 'utf8')).specialties;
const snapshot = async () => (await client.query(`SELECT row_to_json(s)::text AS data FROM "${schema}"."Specialty" s ORDER BY code`)).rows;
before(async () => {
  await client.connect();
  // An empty schema avoids assumptions about the runner's optional fixtures.
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`CREATE TABLE "${schema}"."Specialty" (LIKE "${sourceSchema}"."Specialty" INCLUDING ALL)`);
});
after(async () => { await client.query('ROLLBACK'); await client.end(); });

test('reviewed specialty bootstrap inserts exactly five existing vocabulary definitions and UUIDs', async () => {
  await client.query(sql);
  const rows = (await client.query(`SELECT id,code,"nameAr","nameEn",active,"deletionProtected" FROM "${schema}"."Specialty" ORDER BY code`)).rows;
  assert.deepEqual(rows.map(({code,nameAr,nameEn})=>({code,nameAr,nameEn})), [...expected].sort((a,b)=>a.code.localeCompare(b.code)));
  assert.ok(rows.every(row => /^[0-9a-f-]{36}$/.test(row.id) && row.active && !row.deletionProtected));
});

test('repeated bootstrap preserves every existing UUID, archived status and timestamp exactly', async () => {
  await client.query(`UPDATE "${schema}"."Specialty" SET active=false WHERE code='surgery'`);
  const before = await snapshot(); await client.query(sql);
  assert.deepEqual(await snapshot(), before);
});

test('conflicting existing labels abort atomically without repairing existing data', async () => {
  await client.query(`UPDATE "${schema}"."Specialty" SET "nameEn"='Clinic edited label' WHERE code='dentistry'`);
  const before = await snapshot();
  await assert.rejects(client.query(sql), /code\/label conflict/);
  await client.query('ROLLBACK'); assert.deepEqual(await snapshot(), before);
  await client.query(`UPDATE "${schema}"."Specialty" SET "nameEn"='Dentistry' WHERE code='dentistry'`);
});

test('normalized label collision at another code aborts without inserting or updating', async () => {
  await client.query(`INSERT INTO "${schema}"."Specialty" (id,code,"nameAr","nameEn","updatedAt") VALUES (gen_random_uuid()::text,'clinic-code','تخصص آخر','  SURGERY  ',CURRENT_TIMESTAMP)`);
  const before = await snapshot();
  await assert.rejects(client.query(sql), /normalized-name conflict/);
  await client.query('ROLLBACK'); assert.deepEqual(await snapshot(), before);
});
