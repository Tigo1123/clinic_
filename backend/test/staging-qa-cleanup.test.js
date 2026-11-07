import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { CLEANUP_NAMESPACE, cleanupCli, cleanupStagingQa, validateCleanupEnvironment } from '../scripts/cleanup-staging-qa.mjs';
import { registrationBody, syntheticPatient } from '../scripts/qaPatientPlan.mjs';

const safeEnv = {
  APP_ENV: 'staging', DEPLOYMENT_ENV: 'staging', NODE_ENV: 'production', DATABASE_ENVIRONMENT: 'staging',
  QA_LOAD_TEST_ALLOWED: 'true', QA_LOAD_TEST_TARGET_ID: 'clinic-staging-qa-20261106',
  QA_EXPECTED_DATABASE_NAME: 'neondb', QA_EXPECTED_DATABASE_SCHEMA: 'public', QA_EXPECTED_DATABASE_ROLE: 'clinic_runtime',
  QA_NOTIFICATION_MODE: 'sink', NOTIFICATIONS_DISABLED: 'true', SMS_PROVIDER: 'disabled', QA_PAYMENT_MODE: 'disabled',
  VERIFICATION_PROVIDER: 'email', QA_VERIFICATION_CAPTURE_ENABLED: 'true',
  QA_VERIFICATION_CAPTURE_TOKEN: 'synthetic-cleanup-credential-not-a-real-secret',
  QA_VERIFICATION_CAPTURE_STORAGE_KEY: 'a1'.repeat(32),
  DATABASE_URL: 'postgresql://synthetic:fixture@ep-muddy-unit-b4hvj7be-pooler.c-6.us-east-2.aws.neon.tech/neondb?schema=public&sslmode=verify-full',
  DIRECT_URL: 'postgresql://synthetic:fixture@ep-muddy-unit-b4hvj7be.c-6.us-east-2.aws.neon.tech/neondb?schema=public&sslmode=verify-full',
  QA_EXPECTED_CLEANUP_ACCOUNTS: '10', QA_EXPECTED_CLEANUP_APPOINTMENTS: '8'
};

test('cleanup defaults to dry-run and is pinned to exact namespace, target, identity and counts', () => {
  assert.equal(validateCleanupEnvironment(safeEnv).execute, false);
  assert.equal(CLEANUP_NAMESPACE, 'qa-20261106-73412c3e');
  assert.equal(validateCleanupEnvironment({ ...safeEnv, QA_EXECUTE_CLEANUP: 'true' }).execute, true);
  for (const change of [
    { QA_CLEANUP_NAMESPACE: 'qa-20261106-c16af28a' }, { QA_CLEANUP_NAMESPACE: 'qa-20261106-deadbeef' }, { QA_CLEANUP_NAMESPACE: '%' },
    { QA_CLEANUP_NAMESPACE: CLEANUP_NAMESPACE + '+patient-001@example.invalid' },
    { QA_LOAD_TEST_TARGET_ID: 'other-staging-target' }, { QA_EXPECTED_DATABASE_ROLE: 'owner' },
    { QA_EXPECTED_DATABASE_SCHEMA: 'private' }, { QA_EXPECTED_CLEANUP_ACCOUNTS: undefined },
    { QA_EXPECTED_CLEANUP_ACCOUNTS: '9' }, { QA_EXPECTED_CLEANUP_APPOINTMENTS: '9' }, { QA_EXECUTE_CLEANUP: 'yes' }
  ]) assert.throws(() => validateCleanupEnvironment({ ...safeEnv, ...change }));
  const { emails } = validateCleanupEnvironment(safeEnv);
  assert.equal(emails.length, 1000);
  assert.ok(emails.every(email => /^qa-20261106-73412c3e\+patient-\d{3}@example\.invalid$/.test(email)));
});

test('production, local, unknown and incomplete staging configurations refuse before connecting', async () => {
  for (const change of [
    { APP_ENV: 'production' }, { DEPLOYMENT_ENV: 'production' }, { DATABASE_ENVIRONMENT: 'production' },
    { APP_ENV: 'local', DEPLOYMENT_ENV: 'local' }, { APP_ENV: '' }, { DEPLOYMENT_ENV: 'unknown' },
    { QA_LOAD_TEST_ALLOWED: 'false' }, { QA_NOTIFICATION_MODE: 'external' }, { SMS_PROVIDER: 'transport' }
  ]) {
    let connected = false; const output = [];
    const code = await cleanupCli({ env: { ...safeEnv, ...change, QA_EXECUTE_CLEANUP: 'true' },
      createClient: () => { connected = true; throw new Error('must not connect'); }, log: line => output.push(line) });
    assert.equal(code, 1);
    assert.equal(connected, false);
    assert.equal(JSON.parse(output[0]).result, 'REFUSED');
  }
});

