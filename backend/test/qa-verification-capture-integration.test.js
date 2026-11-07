import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import express from 'express';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma/index.js';
import applicationPrisma from '../src/db.js';
import { consumeVerificationChallenge } from '../src/services/verification.js';
import { captureQaVerificationCode, consumeQaVerificationCapture } from '../src/utils/qaVerificationCapture.js';
import { registerQaVerificationCaptureRoutes } from '../src/routes/qaVerificationCapture.js';
import { CAPTURE_ID, CAPTURE_EMAIL, CAPTURE_CODE, QA_CAPTURE_TEST_ENV as env } from './helpers/qaCaptureFixture.js';

const socket = process.env.QA_CAPTURE_TEST_SOCKET;
if (socket && !/^\/tmp\/shifa-qa-recovery-[A-Za-z0-9]+\/socket$/.test(socket)) throw new Error('invalid_capture_test_socket');
const integration = { skip: !socket ? 'Requires an explicitly guarded disposable PostgreSQL fixture.' : false };
let owner, first, second, userId, fixtureUrl;
before(async () => {
  if (!socket) return;
  owner = new Client({ host: socket, database: 'neondb', user: 'qa_recovery_owner' }); await owner.connect();
  const { rows: [settings] } = await owner.query("SELECT current_setting('data_directory') AS directory, current_setting('port') AS port");
  assert.equal(settings.directory, socket.replace(/\/socket$/, '/data'));
  const port = String(process.env.PGPORT || '5432'); assert.equal(settings.port, port);
  assert.match(port, /^\d{4,5}$/);
  await owner.query("SET TIME ZONE 'UTC'");
  await owner.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  const directory = new URL('../prisma/migrations/', import.meta.url);
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    await owner.query(await fs.readFile(new URL(entry.name + '/migration.sql', directory), 'utf8'));
  }
  await owner.query('GRANT USAGE ON SCHEMA public TO clinic_runtime');
  await owner.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO clinic_runtime');
  const url = 'postgresql://clinic_runtime@127.0.0.1:' + port + '/neondb?schema=public&connection_limit=3';
  fixtureUrl = url;
  // Never use DATABASE_URL/DIRECT_URL or any remote host from process.env.
  first = new PrismaClient({ datasources: { db: { url } } });
  second = new PrismaClient({ datasources: { db: { url } } });
});
after(async () => { await first?.$disconnect(); await second?.$disconnect(); await owner?.end(); });
beforeEach(async () => {
  if (!socket) return;
  await owner.query('TRUNCATE public."User" CASCADE');
  userId = randomUUID();
  await owner.query('INSERT INTO public."User" (id,username,email,"passwordHash",role,status) VALUES ($1,$2,$2,$3,$4,$5)',
    [userId, CAPTURE_EMAIL, 'unused-synthetic-hash', 'PATIENT', 'PENDING_VERIFICATION']);
  await owner.query('INSERT INTO public."VerificationChallenge" (id,"userId",type,"targetNormalized","codeHash","expiresAt","authVersion") VALUES ($1,$2,$3,$4,$5,$6,0)',
    [CAPTURE_ID, userId, 'REGISTRATION_EMAIL', CAPTURE_EMAIL, await bcrypt.hash(CAPTURE_CODE, 4), new Date(Date.now() + 600000).toISOString()]);
});
const seed = changes => captureQaVerificationCode({ env, prismaClient: first, challengeId: CAPTURE_ID, recipient: CAPTURE_EMAIL, code: CAPTURE_CODE, ...changes });
const consume = changes => consumeQaVerificationCapture({ env, prismaClient: second, challengeId: CAPTURE_ID, ...changes });
const records = () => first.qaVerificationCapture.findMany();

test('real PostgreSQL stores encrypted code only and enforces the additive expiry/FK constraints', integration, async () => {
  assert.equal(await seed(), true); const [row] = await records();
  assert.deepEqual(Object.keys(row).sort(), ['challengeId', 'codeEncrypted', 'createdAt', 'expiresAt']);
  assert.equal(row.codeEncrypted.includes(CAPTURE_CODE), false);
  assert.ok(row.expiresAt - row.createdAt <= 300000);
  await assert.rejects(owner.query('UPDATE public."QaVerificationCapture" SET "expiresAt"="createdAt"+interval \'6 minutes\''), error => error.code === '23514');
  await assert.rejects(owner.query('INSERT INTO public."QaVerificationCapture" ("challengeId","codeEncrypted","expiresAt") VALUES ($1,$2,now()+interval \'1 minute\')',
    [randomUUID(), 'synthetic-encrypted-fixture']), error => error.code === '23503');
});

