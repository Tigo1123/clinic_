import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
import { registerQaCleanupDryRunRoute } from '../src/routes/qaCleanupDryRun.js';
import { CLEANUP_NAMESPACE, CleanupRefusal, cleanupDryRunEnvironment } from '../scripts/cleanup-staging-qa.mjs';
import { registrationBody, syntheticPatient } from '../scripts/qaPatientPlan.mjs';

const PATH = '/api/qa/cleanup-dry-run';
const TOKEN = 'synthetic-cleanup-http-credential-not-a-real-secret';
const SAFE_ENV = {
  NODE_ENV: 'production', APP_ENV: 'staging', DEPLOYMENT_ENV: 'staging', DATABASE_ENVIRONMENT: 'staging',
  QA_LOAD_TEST_ALLOWED: 'true', QA_LOAD_TEST_TARGET_ID: 'clinic-staging-qa-20261106',
  QA_EXPECTED_DATABASE_NAME: 'neondb', QA_EXPECTED_DATABASE_SCHEMA: 'public', QA_EXPECTED_DATABASE_ROLE: 'clinic_runtime',
  QA_NOTIFICATION_MODE: 'sink', NOTIFICATIONS_DISABLED: 'true', SMS_PROVIDER: 'disabled', QA_PAYMENT_MODE: 'disabled',
  VERIFICATION_PROVIDER: 'email', QA_VERIFICATION_CAPTURE_ENABLED: 'true', QA_VERIFICATION_CAPTURE_TOKEN: TOKEN,
  DATABASE_URL: 'postgresql://synthetic:fixture@ep-muddy-unit-b4hvj7be-pooler.c-6.us-east-2.aws.neon.tech/neondb?schema=public&sslmode=verify-full',
  DIRECT_URL: 'postgresql://synthetic:fixture@ep-muddy-unit-b4hvj7be.c-6.us-east-2.aws.neon.tech/neondb?schema=public&sslmode=verify-full'
};
const IDENTITY = { database: 'neondb', schema: 'public', role: 'clinic_runtime' };
const COUNTS = { accounts: 9, patients: 8, appointments: 8, registrations: 9,
  verificationChallenges: 9, authenticationChallenges: 0, auditRows: 33, notifications: 0 };

// In-memory synthetic query results only. No DATABASE_URL is ever connected to
// by this suite. Run the actual cleanup validation and record every SQL command.
function fixture() {
  const data = { User: [], Patient: [], PatientRegistration: [], VerificationChallenge: [],
    Appointment: [], TenantAuditLog: [], MfaChallenge: [], Notification: [] };
  for (let index = 1; index <= 9; index++) {
    const { email, phone, password, ...body } = registrationBody(syntheticPatient(CLEANUP_NAMESPACE, index, 1));
    const userId = `synthetic-user-${index}`, patientId = `synthetic-patient-${index}`;
    const appointmentId = `synthetic-appointment-${index}`;
    const names = { ...body,
      fullNameEn: [body.firstNameEn, body.fatherNameEn, body.grandfatherNameEn, body.familyNameEn].join(' '),
      fullNameAr: [body.firstNameAr, body.fatherNameAr, body.grandfatherNameAr, body.familyNameAr].join(' ') };
    data.User.push({ id: userId, username: email, email, phoneNormalized: phone, role: 'PATIENT',
      status: index <= 8 ? 'ACTIVE' : 'PENDING_VERIFICATION', authVersion: 0, mfaEnabled: false, hasMfaSecret: false,
      mustChangePassword: false, lastPasswordChange: null, phoneVerifiedAt: null,
      emailVerifiedAt: index <= 8 ? new Date() : null, createdAt: new Date('2026-11-06T09:54:00Z') });
    data.PatientRegistration.push({ userId, ...names });
    data.VerificationChallenge.push({ id: `synthetic-challenge-${index}`, userId, type: 'REGISTRATION_EMAIL',
      targetNormalized: email, authVersion: 0, attemptCount: index <= 8 ? 1 : 0,
      maxAttempts: 5, usedAt: index <= 8 ? new Date() : null });
    const audit = (action, details) => data.TenantAuditLog.push({ id: `audit-${index}-${action}`, userId, action, details });
    audit('PATIENT_ACCOUNT_REGISTRATION', 'Patient online account registration started.');
    if (index <= 8) {
      data.Patient.push({ id: patientId, userId, ...names, fileNumber: index, phone, status: 'ACTIVE',
        emergencyContact: 'Self', nationalId: null, bloodType: null, addressDetails: null,
        nationalIdAttachmentPath: null, insuranceAttachmentPath: null });
      data.Appointment.push({ id: appointmentId, patientId, doctorId: 'synthetic-doctor', status: 'PENDING' });
      audit('PATIENT_FILE_CREATED', JSON.stringify({ patientId, fileNumber: index, context: 'ONLINE_VERIFICATION' }));
      audit('PATIENT_RECORD_CREATED', `Created patient record ${patientId} for verified account.`);
      audit('PATIENT_APPOINTMENT_BOOKED', `Patient booked appointment ${appointmentId}.`);
    }
  }
  return data;
}