test('cleanup errors never print database URLs, credentials, codes, or raw exception contents', async () => {
  const output = [];
  const secret = 'synthetic-sensitive-exception-sentinel';
  const code = await cleanupCli({ env: safeEnv, log: value => output.push(value), createClient: () => ({
    connect: async () => { throw new Error(secret + safeEnv.DATABASE_URL + safeEnv.QA_VERIFICATION_CAPTURE_TOKEN); }, end: async () => {}
  }) });
  assert.equal(code, 1);
  assert.deepEqual(JSON.parse(output[0]), { namespace: CLEANUP_NAMESPACE, result: 'REFUSED', reason: 'cleanup_failed' });
  for (const sensitive of [secret, safeEnv.DATABASE_URL, safeEnv.QA_VERIFICATION_CAPTURE_TOKEN]) assert.equal(output.join('').includes(sensitive), false);
});

test('unknown CLI switches cannot override or disguise the explicit execution flag', async () => {
  let connected = false;
  const output = [];
  const result = await cleanupCli({ env: { ...safeEnv, QA_EXECUTE_CLEANUP: 'true' }, args: ['--dry-run'],
    createClient: () => { connected = true; }, log: line => output.push(line) });
  assert.equal(result, 1); assert.equal(connected, false);
  assert.equal(JSON.parse(output[0]).reason, 'invalid_execution_flag');
});

// Only an explicitly supplied, private Unix socket belonging to a disposable
// cluster is accepted. Application DATABASE_URL is never used by these tests.
const socket = process.env.QA_CLEANUP_TEST_SOCKET;
if (socket && !/^\/tmp\/shifa-qa-recovery-[A-Za-z0-9]+\/socket$/.test(socket)) throw new Error('invalid_cleanup_test_socket');
const integration = { skip: !socket ? 'Set QA_CLEANUP_TEST_SOCKET to an isolated private test cluster.' : false };
let owner;
let fixture;
const clients = new Set();
const runtime = async () => {
  const client = new Client({ host: socket, database: 'neondb', user: 'clinic_runtime' });
  await client.connect(); clients.add(client); return client;
};
before(async () => {
  if (!socket) return;
  const bootstrap = new Client({ host: socket, database: 'postgres', user: 'qa_recovery_owner' });
  await bootstrap.connect();
  try {
    const { rows: [settings] } = await bootstrap.query("SELECT current_setting('data_directory') AS directory, current_setting('port') AS port");
    assert.equal(settings.directory, socket.replace(/\/socket$/, '/data'));
    assert.equal(settings.port, String(process.env.PGPORT || '5432'));
    if (!(await bootstrap.query("SELECT 1 FROM pg_database WHERE datname='neondb'")).rowCount) await bootstrap.query('CREATE DATABASE neondb');
    if (!(await bootstrap.query("SELECT 1 FROM pg_roles WHERE rolname='clinic_runtime'")).rowCount) await bootstrap.query('CREATE ROLE clinic_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE');
  }
  finally { await bootstrap.end(); }
  owner = new Client({ host: socket, database: 'neondb', user: 'qa_recovery_owner' }); await owner.connect();
  await owner.query("SET TIME ZONE 'UTC'");
  await owner.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  const migrations = new URL('../prisma/migrations/', import.meta.url);
  for (const entry of (await fs.readdir(migrations, { withFileTypes: true })).filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    await owner.query(await fs.readFile(new URL(`${entry.name}/migration.sql`, migrations), 'utf8'));
  }
  await owner.query('GRANT USAGE ON SCHEMA public TO clinic_runtime');
  await owner.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO clinic_runtime');
  await owner.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO clinic_runtime');
});
after(async () => { for (const client of clients) await client.end(); if (owner) await owner.end(); });