test('capture survives client/module restart and is usable from a fresh service instance within TTL', integration, async () => {
  await seed(); await first.$disconnect();
  const program = [
    "import {PrismaClient} from './src/generated/prisma/index.js';",
    "import {consumeQaVerificationCapture} from './src/utils/qaVerificationCapture.js';",
    "import {CAPTURE_ID,CAPTURE_CODE,QA_CAPTURE_TEST_ENV as env} from './test/helpers/qaCaptureFixture.js';",
    'const client=new PrismaClient({datasources:{db:{url:' + JSON.stringify(fixtureUrl) + '}}});',
    'try{const result=await consumeQaVerificationCapture({env,prismaClient:client,challengeId:CAPTURE_ID});',
    'console.log(JSON.stringify({consumed:result.capture?.code===CAPTURE_CODE}));}finally{await client.$disconnect();}'
  ].join('\n');
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', program], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), timeout: 15000
  });
  assert.deepEqual(JSON.parse(stdout.trim()), { consumed: true });
  assert.equal((await records()).length, 0);
});

test('captured code completes the normal verification challenge checks without bypassing OTP validation', integration, async t => {
  await seed(); const result = await consume();
  t.mock.method(applicationPrisma, '$transaction', first.$transaction.bind(first));
  const original = applicationPrisma.verificationChallenge.findUnique;
  applicationPrisma.verificationChallenge.findUnique = (...args) => first.verificationChallenge.findUnique(...args);
  t.after(() => { applicationPrisma.verificationChallenge.findUnique = original; });
  const options = { challengeId: CAPTURE_ID, code: result.capture.code, purpose: 'REGISTRATION_EMAIL', transition: async () => 'verified-fixture' };
  assert.equal(await consumeVerificationChallenge(options), 'verified-fixture');
  const challenge = await first.verificationChallenge.findUnique({ where: { id: CAPTURE_ID } });
  assert.ok(challenge.usedAt); assert.equal(challenge.attemptCount, 1);
  await assert.rejects(consumeVerificationChallenge(options), error => error.code === 'VERIFICATION_INVALID');
  assert.equal((await records()).length, 0);
});

test('five-minute expiry is preserved across instances and expired rows are deleted on lookup', integration, async () => {
  await seed(); const [row] = await records();
  assert.equal((await consume({ now: row.expiresAt.getTime() + 1 })).capture, null);
  assert.equal((await records()).length, 0);
});

test('new capture persistence opportunistically prunes other expired QA captures', integration, async () => {
  const old = randomUUID();
  await owner.query('INSERT INTO public."VerificationChallenge" (id,"userId",type,"targetNormalized","codeHash","expiresAt","authVersion") VALUES ($1,$2,$3,$4,$5,now()-interval \'1 minute\',0)',
    [old, userId, 'REGISTRATION_EMAIL', CAPTURE_EMAIL, 'unused-synthetic-hash']);
  await owner.query('INSERT INTO public."QaVerificationCapture" ("challengeId","codeEncrypted","createdAt","expiresAt") VALUES ($1,$2,now()-interval \'10 minutes\',now()-interval \'5 minutes\')',
    [old, 'expired-synthetic-encrypted-fixture']);
  assert.equal(await seed(), true);
  const rows = await records(); assert.equal(rows.length, 1); assert.equal(rows[0].challengeId, CAPTURE_ID);
});

test('capture expires at the earlier real challenge expiry', integration, async () => {
  const expiry = new Date(Date.now() + 30000);
  await owner.query('UPDATE public."VerificationChallenge" SET "expiresAt"=$1 WHERE id=$2', [expiry.toISOString(), CAPTURE_ID]);
  await seed(); assert.equal((await records())[0].expiresAt.getTime(), expiry.getTime());
  assert.equal((await consume({ now: expiry.getTime() + 1 })).capture, null);
  assert.equal((await records()).length, 0);
});

test('wrong encryption key fails closed and atomically discards the encrypted capture', integration, async () => {
  await seed();
  assert.deepEqual(await consume({ env: { ...env, QA_VERIFICATION_CAPTURE_STORAGE_KEY: 'b2'.repeat(32) } }),
    { capture: null, reason: 'capture_consumption_failed' });
  assert.equal((await records()).length, 0);
});

