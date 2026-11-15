import test from 'node:test';
import assert from 'node:assert/strict';
import { repositoryInventory, inspectDatabase } from '../scripts/audit-clinic-readiness.js';

test('repository inventory includes every Prisma model, relationship and migration', async () => {
  const inventory = await repositoryInventory();
  assert.equal(inventory.modelCount, 46);
  assert.ok(inventory.models.find(model => model.name === 'Patient').relationships.some(relation => relation.field === 'invoices' && relation.target === 'Invoice' && relation.cardinality === 'many'));
  assert.ok(inventory.models.find(model => model.name === 'Payment').relationships.some(relation => relation.field === 'invoice' && relation.target === 'Invoice' && relation.cardinality === 'required'));
  assert.equal(inventory.migrations.length, 33);
});


test('Neon applied migration checksums match the seven preserved SQL files', async () => {
  // Recorded from the Neon production branch read-only Prisma migration audit.
  // This is a repository integrity test: it never connects to a database.
  const inventory = await repositoryInventory();
  const expected = {
    '20261022120000_shared_rate_limit_buckets': 'd87910178a2bc7eecf89daa1d6f48c93158ca2935cbb65c0162355fdd7e52d5c',
    '20261024100000_patient_insurance_membership': '93491b8c7f37149c741ed1f82f8ad44bcda556ae31fac73fd21978162dee7ddb',
    '20261027120000_durable_workflow_notifications': '65f12e01d30213166329dc924124bbf16efd871eef25ec178ffdeea57985d3c2',
    '20261027130000_dedupe_custom_prescription_notices': '5d87b190598a9f1ba5ddcc2cc05b4e87819e8b55b1e2d3be684d46c953b985bf',
    '20261027140000_distinguish_medicine_catalog_notices': '2f570366f4931cea1b53dda0d995faa186b57bee24e697ca12524b463ceeba46',
    '20261030190000_reception_cancellation_notice': 'a90a4ec01c01f93d966c42a96d440d91c60e36a59d576de616228d57fdd081ab',
    '20261107090000_durable_qa_verification_capture': '82b060e8263b2b06ab02c2e6021369f2476c16490d5246145025e57ad27c5a65',
  };
  const actual = Object.fromEntries(inventory.migrations
    .filter(migration => Object.hasOwn(expected, migration.name))
    .map(({ name, checksum }) => [name, checksum]));
  assert.deepEqual(actual, expected);
  for (const modelName of [
    'RateLimitBucket',
    'PatientInsurance',
    'QaVerificationCapture',
    'StockNotificationState',
    'InvoiceIssueOperation'
  ]) {
    assert.ok(inventory.models.some(model => model.name === modelName), modelName);
  }
});

function fixture(readOnly = 'on') {
  const queries = [];
  const client = {
    async connect() {}, async end() { queries.push('END CONNECTION'); },
    async query(sql) {
      queries.push(sql);
      if (sql === 'SHOW transaction_read_only') return { rows: [{ transaction_read_only: readOnly }] };
      if (sql.startsWith('SELECT tablename')) return { rows: [{ tablename: 'State' }, { tablename: '_prisma_migrations' }] };
      if (sql.startsWith('SELECT count')) return { rows: [{ count: '18' }] };
      if (sql.startsWith('SELECT migration_name')) return { rows: [{ migration_name: 'known', checksum: 'old', finished: true, rolled_back: false }, { migration_name: 'failed', finished: false, rolled_back: false }] };
      return { rows: [] };
    },
  };
  return { queries, client };
}

test('audit is read-only, contains aggregate counts only, and flags migration discrepancies', async () => {
  const { queries, client } = fixture();
  const result = await inspectDatabase({ connectionString: 'postgresql://secret:credential@127.0.0.1:5433/clinic_test?schema=test_audit', inventory: { models: [{ name: 'State' }, { name: 'Patient' }], migrations: [{ name: 'known', checksum: 'new' }, { name: 'pending', checksum: 'other' }] }, clientFactory: () => client });
  assert.equal(queries[0], 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.deepEqual(result.counts, { State: '18', Patient: null });
  assert.deepEqual(result.migrations.checksumMismatches, ['known']);
  assert.deepEqual(result.migrations.pending, ['pending']);
  assert.deepEqual(result.migrations.failed, ['failed']);
  assert.doesNotMatch(JSON.stringify(result), /secret|credential|postgresql:/);
  assert.ok(queries.includes('ROLLBACK'));
  assert.ok(queries.every(query => !/^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)/.test(query)));
});

test('audit refuses an unsafe schema before connecting', async () => {
  await assert.rejects(inspectDatabase({ connectionString: 'postgresql://localhost/clinic?schema=public%3BDROP', inventory: {}, clientFactory: () => { throw new Error('must not connect'); } }), /Invalid audit schema/);
});

test('audit refuses to read application tables unless read-only mode is confirmed', async () => {
  const { queries, client } = fixture('off');
  await assert.rejects(inspectDatabase({ connectionString: 'postgresql://localhost/clinic_test', inventory: { models: [] }, clientFactory: () => client }), /read-only transaction/);
  assert.ok(!queries.some(query => query.startsWith('SELECT count')));
  assert.ok(queries.includes('ROLLBACK'));
});