beforeEach(async () => {
  if (!socket) return;
  await owner.query('TRUNCATE public."Notification", public."TenantAuditLog", public."User", public."State" RESTART IDENTITY CASCADE');
  await owner.query('INSERT INTO public."State" (id,"labelAr","labelEn") VALUES (1,$1,$2)', ['اختبار', 'Test']);
  const staffId = randomUUID(), doctorUserId = randomUUID(), doctorId = randomUUID();
  for (const [id, role] of [[staffId, 'ADMIN'], [doctorUserId, 'DOCTOR']]) await owner.query('INSERT INTO public."User" (id,username,"passwordHash",role) VALUES ($1,$1,$2,$3)', [id, 'unused-test-hash', role]);
  await owner.query('INSERT INTO public."Doctor" (id,"userId","fullNameAr","fullNameEn","specialtyAr","specialtyEn","consultationFee","weeklySchedule","updatedAt") VALUES ($1,$2,$3,$4,$3,$4,0,$5,now())', [doctorId, doctorUserId, 'اختبار', 'Test', '{}']);
  fixture = { users: [], patients: [], appointments: [], doctorId };
  const insert = async (table, row) => owner.query(`INSERT INTO public."${table}" (${Object.keys(row).map(key => `"${key}"`).join(',')}) VALUES (${Object.keys(row).map((_, index) => `$${index + 1}`).join(',')}) RETURNING *`, Object.values(row));
  const audit = async (userId, action, details) => insert('TenantAuditLog', { id: randomUUID(), userId, action, details, ipAddress: 'test' });
  for (let index = 1; index <= 10; index++) {
    const body = registrationBody(syntheticPatient(CLEANUP_NAMESPACE, index, 1));
    const userId = randomUUID();
    await insert('User', { id: userId, username: body.email, email: body.email, phoneNormalized: body.phone,
      passwordHash: 'unused-test-hash', role: 'PATIENT', status: index <= 8 ? 'ACTIVE' : 'PENDING_VERIFICATION',
      emailVerifiedAt: index <= 8 ? new Date() : null, createdAt: index === 10 ? '2026-11-07T06:26:00Z' : '2026-11-06T21:10:00Z' });
    fixture.users.push(userId);
    const { email, phone, password, ...registration } = body;
    registration.fullNameEn = [body.firstNameEn, body.fatherNameEn, body.grandfatherNameEn, body.familyNameEn].join(' ');
    registration.fullNameAr = [body.firstNameAr, body.fatherNameAr, body.grandfatherNameAr, body.familyNameAr].join(' ');
    await insert('PatientRegistration', { userId, ...registration });
    await insert('VerificationChallenge', { id: randomUUID(), userId, type: 'REGISTRATION_EMAIL', targetNormalized: email,
      authVersion: 0, codeHash: 'unused-test-hash', expiresAt: new Date(), usedAt: index <= 8 ? new Date() : null, attemptCount: index <= 8 ? 1 : 0 });
    await audit(userId, 'PATIENT_ACCOUNT_REGISTRATION', 'Patient online account registration started.');
    if (index <= 8) {
      const patientId = randomUUID();
      const { rows: [patient] } = await insert('Patient', { id: patientId, userId, ...registration, phone, emergencyContact: 'Self' });
      fixture.patients.push(patientId);
      await audit(userId, 'PATIENT_FILE_CREATED', JSON.stringify({ patientId, fileNumber: patient.fileNumber, context: 'ONLINE_VERIFICATION' }));
      await audit(userId, 'PATIENT_RECORD_CREATED', `Created patient record ${patientId} for verified account.`);
      const appointmentId = randomUUID(); fixture.appointments.push(appointmentId);
      await insert('Appointment', { id: appointmentId, patientId, doctorId, appointmentDate: '2026-11-07', appointmentTime: `1${index}:00`, status: 'PENDING' });
      await audit(userId, 'PATIENT_APPOINTMENT_BOOKED', `Patient booked appointment ${appointmentId}.`);
    }
  }
  const unrelatedUser = randomUUID(); fixture.unrelatedUser = unrelatedUser;
  await insert('User', { id: unrelatedUser, username: 'other-qa@example.invalid', email: 'other-qa@example.invalid', passwordHash: 'unused-test-hash', role: 'PATIENT' });
  const unrelatedPatient = randomUUID(); fixture.unrelatedPatient = unrelatedPatient;
  await insert('Patient', { id: unrelatedPatient, userId: unrelatedUser, fullNameAr: 'اختبار آخر', fullNameEn: 'Other fixture', gender: 'MALE', dateOfBirth: '1990-01-01', phone: '+12025550199', addressStateId: 1, emergencyContact: 'Self' });
  const unrelatedAppointment = randomUUID(); fixture.unrelatedAppointment = unrelatedAppointment;
  await insert('Appointment', { id: unrelatedAppointment, patientId: unrelatedPatient, doctorId, appointmentDate: '2026-11-08', appointmentTime: '23:00', status: 'PENDING' });
  await audit(unrelatedUser, 'UNRELATED_BUSINESS_ACTION', 'Must remain untouched.');
});

