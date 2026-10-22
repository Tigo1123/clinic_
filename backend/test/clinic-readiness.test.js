import test from 'node:test';
import assert from 'node:assert/strict';
import { repositoryInventory, inspectDatabase } from '../scripts/audit-clinic-readiness.js';

test('repository inventory includes every Prisma model, relationship and migration', async () => {
  const inventory = await repositoryInventory();
  assert.equal(inventory.modelCount, 41);
  assert.ok(inventory.models.find(model => model.name === 'Patient').relationships.some(relation => relation.field === 'invoices' && relation.target === 'Invoice' && relation.cardinality === 'many'));
  assert.ok(inventory.models.find(model => model.name === 'Payment').relationships.some(relation => relation.field === 'invoice' && relation.target === 'Invoice' && relation.cardinality === 'required'));
  assert.equal(inventory.migrations.length, 26);
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
