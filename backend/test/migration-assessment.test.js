import test from 'node:test';
import assert from 'node:assert/strict';
import { assessmentConnection, assessDatabase, quoteIdentifier } from '../scripts/assess-database-migration.js';
import { PsqlReadOnlyClient } from '../scripts/lib/psql-readonly-client.js';

test('assessment connections require PostgreSQL, safe schemas, verified remote TLS and read-only startup', () => {
  assert.throws(() => assessmentConnection('https://example.test/db'), /PostgreSQL/);
  assert.throws(() => assessmentConnection('postgresql://example.test/db?schema=public%3BDROP'), /Unsafe schema/);
  assert.throws(() => assessmentConnection('postgresql://example.test/db?sslmode=disable'), /TLS/);
  const result = assessmentConnection('postgresql://user:secret@example.test/db?options=unsafe&sslmode=require');
  const url = new URL(result.connectionString);
  assert.equal(url.searchParams.get('sslmode'), 'verify-full');
  assert.equal(url.searchParams.get('options'), '-c default_transaction_read_only=on');
  assert.doesNotMatch(result.fingerprint, /user|secret|example/);
  assert.equal(quoteIdentifier('odd"name'), '"odd""name"');
});

test('assessment refuses table reads unless read-only mode is confirmed, and closes the session', async () => {
  const queries = [];
  const client = { async connect() {}, async end() { queries.push('CLOSE'); }, async query(sql) { queries.push(sql); return { rows: [{ transaction_read_only: 'off' }] }; } };
  const result = await assessDatabase('postgresql://localhost/test', { clientFactory: () => client });
  assert.equal(result.readOnly, false);
  assert.ok(!queries.some(sql => sql.includes('pg_class')));
  assert.ok(queries.includes('ROLLBACK')); assert.ok(queries.includes('CLOSE'));
});

test('driver failures never expose credentials, endpoint or arbitrary server messages', async () => {
  const result = await assessDatabase('postgresql://private_user:private_password@private.example.test/clinic', { clientFactory: () => ({ async connect() { throw Object.assign(new Error('private_password private_user private.example.test'), { code: '28P01' }); }, async query() {}, async end() {} }) });
  assert.equal(result.status, 'connection_failed');
  assert.doesNotMatch(JSON.stringify(result), /private_user|private_password|private\.example/);
  assert.equal(result.errors[0].code, '28P01');
});

test('psql transport quotes parameters and rejects every non-assessment control statement', async () => {
  const client = new PsqlReadOnlyClient({ connectionString: 'postgresql://localhost/test' });
  const queries = []; client.exchange = async sql => { queries.push(sql); return '[]'; };
  await client.query('SELECT $1 AS value', ["O'Brien $1"]);
  assert.match(queries[0], /'O''Brien \$1'/);
  for (const sql of ['INSERT INTO "Patient" DEFAULT VALUES', 'DELETE FROM "User"', 'ALTER TABLE x ADD y int', 'SET transaction_read_only=off', 'COMMIT', 'COPY x TO STDOUT']) {
    await assert.rejects(client.query(sql), /Unsupported read-only/);
  }
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query('ROLLBACK');
});