const scopedCounts = async () => (await owner.query(`SELECT
  (SELECT count(*)::int FROM public."User" WHERE id=ANY($1::text[])) AS users,
  (SELECT count(*)::int FROM public."Patient" WHERE id=ANY($2::text[])) AS patients,
  (SELECT count(*)::int FROM public."Appointment" WHERE id=ANY($3::text[])) AS appointments`, [fixture.users, fixture.patients, fixture.appointments])).rows[0];
const execute = async (changes = {}, client) => cleanupStagingQa({ env: { ...safeEnv, QA_EXECUTE_CLEANUP: 'true', ...changes }, client: client || await runtime() });
const trackedRuntime = async () => {
  const connection = await runtime(); const queries = [];
  return { queries, query: (sql, values) => { queries.push(sql); return connection.query(sql, values); } };
};
const snapshot = async () => {
  const counts = {};
  for (const table of ['User', 'Patient', 'Appointment', 'PatientRegistration', 'VerificationChallenge', 'QaVerificationCapture', 'MfaChallenge', 'TenantAuditLog', 'Notification']) {
    counts[table] = (await owner.query(`SELECT count(*)::int AS count FROM public."${table}"`)).rows[0].count;
  }
  return counts;
};
const refusesBeforeDelete = async reason => {
  const before = await snapshot(), client = await trackedRuntime();
  await assert.rejects(execute({}, client), error => error.reason === reason);
  assert.equal(client.queries.some(sql => /^\s*DELETE\b/i.test(sql)), false);
  assert.equal(client.queries.at(-1), 'ROLLBACK');
  assert.deepEqual(await snapshot(), before);
};

test('dry-run validates the complete real schema footprint and changes no rows', integration, async () => {
  const before = await snapshot(), client = await trackedRuntime();
  const result = await cleanupStagingQa({ env: safeEnv, client });
  assert.equal(result.dryRun, true); assert.equal(result.deleted, false);
  assert.equal(result.counts.accounts, 10); assert.equal(result.counts.patients, 8); assert.equal(result.counts.appointments, 8);
  assert.equal(result.counts.registrations, 10); assert.equal(result.counts.verificationChallenges, 10);
  assert.equal(result.counts.verificationCaptures, 0);
  assert.ok(result.counts.notifications > 0, 'real migration triggers generated QA notices');
  assert.deepEqual(await snapshot(), before);
  assert.equal(client.queries[0], 'BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY');
  assert.equal(client.queries.at(-1), 'ROLLBACK');
  assert.equal(client.queries.some(sql => /\b(DELETE|INSERT|UPDATE|COMMIT)\b/i.test(sql)), false);
  for (const sensitive of [safeEnv.DATABASE_URL, safeEnv.QA_VERIFICATION_CAPTURE_TOKEN, safeEnv.QA_VERIFICATION_CAPTURE_STORAGE_KEY, 'unused-test-hash', ...fixture.users]) assert.equal(JSON.stringify(result).includes(sensitive), false);
});

test('actual count mismatch refuses deletion and leaves all accounts untouched', integration, async () => {
  await owner.query('DELETE FROM public."Appointment" WHERE id=$1', [fixture.appointments[0]]);
  await assert.rejects(execute(), error => error.reason === 'count_mismatch');
  assert.equal((await scopedCounts()).users, 10);
});

test('live database identity is pinned and owner connections cannot delete', integration, async () => {
  await assert.rejects(execute({}, owner), error => error.reason === 'database_identity_not_allowed');
  assert.deepEqual(await scopedCounts(), { users: 10, patients: 8, appointments: 8 });
});

