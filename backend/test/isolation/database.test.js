import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import prisma from '../../src/db.js';
import { backendDir } from '../helpers/testRunner.js';
after(async () => prisma.$disconnect());

test('Prisma, raw pg, revocation URL and subprocesses stay on the same isolated test schema', async () => {
 const url = new URL(process.env.DATABASE_URL);
 assert.equal(url.pathname, '/clinic_test'); assert.equal(url.port, process.env.TEST_DATABASE_PORT || '5433');
 const schema = url.searchParams.get('schema'); assert.match(schema, /^test_[a-z0-9_]+$/);
 assert.equal(process.env.SOCKET_REVOCATION_DATABASE_URL, process.env.DATABASE_URL);
 const user = await prisma.user.create({ data: { username: `isolation-${crypto.randomUUID()}`, passwordHash: 'unused-fixture-hash', role: 'ADMIN' } });
 const client = new Client({ connectionString: process.env.SOCKET_REVOCATION_DATABASE_URL });
 await client.connect();
 try {
  const identity = (await client.query('SELECT current_database() AS database, current_schema() AS schema')).rows[0];
  assert.deepEqual(identity, { database: 'clinic_test', schema });
  assert.equal((await client.query('SELECT id FROM "User" WHERE id = $1', [user.id])).rows[0].id, user.id);
 } finally { await client.end(); }
 const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
  import { Client } from 'pg';
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const identity = (await client.query('SELECT current_database() AS database, current_schema() AS schema')).rows[0];
  const found = (await client.query('SELECT count(*)::int AS count FROM "User" WHERE id = $1', [process.env.ISOLATION_USER_ID])).rows[0].count;
  console.log(JSON.stringify({ ...identity, found })); await client.end();
 `], { cwd: backendDir, env: { ...process.env, ISOLATION_USER_ID: user.id }, encoding: 'utf8' });
 assert.equal(result.status, 0, 'Isolated pg subprocess must succeed');
 assert.deepEqual(JSON.parse(result.stdout), { database: 'clinic_test', schema, found: 1 });
});