test('concurrent real database consumers across service instances have exactly one successful consume', integration, async () => {
  await seed();
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => consume({ prismaClient: index % 2 ? first : second })));
  assert.equal(results.filter(result => result.capture?.code === CAPTURE_CODE).length, 1);
  assert.equal((await records()).length, 0);
});

for (const mutation of ['used', 'expired', 'active', 'identity', 'generation', 'attempts']) {
  test('real ' + mutation + ' challenge cannot be consumed and its capture is discarded', integration, async () => {
    await seed();
    if (mutation === 'used') await owner.query('UPDATE public."VerificationChallenge" SET "usedAt"=now() WHERE id=$1', [CAPTURE_ID]);
    if (mutation === 'expired') await owner.query('UPDATE public."VerificationChallenge" SET "expiresAt"=now()-interval \'1 second\' WHERE id=$1', [CAPTURE_ID]);
    if (mutation === 'active') await owner.query('UPDATE public."User" SET status=$1 WHERE id=$2', ['ACTIVE', userId]);
    if (mutation === 'identity') await owner.query('UPDATE public."User" SET email=$1 WHERE id=$2', ['other@example.invalid', userId]);
    if (mutation === 'generation') await owner.query('UPDATE public."User" SET "authVersion"=1 WHERE id=$1', [userId]);
    if (mutation === 'attempts') await owner.query('UPDATE public."VerificationChallenge" SET "attemptCount"="maxAttempts" WHERE id=$1', [CAPTURE_ID]);
    assert.equal((await consume()).capture, null); assert.equal((await records()).length, 0);
  });
}

test('a concurrent verification transition is checked after acquiring the real account lock', integration, async () => {
  await seed(); await owner.query('BEGIN');
  try {
    await owner.query('SELECT id FROM public."User" WHERE id=$1 FOR UPDATE', [userId]);
    const pending = consume();
    assert.equal(await Promise.race([pending.then(() => true), delay(50).then(() => false)]), false);
    await owner.query('UPDATE public."VerificationChallenge" SET "usedAt"=now() WHERE id=$1', [CAPTURE_ID]);
    await owner.query('COMMIT');
    assert.equal((await pending).capture, null); assert.equal((await records()).length, 0);
  } finally { await owner.query('ROLLBACK'); }
});

test('real encrypted-row corruption and injected raw DB errors remain opaque in HTTP responses and logs', integration, async () => {
  await seed(); const events = [];
  const [row] = await records();
  await owner.query('UPDATE public."QaVerificationCapture" SET "codeEncrypted"=$1', ['corrupt-ciphertext-fixture']);
  const app = express(); registerQaVerificationCaptureRoutes(app, { env, prismaClient: second, log: { info: (...args) => events.push(args) } });
  const response = await request(app).get('/api/qa/verification-capture/' + CAPTURE_ID)
    .set('Authorization', 'Bearer ' + env.QA_VERIFICATION_CAPTURE_TOKEN).expect(404);
  assert.equal(response.text, 'Not Found'); assert.equal((await records()).length, 0);
  assert.deepEqual(events, [['qa.verification_capture_denied', { reason: 'capture_consumption_failed' }]]);
  const raw = new Error(row.codeEncrypted + env.QA_VERIFICATION_CAPTURE_STORAGE_KEY + env.QA_VERIFICATION_CAPTURE_TOKEN);
  const failing = { $queryRaw: (...args) => second.$queryRaw(...args), $transaction: async () => { throw raw; } };
  const errorApp = express(); registerQaVerificationCaptureRoutes(errorApp, { env, prismaClient: failing, log: { info: (...args) => events.push(args) } });
  const failure = await request(errorApp).get('/api/qa/verification-capture/' + CAPTURE_ID)
    .set('Authorization', 'Bearer ' + env.QA_VERIFICATION_CAPTURE_TOKEN).expect(404);
  const output = response.text + failure.text + JSON.stringify(events);
  for (const sensitive of [row.codeEncrypted, CAPTURE_CODE, CAPTURE_EMAIL, env.QA_VERIFICATION_CAPTURE_STORAGE_KEY, env.QA_VERIFICATION_CAPTURE_TOKEN]) assert.equal(output.includes(sensitive), false);
});

test('capture row is tied to its real challenge by ON DELETE CASCADE', integration, async () => {
  await seed(); await owner.query('DELETE FROM public."VerificationChallenge" WHERE id=$1', [CAPTURE_ID]);
  assert.equal((await records()).length, 0); assert.equal((await consume()).capture, null);
});