test('successful deletion removes only the exact synthetic scope and validated child rows', integration, async () => {
  await owner.query('INSERT INTO public."MfaChallenge" (id,"userId",purpose,"authVersion","tokenHash","expiresAt") VALUES ($1,$2,$3,0,$4,now())', [randomUUID(), fixture.users[0], 'LOGIN', 'unused-test-hash']);
  const unrelatedChallenge = randomUUID();
  await owner.query('INSERT INTO public."VerificationChallenge" (id,"userId",type,"targetNormalized","codeHash","expiresAt") VALUES ($1,$2,$3,$4,$5,now())',
    [unrelatedChallenge, fixture.unrelatedUser, 'REGISTRATION_EMAIL', 'other-qa@example.invalid', 'unused-test-hash']);
  await owner.query('INSERT INTO public."QaVerificationCapture" ("challengeId","codeEncrypted","expiresAt") VALUES ($1,$2,now()+interval \'1 minute\')',
    [unrelatedChallenge, 'unrelated-encrypted-test-fixture']);
  const client = await trackedRuntime();
  const result = await execute({}, client);
  assert.equal(result.deleted, true); assert.equal(result.dryRun, false);
  assert.equal(client.queries[0], 'BEGIN ISOLATION LEVEL SERIALIZABLE');
  assert.equal(client.queries.at(-1), 'COMMIT');
  const deletes = client.queries.filter(sql => sql.startsWith('DELETE')).map(sql => sql.match(/public\."([^"]+)"/)[1]);
  assert.deepEqual(deletes, ['Appointment', 'MfaChallenge', 'VerificationChallenge', 'PatientRegistration', 'Notification', 'Patient', 'TenantAuditLog', 'User']);
  assert.ok(client.queries.findIndex(sql => sql.includes('pg_catalog.pg_constraint')) < client.queries.findIndex(sql => sql.startsWith('DELETE')));
  assert.deepEqual(result.remaining, { users: 0, patients: 0, appointments: 0 });
  assert.deepEqual(await scopedCounts(), { users: 0, patients: 0, appointments: 0 });
  assert.equal((await owner.query('SELECT count(*)::int AS count FROM public."User" WHERE id=$1', [fixture.unrelatedUser])).rows[0].count, 1);
  assert.equal((await owner.query('SELECT count(*)::int AS count FROM public."Patient" WHERE id=$1', [fixture.unrelatedPatient])).rows[0].count, 1);
  assert.equal((await owner.query('SELECT count(*)::int AS count FROM public."Appointment" WHERE id=$1', [fixture.unrelatedAppointment])).rows[0].count, 1);
  assert.equal((await owner.query('SELECT count(*)::int AS count FROM public."TenantAuditLog" WHERE "userId"=$1', [fixture.unrelatedUser])).rows[0].count, 1);
  assert.equal((await owner.query('SELECT count(*)::int AS count FROM public."Notification" WHERE "entityId"=$1', [fixture.unrelatedAppointment])).rows[0].count > 0, true);
  assert.equal((await owner.query('SELECT count(*)::int AS count FROM public."QaVerificationCapture" WHERE "challengeId"=$1', [unrelatedChallenge])).rows[0].count, 1);
  assert.equal(result.counts.verificationCaptures, 0);
});

test('late deletion failure rolls back earlier appointment and patient deletions', integration, async () => {
  const before = await snapshot();
  const connection = await runtime();
  const client = { query: (sql, values) => {
    if (sql.startsWith('DELETE FROM public."User"')) throw new Error('synthetic failure after child deletes');
    return connection.query(sql, values);
  } };
  await assert.rejects(execute({}, client), error => error.reason === 'cleanup_failed');
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await scopedCounts(), { users: 10, patients: 8, appointments: 8 });
  assert.equal((await owner.query('SELECT count(*)::int AS count FROM public."TenantAuditLog" WHERE "userId"=ANY($1::text[])', [fixture.users])).rows[0].count, 34);
});