function harness(overrides = {}, options = {}) {
  const env = options.env || { ...SAFE_ENV, ...overrides };
  const data = fixture();
  options.changeFixture?.(data);
  const queries = [], identityQueries = [], clients = [];
  const app = express();
  const prismaClient = { $queryRaw: async () => {
    identityQueries.push(true);
    if (options.gateError) throw options.gateError;
    return [options.gateIdentity || IDENTITY];
  } };
  registerQaCleanupDryRunRoute(app, { env, prismaClient, createClient: clientOptions => {
    const state = { options: clientOptions, connected: false, ended: false, errorListener: null };
    clients.push(state);
    return {
      on: (event, listener) => { assert.equal(event, 'error'); state.errorListener = listener; },
      connect: async () => { state.connected = true; if (options.connectError) throw options.connectError; },
      end: async () => { state.ended = true; },
      query: async (sql, values) => {
        queries.push({ sql, values });
        // Fail immediately if the real validation ever tries any mutation,
        // locking read, writable transaction, or commit via this HTTP route.
        assert.ok(/^(SELECT|SET LOCAL|ROLLBACK|BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY)\b/.test(sql.trimStart()));
        assert.equal(/\b(INSERT|UPDATE|DELETE|TRUNCATE|COMMIT)\b/i.test(sql), false);
        if (sql.startsWith('SELECT current_database')) return { rows: [options.cleanupIdentity || IDENTITY] };
        if (sql.includes('AS count FROM pg_catalog.pg_class')) return { rows: [{ count: 8 }] };
        if (sql.includes('SELECT DISTINCT ns.nspname')) return { rows: [] };
        const table = /FROM public\."([A-Za-z]+)"/.exec(sql)?.[1];
        if (table) return { rows: structuredClone(data[table]) };
        return { rows: [] };
      }
    };
  } });
  app.use(express.json());
  return { app, env, data, queries, identityQueries, clients };
}

const get = h => request(h.app).get(PATH).set('Authorization', `Bearer ${TOKEN}`);
function noDatabase(h) {
  assert.equal(h.identityQueries.length, 0);
  assert.equal(h.clients.length, 0);
  assert.equal(h.queries.length, 0);
}

test('production, missing, local and mixed staging markers return opaque 404 before DB access', async () => {
  for (const overrides of [
    { APP_ENV: 'production' }, { DEPLOYMENT_ENV: 'production' }, { DATABASE_ENVIRONMENT: 'production' },
    { APP_ENV: 'staging', DEPLOYMENT_ENV: ' PRODUCTION ' }, { APP_ENV: 'local', DEPLOYMENT_ENV: 'local' },
    { APP_ENV: '' }, { DEPLOYMENT_ENV: '' }, { DATABASE_ENVIRONMENT: '' }
  ]) {
    const h = harness(overrides);
    assert.equal((await get(h).expect(404)).text, 'Not Found'); noDatabase(h);
  }
});

test('missing, wrong and malformed tokens return opaque 404 without inspecting DB', async () => {
  for (const authorization of [undefined, 'Bearer Wrong-Synthetic-Token', `Bearer  ${TOKEN}`, `Bearer ${TOKEN} extra`, `Basic ${TOKEN}`]) {
    const h = harness();
    const req = request(h.app).get(PATH);
    if (authorization) req.set('Authorization', authorization);
    assert.equal((await req.expect(404)).text, 'Not Found'); noDatabase(h);
  }
});