for (const model of ['MedicalRecord', 'Prescription', 'LabOrder', 'Invoice', 'InsuranceClaim', 'PatientInsurance', 'Consent']) {
  test(`${model} or related clinical/business records refuse cleanup`, integration, async () => {
    const id = randomUUID(), patient = fixture.patients[0], appointment = fixture.appointments[0], doctor = fixture.doctorId;
    if (['MedicalRecord', 'Prescription', 'LabOrder'].includes(model)) {
      await owner.query('INSERT INTO public."MedicalRecord" (id,"patientId","doctorId","appointmentId","symptomsEncrypted","diagnosisEncrypted","treatmentEncrypted","vitalSignsJson","clinicalNotesEncrypted") VALUES ($1,$2,$3,$4,$5,$5,$5,$6,$5)', [id, patient, doctor, appointment, 'synthetic', '{}']);
      if (model === 'Prescription') await owner.query('INSERT INTO public."Prescription" (id,"patientId","doctorId","medicalRecordId") VALUES ($1,$2,$3,$4)', [randomUUID(), patient, doctor, id]);
      if (model === 'LabOrder') await owner.query('INSERT INTO public."LabOrder" (id,"patientId","doctorId","medicalRecordId") VALUES ($1,$2,$3,$4)', [randomUUID(), patient, doctor, id]);
    } else if (model === 'Invoice') {
      await owner.query('INSERT INTO public."Invoice" (id,"patientId","appointmentId","totalAmountSdg","totalAmountUsd","invoiceExchangeRate","createdBy") VALUES ($1,$2,$3,0,0,1,$4)', [id, patient, appointment, fixture.unrelatedUser]);
    } else if (model === 'Consent') {
      await owner.query('INSERT INTO public."Consent" (id,"patientId","consentType") VALUES ($1,$2,$3)', [id, patient, 'TREATMENT']);
    } else {
      const company = randomUUID();
      await owner.query('INSERT INTO public."InsuranceCompany" (id,"labelAr","labelEn","copayPercentage") VALUES ($1,$2,$2,0)', [company, 'Test insurance']);
      if (model === 'InsuranceClaim') await owner.query('INSERT INTO public."InsuranceClaim" (id,"patientId","insuranceCompanyId","invoiceId","claimAmountSdg") VALUES ($1,$2,$3,$4,0)', [id, patient, company, randomUUID()]);
      else await owner.query('INSERT INTO public."PatientInsurance" (id,"patientId","insuranceCompanyId","memberNumber","validFrom","validUntil","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())', [id, patient, company, 'synthetic', '2026-01-01', '2027-01-01']);
    }
    await assert.rejects(execute(), error => error.reason === 'unexpected_related_records');
    assert.deepEqual(await scopedCounts(), { users: 10, patients: 8, appointments: 8 });
  });
}

test('unknown cascading child tables also refuse cleanup', integration, async () => {
  await owner.query('CREATE TABLE public."UnexpectedQaChild" (id text PRIMARY KEY, "captureId" text REFERENCES public."VerificationChallenge"(id) ON DELETE CASCADE)');
  await owner.query('GRANT SELECT ON public."UnexpectedQaChild" TO clinic_runtime');
  try {
    await owner.query('INSERT INTO public."UnexpectedQaChild" SELECT $1,id FROM public."VerificationChallenge" WHERE "userId"=$2', [randomUUID(), fixture.users[0]]);
    await assert.rejects(execute(), error => error.reason === 'unexpected_related_records');
    assert.deepEqual(await scopedCounts(), { users: 10, patients: 8, appointments: 8 });
  } finally { await owner.query('DROP TABLE public."UnexpectedQaChild"'); }
});

test('business audit actions outside the runner footprint refuse cleanup', integration, async () => {
  await owner.query('INSERT INTO public."TenantAuditLog" (id,"userId",action,details,"ipAddress") VALUES ($1,$2,$3,$4,$5)',
    [randomUUID(), fixture.users[0], 'PATIENT_PROFILE_UPDATED', 'Unexpected manual action', 'test']);
  await assert.rejects(execute(), error => error.reason === 'unexpected_audit');
  assert.deepEqual(await scopedCounts(), { users: 10, patients: 8, appointments: 8 });
});

test('unexpected patient profile data refuses cleanup', integration, async () => {
  await owner.query('UPDATE public."Patient" SET "nationalId"=$1 WHERE id=$2', ['synthetic-unexpected-profile-field', fixture.patients[0]]);
  await assert.rejects(execute(), error => error.reason === 'unexpected_patient');
  assert.deepEqual(await scopedCounts(), { users: 10, patients: 8, appointments: 8 });
});

test('appointments that progressed beyond the QA-created state refuse cleanup', integration, async () => {
  await owner.query('UPDATE public."Appointment" SET status=$1 WHERE id=$2', ['CONFIRMED', fixture.appointments[0]]);
  await assert.rejects(execute(), error => error.reason === 'unexpected_appointment');
  assert.deepEqual(await scopedCounts(), { users: 10, patients: 8, appointments: 8 });
});

test('unknown non-FK patient child data also refuses cleanup', integration, async () => {
  await owner.query('CREATE TABLE public."UnexpectedQaData" (id text PRIMARY KEY, "patientId" text)');
  await owner.query('GRANT SELECT ON public."UnexpectedQaData" TO clinic_runtime');
  try {
    await owner.query('INSERT INTO public."UnexpectedQaData" VALUES ($1,$2)', [randomUUID(), fixture.patients[0]]);
    await assert.rejects(execute(), error => error.reason === 'unexpected_related_records');
    assert.deepEqual(await scopedCounts(), { users: 10, patients: 8, appointments: 8 });
  } finally { await owner.query('DROP TABLE public."UnexpectedQaData"'); }
});

test('out-of-range namespace addresses are discovered and refused rather than silently excluded', integration, async () => {
  const email = `${CLEANUP_NAMESPACE}+patient-999@example.invalid`;
  await owner.query('UPDATE public."User" SET username=$1,email=$1 WHERE id=$2', [email, fixture.users[8]]);
  await assert.rejects(execute(), error => error.reason === 'unexpected_account');
  assert.deepEqual(await scopedCounts(), { users: 10, patients: 8, appointments: 8 });
});

test('exact run contains eight verified ACTIVE users and pending indices 009 and 010 on their pinned UTC dates', integration, async () => {
  const { rows } = await owner.query('SELECT status, ("emailVerifiedAt" IS NOT NULL) AS verified, to_char("createdAt",\'YYYY-MM-DD\') AS day FROM public."User" WHERE id=ANY($1::text[]) ORDER BY email', [fixture.users]);
  assert.deepEqual(rows.map(row => row.status), [...Array(8).fill('ACTIVE'), 'PENDING_VERIFICATION', 'PENDING_VERIFICATION']);
  assert.deepEqual(rows.map(row => row.verified), [...Array(8).fill(true), false, false]);
  assert.deepEqual(rows.map(row => row.day), [...Array(9).fill('2026-11-06'), '2026-11-07']);
  // PostgreSQL timestamp-without-zone values represent UTC in this schema.
  // The validator explicitly converts them rather than depending on client TZ.
  const result = await cleanupStagingQa({ env: safeEnv, client: await runtime() });
  assert.equal(result.counts.accounts, 10); assert.equal(result.counts.verificationCaptures, 0);
});

for (const index of [8, 9]) {
  test(`pending patient ${String(index + 1).padStart(3, '0')} must remain pending with null emailVerifiedAt`, integration, async () => {
    await owner.query('UPDATE public."User" SET "emailVerifiedAt"=now() WHERE id=$1', [fixture.users[index]]);
    await refusesBeforeDelete('unexpected_patient');
  });
  test(`pending patient ${String(index + 1).padStart(3, '0')} cannot replace an ACTIVE identity`, integration, async () => {
    await owner.query('UPDATE public."User" SET status=CASE WHEN id=$1 THEN \'ACTIVE\' ELSE \'PENDING_VERIFICATION\' END WHERE id=ANY($2::text[])', [fixture.users[index], [fixture.users[index], fixture.users[0]]]);
    await refusesBeforeDelete('unexpected_account');
  });
}

for (const [index, day] of [[0, '2026-11-07'], [8, '2026-11-07'], [9, '2026-11-06'], [9, '2026-11-08']]) {
  test(`patient ${index + 1} created outside its exact UTC date refuses cleanup`, integration, async () => {
    await owner.query('UPDATE public."User" SET "createdAt"=$1 WHERE id=$2', [day + 'T12:00:00Z', fixture.users[index]]);
    await refusesBeforeDelete('unexpected_account');
  });
}

for (const table of ['User', 'Patient', 'Appointment', 'PatientRegistration', 'VerificationChallenge']) {
  test(`changed ${table} count refuses before any DELETE`, integration, async () => {
    if (table === 'User') await owner.query('DELETE FROM public."User" WHERE id=$1', [fixture.users[9]]);
    if (table === 'Patient') {
      await owner.query('DELETE FROM public."Appointment" WHERE id=$1', [fixture.appointments[0]]);
      await owner.query('DELETE FROM public."Patient" WHERE id=$1', [fixture.patients[0]]);
    }
    if (table === 'Appointment') await owner.query('DELETE FROM public."Appointment" WHERE id=$1', [fixture.appointments[0]]);
    if (table === 'PatientRegistration') await owner.query('DELETE FROM public."PatientRegistration" WHERE "userId"=$1', [fixture.users[9]]);
    if (table === 'VerificationChallenge') await owner.query('DELETE FROM public."VerificationChallenge" WHERE "userId"=$1', [fixture.users[9]]);
    await refusesBeforeDelete(table === 'VerificationChallenge' ? 'unexpected_challenge' : 'count_mismatch');
  });
}