test('all exact staging gate, target, database, sink, capture and disabled-payment markers are mandatory', async () => {
  for (const overrides of [
    { QA_LOAD_TEST_ALLOWED: 'false' }, { QA_LOAD_TEST_TARGET_ID: 'other-staging-target' },
    { QA_EXPECTED_DATABASE_NAME: 'otherdb' }, { QA_EXPECTED_DATABASE_SCHEMA: 'private' },
    { QA_EXPECTED_DATABASE_ROLE: 'owner' }, { QA_NOTIFICATION_MODE: 'external' },
    { NOTIFICATIONS_DISABLED: 'false' }, { SMS_PROVIDER: 'transport' }, { QA_PAYMENT_MODE: 'external' },
    { QA_PAYMENT_MODE: 'ledger-only' }, { PAYMENT_API_KEY: 'synthetic-payment-key' },
    { QA_VERIFICATION_CAPTURE_ENABLED: 'false' }, { QA_VERIFICATION_CAPTURE_TOKEN: '' },
    { VERIFICATION_PROVIDER: 'development' }, { DATABASE_URL: 'postgresql://fixture:fixture@localhost/neondb' }
  ]) {
    const h = harness(overrides);
    assert.equal((await get(h).expect(404)).text, 'Not Found'); noDatabase(h);
  }
});

test('fresh identity gate mismatch or gate query failure returns opaque 404 without cleanup', async () => {
  for (const options of [
    { gateIdentity: { ...IDENTITY, database: 'other' } }, { gateIdentity: { ...IDENTITY, schema: 'private' } },
    { gateIdentity: { ...IDENTITY, role: 'owner' } }, { gateError: new Error(`${TOKEN} ${SAFE_ENV.DATABASE_URL}`) }
  ]) {
    const h = harness({}, options);
    assert.equal((await get(h).expect(404)).text, 'Not Found');
    assert.equal(h.identityQueries.length, 1); assert.equal(h.clients.length, 0);
  }
});

test('query parameters cannot change namespace, counts, execution, SQL, commands or DB connection', async () => {
  for (const query of [
    '?namespace=qa-20261106-deadbeef', '?QA_CLEANUP_NAMESPACE=qa-20261106-deadbeef', '?execute=true',
    '?QA_EXECUTE_CLEANUP=true', '?accounts=0', '?appointments=0', '?sql=DELETE', '?command=node',
    '?DATABASE_URL=untrusted'
  ]) {
    const h = harness();
    await request(h.app).get(PATH + query).set('Authorization', `Bearer ${TOKEN}`).expect(404); noDatabase(h);
  }
});

test('JSON, malformed JSON, text and chunked bodies are rejected before parsing or DB access', async () => {
  for (const body of ['{"QA_EXECUTE_CLEANUP":true}', '{}', '{malformed-json', 'command=delete']) {
    const h = harness();
    await get(h).set('Content-Type', 'application/json').send(body).expect(404); noDatabase(h);
  }
  const h = harness();
  await get(h).set('Transfer-Encoding', 'chunked').expect(404); noDatabase(h);
});

test('HEAD and write methods cannot invoke cleanup', async () => {
  for (const method of ['head', 'post', 'put', 'patch', 'delete']) {
    const h = harness();
    await request(h.app)[method](PATH).set('Authorization', `Bearer ${TOKEN}`).expect(404); noDatabase(h);
  }
});

test('success runs real validation read-only, rolls back, returns only safe counts and changes no fixture rows', async () => {
  const h = harness();
  const before = structuredClone(h.data);
  const response = await get(h).expect(200);
  assert.deepEqual(response.body, { namespace: CLEANUP_NAMESPACE, dryRun: true, deleted: false, counts: COUNTS });
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers.pragma, 'no-cache');
  assert.equal(response.headers['x-robots-tag'], 'noindex');
  assert.equal(h.identityQueries.length, 1);
  assert.equal(h.queries[0].sql, 'BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY');
  assert.equal(h.queries.at(-1).sql, 'ROLLBACK');
  assert.deepEqual(h.data, before);
  assert.equal(h.clients.length, 1); assert.equal(h.clients[0].ended, true);
  assert.equal(h.clients[0].options.connectionString === SAFE_ENV.DATABASE_URL, true);
  assert.equal(h.clients[0].options.connectionTimeoutMillis, 10_000);
  const addresses = h.queries.find(q => q.sql.includes('FROM public."User"')).values[0];
  assert.equal(addresses.length, 1000);
  assert.ok(addresses.every(value => /^qa-20261106-c16af28a\+patient-\d{3}@example\.invalid$/.test(value)));
  for (const sensitive of [TOKEN, SAFE_ENV.DATABASE_URL, SAFE_ENV.DIRECT_URL, 'synthetic-user',
    'synthetic-patient', 'example.invalid', 'clinic_runtime', 'neondb']) assert.equal(response.text.includes(sensitive), false);
});