for (const [index, sql] of [
  [0, '"usedAt"=NULL'], [0, '"attemptCount"=0'], [0, 'type=\'OTHER\''],
  [8, '"usedAt"=now()'], [8, '"attemptCount"=1'],
  [9, '"usedAt"=now()'], [9, '"attemptCount"=1']
]) {
  test(`changed challenge status/attempts for patient ${index + 1} refuses before any DELETE: ${sql.split('=')[0]}`, integration, async () => {
    await owner.query('UPDATE public."VerificationChallenge" SET ' + sql + ' WHERE "userId"=$1', [fixture.users[index]]);
    await refusesBeforeDelete('unexpected_challenge');
  });
}

for (const expiry of ['now()+interval \'1 minute\'', 'now()-interval \'1 minute\'']) {
  test('any durable verification capture, including expired, refuses without reading ciphertext or deleting rows', integration, async () => {
    await owner.query('INSERT INTO public."QaVerificationCapture" ("challengeId","codeEncrypted","createdAt","expiresAt") SELECT id,$1,now()-interval \'2 minutes\',' + expiry + ' FROM public."VerificationChallenge" WHERE "userId"=$2', ['ciphertext-must-not-be-selected', fixture.users[9]]);
    await refusesBeforeDelete('unexpected_related_records');
    const output = [], connection = await runtime();
    assert.equal(await cleanupCli({ env: safeEnv, createClient: () => ({ connect: async () => {}, query: (sql, values) => connection.query(sql, values), end: async () => {} }), log: line => output.push(line) }), 1);
    assert.deepEqual(JSON.parse(output[0]), { namespace: CLEANUP_NAMESPACE, result: 'REFUSED', reason: 'unexpected_related_records' });
    for (const secret of ['ciphertext-must-not-be-selected', ...fixture.users, safeEnv.DATABASE_URL, safeEnv.QA_VERIFICATION_CAPTURE_STORAGE_KEY]) assert.equal(output.join('').includes(secret), false);
  });
}

test('durable capture table RLS is rejected even when no captures exist', integration, async () => {
  await owner.query('ALTER TABLE public."QaVerificationCapture" ENABLE ROW LEVEL SECURITY');
  try { await refusesBeforeDelete('unsupported_relation'); }
  finally { await owner.query('ALTER TABLE public."QaVerificationCapture" DISABLE ROW LEVEL SECURITY'); }
});

test('unknown non-FK challenge references cannot bypass inspection', integration, async () => {
  await owner.query('CREATE TABLE public."UnexpectedChallengeData" ("challengeId" text)');
  await owner.query('GRANT SELECT ON public."UnexpectedChallengeData" TO clinic_runtime');
  try {
    await owner.query('INSERT INTO public."UnexpectedChallengeData" SELECT id FROM public."VerificationChallenge" WHERE "userId"=$1', [fixture.users[9]]);
    await refusesBeforeDelete('unexpected_related_records');
  } finally { await owner.query('DROP TABLE public."UnexpectedChallengeData"'); }
});

test('unexpected notification footprint refuses before deletion', integration, async () => {
  await owner.query('UPDATE public."Notification" SET type=\'UNEXPECTED\' WHERE "entityId"=$1', [fixture.appointments[0]]);
  await refusesBeforeDelete('unexpected_notification');
});

test('unexpected MFA purpose refuses before deletion', integration, async () => {
  await owner.query('INSERT INTO public."MfaChallenge" (id,"userId",purpose,"authVersion","tokenHash","expiresAt") VALUES ($1,$2,$3,0,$4,now())', [randomUUID(), fixture.users[0], 'OTHER', 'unused-test-hash']);
  await refusesBeforeDelete('unexpected_auth_record');
});

test('exact names remain mandatory for this namespace', integration, async () => {
  await owner.query('UPDATE public."PatientRegistration" SET "fatherNameEn"=$1 WHERE "userId"=$2', ['qa-20261106-c16af28a', fixture.users[9]]);
  await refusesBeforeDelete('unexpected_patient');
});