test('inherited execution=true, wrong namespace and counts are forcibly overridden without mutating environment', async () => {
  const h = harness({ QA_EXECUTE_CLEANUP: 'true', QA_CLEANUP_NAMESPACE: 'qa-20261106-deadbeef',
    QA_EXPECTED_CLEANUP_ACCOUNTS: '0', QA_EXPECTED_CLEANUP_APPOINTMENTS: '0' });
  const before = { ...h.env };
  const response = await get(h).expect(200);
  assert.equal(response.body.dryRun, true); assert.equal(response.body.deleted, false);
  assert.equal(response.body.namespace, CLEANUP_NAMESPACE);
  assert.deepEqual(h.env, before);
  const snapshot = cleanupDryRunEnvironment(h.env);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(snapshot.QA_EXECUTE_CLEANUP, 'false');
  assert.throws(() => { snapshot.QA_EXECUTE_CLEANUP = 'true'; }, TypeError);
});

test('process.env execution flag is also overridden by the diagnostic', async () => {
  const keys = [...Object.keys(SAFE_ENV), 'QA_EXECUTE_CLEANUP'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, SAFE_ENV, { QA_EXECUTE_CLEANUP: 'true' });
    const h = harness({}, { env: process.env });
    const response = await get(h).expect(200);
    assert.equal(response.body.dryRun, true); assert.equal(response.body.deleted, false);
    assert.equal(process.env.QA_EXECUTE_CLEANUP, 'true');
    assert.equal(h.queries[0].sql, 'BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY');
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('cleanup footprint refusal returns only allowlisted reason and rolls back without mutation', async () => {
  const h = harness({}, { changeFixture: data => data.User.pop() });
  const before = structuredClone(h.data);
  const response = await get(h).expect(409);
  assert.deepEqual(response.body, { result: 'REFUSED', reason: 'count_mismatch' });
  assert.equal(h.queries.at(-1).sql, 'ROLLBACK'); assert.deepEqual(h.data, before);
  assert.equal(h.clients[0].ended, true);
});

test('identity changing between gate and cleanup remains an opaque 404 and read-only rollback', async () => {
  const h = harness({}, { cleanupIdentity: { ...IDENTITY, role: 'owner' } });
  assert.equal((await get(h).expect(404)).text, 'Not Found');
  assert.equal(h.queries.at(-1).sql, 'ROLLBACK'); assert.equal(h.clients[0].ended, true);
});

test('raw DB errors, forged refusal reasons and connection events never reach output or logs', async () => {
  const secret = `${TOKEN} ${SAFE_ENV.DATABASE_URL} jwt-fixture-secret password-fixture 123456 synthetic-challenge@example.invalid`;
  const forged = new CleanupRefusal('count_mismatch'); forged.reason = secret;
  const output = [], saved = {};
  for (const method of ['log', 'warn', 'error']) { saved[method] = console[method]; console[method] = (...args) => output.push(args); }
  try {
    for (const error of [new Error(secret), forged]) {
      const h = harness({}, { connectError: error });
      const response = await get(h).expect(409);
      assert.deepEqual(response.body, { result: 'REFUSED', reason: 'cleanup_failed' });
      h.clients[0].errorListener(new Error(secret));
      assert.equal(h.clients[0].ended, true);
    }
    assert.deepEqual(output, []);
  } finally { for (const [method, fn] of Object.entries(saved)) console[method] = fn; }
});

test('server registers diagnostic before JSON parsing so payload errors cannot reach global error logging', async () => {
  const server = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.ok(server.indexOf('registerQaCleanupDryRunRoute(app, { prismaClient: prisma })') < server.indexOf('app.use(express.json())'));
});
