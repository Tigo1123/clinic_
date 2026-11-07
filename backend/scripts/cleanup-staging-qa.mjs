import { Client } from 'pg';
import { pathToFileURL } from 'node:url';
import { stagingLoadTestPreflight, getStagingLoadTestTarget } from '../src/utils/stagingLoadTestSafety.js';
import { normalizeQaMarker } from '../src/utils/qaEnvironmentMarkers.js';

export const CLEANUP_NAMESPACE = 'qa-20261106-73412c3e';
const TARGET = 'clinic-staging-qa-20261106';
const IDENTITY = { database: 'neondb', schema: 'public', role: 'clinic_runtime' };
const EXPECTED_FOOTPRINT = Object.freeze({ accounts: 10, patients: 8, appointments: 8, registrations: 10,
  verificationChallenges: 10, verificationCaptures: 0, authenticationChallenges: 0, auditRows: 34, notifications: 40 });
const REFUSALS = new Set(['invalid_namespace', 'invalid_environment', 'invalid_expected_counts', 'invalid_execution_flag',
  'database_identity_not_allowed', 'count_mismatch', 'unexpected_account', 'unexpected_patient', 'unexpected_registration',
  'unexpected_challenge', 'unexpected_appointment', 'unexpected_audit', 'unexpected_notification', 'unexpected_auth_record',
  'unexpected_related_records', 'unsupported_relation', 'delete_count_mismatch', 'post_cleanup_verification_failed', 'cleanup_failed']);
export class CleanupRefusal extends Error {
  constructor(reason) { super(REFUSALS.has(reason) ? reason : 'cleanup_failed'); this.reason = this.message; }
}
const requireSafe = (condition, reason) => { if (!condition) throw new CleanupRefusal(reason); };
const quote = identifier => `"${identifier.replaceAll('"', '""')}"`;

export function validateCleanupEnvironment(env = process.env) {
  const namespace = env.QA_CLEANUP_NAMESPACE ?? CLEANUP_NAMESPACE;
  requireSafe(/^qa-\d{8}-[a-f0-9]{8}$/.test(namespace) && namespace === CLEANUP_NAMESPACE, 'invalid_namespace');
  const preflight = stagingLoadTestPreflight(env);
  requireSafe(preflight.canInspectDatabase && preflight.environment === 'staging' && preflight.databaseEnvironment === 'staging'
    && preflight.targetId === TARGET && preflight.expectedDatabase === IDENTITY.database
    && preflight.expectedSchema === IDENTITY.schema && preflight.expectedRole === IDENTITY.role, 'invalid_environment');
  requireSafe(env.QA_EXPECTED_CLEANUP_ACCOUNTS === '10' && env.QA_EXPECTED_CLEANUP_APPOINTMENTS === '8', 'invalid_expected_counts');
  const flag = normalizeQaMarker(env.QA_EXECUTE_CLEANUP);
  requireSafe(['', 'false', 'true'].includes(flag), 'invalid_execution_flag');
  // Enumerate exact addresses, including unexpected 000/101..999 identities so
  // they cause refusal rather than being silently left behind. No LIKE/regex SQL.
  const emails = Array.from({ length: 1000 }, (_, index) => `${namespace}+patient-${String(index).padStart(3, '0')}@example.invalid`);
  return { namespace, emails, execute: flag === 'true' };
}

const NAME_FIELDS = ['firstNameEn', 'fatherNameEn', 'grandfatherNameEn', 'familyNameEn',
  'firstNameAr', 'fatherNameAr', 'grandfatherNameAr', 'familyNameAr'];
function expectedNames(index) {
  const suffix = String(index).padStart(3, '0');
  const parts = ['QA', CLEANUP_NAMESPACE, 'Synthetic', `Patient-${suffix}`, 'اختبار', CLEANUP_NAMESPACE, 'اصطناعي', `مريض-${suffix}`];
  return { ...Object.fromEntries(NAME_FIELDS.map((field, i) => [field, parts[i]])),
    fullNameEn: parts.slice(0, 4).join(' '), fullNameAr: parts.slice(4).join(' ') };
}
function assertNames(row, user) {
  const expected = expectedNames(user.qaIndex);
  requireSafe(Object.entries(expected).every(([field, value]) => row[field] === value), 'unexpected_patient');
  requireSafe(row.gender === (user.qaIndex % 2 ? 'MALE' : 'FEMALE') && /^\d{4}-\d\d-\d\d$/.test(row.dateOfBirth)
    && Number.isInteger(row.addressStateId) && row.addressStateId >= 1 && row.addressStateId <= 18, 'unexpected_patient');
}

// Examine catalog references as well as identifier columns without FKs. This
// catches clinical/billing tables, cascade children, and future added relations.
// A missing SELECT privilege, unsupported relation, or RLS also fails closed.
async function assertReferences(client, records) {
  const tables = Object.keys(records);
  const { rows: references } = await client.query(`
    SELECT DISTINCT ns.nspname AS schema, src.relname AS table, a.attname AS column,
      CASE WHEN a.attname='patientId' THEN 'Patient' WHEN a.attname='appointmentId' THEN 'Appointment'
        ELSE 'User' END AS target, 'id'::text AS target_column,
      1 AS width, src.relrowsecurity AS rls
    FROM pg_catalog.pg_class src JOIN pg_catalog.pg_namespace ns ON ns.oid=src.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid=src.oid AND a.attnum>0 AND NOT a.attisdropped
    WHERE ns.nspname='public' AND src.relkind IN ('r','p')
      AND a.attname IN ('userId','patientId','appointmentId','createdBy','createdById','actorUserId','processedBy','authorizedById')
    UNION
    SELECT ns.nspname, src.relname, a.attname, targets.name, targets.key, 1, src.relrowsecurity
    FROM pg_catalog.pg_class src JOIN pg_catalog.pg_namespace ns ON ns.oid=src.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid=src.oid AND a.attnum>0 AND NOT a.attisdropped
    CROSS JOIN (VALUES ('VerificationChallenge','id'),('MfaChallenge','id'),('QaVerificationCapture','challengeId')) targets(name,key)
    WHERE ns.nspname='public' AND src.relkind IN ('r','p') AND a.attname='challengeId'
    UNION
    SELECT ns.nspname, src.relname, a.attname, targets.name, 'id'::text, 1, src.relrowsecurity
    FROM pg_catalog.pg_class src JOIN pg_catalog.pg_namespace ns ON ns.oid=src.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid=src.oid AND a.attnum>0 AND NOT a.attisdropped
    CROSS JOIN (VALUES ('User'),('Patient'),('Appointment')) targets(name)
    WHERE ns.nspname='public' AND src.relkind IN ('r','p') AND a.attname='entityId'
    UNION
    SELECT ns.nspname, src.relname, a.attname, dst.relname, b.attname,
      cardinality(f.conkey), src.relrowsecurity
    FROM pg_catalog.pg_constraint f JOIN pg_catalog.pg_class src ON src.oid=f.conrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid=src.relnamespace
    JOIN pg_catalog.pg_class dst ON dst.oid=f.confrelid
    JOIN pg_catalog.pg_namespace dn ON dn.oid=dst.relnamespace
    JOIN LATERAL unnest(f.conkey) WITH ORDINALITY k(attnum,n) ON true
    JOIN pg_catalog.pg_attribute a ON a.attrelid=src.oid AND a.attnum=k.attnum
    JOIN pg_catalog.pg_attribute b ON b.attrelid=dst.oid AND b.attnum=f.confkey[k.n::int]
    WHERE f.contype='f' AND dn.nspname='public' AND dst.relname=ANY($1::text[])
    ORDER BY 1,2,3,4`, [tables]);
  const allowed = new Set(['Patient.userId.User', 'Appointment.patientId.Patient', 'PatientRegistration.userId.User',
    'VerificationChallenge.userId.User', 'MfaChallenge.userId.User', 'TenantAuditLog.userId.User', 'Notification.userId.User',
    'Notification.entityId.User', 'Notification.entityId.Patient', 'Notification.entityId.Appointment']);
  for (const reference of references) {
    const parents = records[reference.target];
    if (!parents?.length) continue;
    requireSafe(reference.width === 1 && !reference.rls, 'unsupported_relation');
    requireSafe(parents.every(row => Object.hasOwn(row, reference.target_column)), 'unsupported_relation');
    const values = parents.map(row => row[reference.target_column]);
    const { rows: [result] } = await client.query(`SELECT count(*)::int AS count FROM ${quote(reference.schema)}.${quote(reference.table)}
      WHERE ${quote(reference.column)}::text=ANY($1::text[])`, [values]);
    const permitted = reference.schema === 'public' && reference.target_column === 'id'
      && allowed.has(`${reference.table}.${reference.column}.${reference.target}`);
    const expected = permitted ? records[reference.table].filter(row => values.includes(row[reference.column])).length : 0;
    requireSafe(result.count === expected, 'unexpected_related_records');
  }
}

export async function cleanupStagingQa({ env = process.env, client } = {}) {
  const config = validateCleanupEnvironment(env);
  let inTransaction = false;
  try {
    await client.query(`BEGIN ISOLATION LEVEL SERIALIZABLE${config.execute ? '' : ' READ ONLY'}`);
    inTransaction = true;
    await client.query("SET LOCAL statement_timeout='15s'");
    await client.query("SET LOCAL lock_timeout='5s'");
    const { rows: [identity] } = await client.query('SELECT current_database()::text AS database, current_schema()::text AS schema, current_user::text AS role');
    requireSafe(Object.entries(IDENTITY).every(([key, value]) => identity?.[key] === value), 'database_identity_not_allowed');
    const gate = await getStagingLoadTestTarget(env, async () => identity);
    requireSafe(gate.loadTestAllowed === true && gate.targetId === TARGET, 'database_identity_not_allowed');
    const coreTables = ['User', 'Patient', 'Appointment', 'PatientRegistration', 'VerificationChallenge', 'QaVerificationCapture', 'MfaChallenge', 'TenantAuditLog', 'Notification'];
    const { rows: [catalog] } = await client.query(`SELECT count(*)::int AS count FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND c.relname=ANY($1::text[]) AND NOT c.relrowsecurity`, [coreTables]);
    requireSafe(catalog.count === coreTables.length, 'unsupported_relation');
    const lock = config.execute ? ' FOR UPDATE' : '';
    const select = async (table, columns, where, values, order = 'id') => (await client.query(
      `SELECT ${columns} FROM public.${quote(table)} WHERE ${where} ORDER BY ${quote(order)}${lock}`, values)).rows;
    const users = await select('User', 'id, username, email, role, status, "phoneNormalized", "emailVerifiedAt", "phoneVerifiedAt", "authVersion", "mfaEnabled", "mustChangePassword", "lastPasswordChange", ("createdAt" AT TIME ZONE \'UTC\') AS "createdAt", ("mfaSecret" IS NOT NULL) AS "hasMfaSecret"',
      'email=ANY($1::text[]) OR username=ANY($1::text[])', [config.emails]);
    requireSafe(users.length === 10, 'count_mismatch');
    for (const user of users) {
      const index = config.emails.indexOf(user.email);
      requireSafe(index >= 1 && index <= 10 && user.username === user.email && user.role === 'PATIENT'
        && user.status === (index <= 8 ? 'ACTIVE' : 'PENDING_VERIFICATION') && /^\+1\d{3}55501\d{2}$/.test(user.phoneNormalized)
        && user.authVersion === 0 && !user.mfaEnabled && !user.hasMfaSecret && !user.mustChangePassword
        && user.lastPasswordChange === null && user.phoneVerifiedAt === null
        && user.createdAt instanceof Date && user.createdAt.toISOString().slice(0, 10) === (index === 10 ? '2026-11-07' : '2026-11-06'), 'unexpected_account');
      user.qaIndex = index;
    }
    requireSafe(users.filter(u => u.status === 'ACTIVE').length === 8 && users.filter(u => u.status === 'PENDING_VERIFICATION').length === 2, 'unexpected_account');
    const userIds = users.map(u => u.id);
    const byUser = new Map(users.map(u => [u.id, u]));
    const names = ['fullNameEn', 'fullNameAr', ...NAME_FIELDS].map(quote).join(', ');
    const patients = await select('Patient', `id, "userId", "fileNumber", ${names}, gender, "dateOfBirth", "addressStateId", phone, status, "nationalId", "bloodType", "addressDetails", "emergencyContact", "nationalIdAttachmentPath", "insuranceAttachmentPath"`, '"userId"=ANY($1::text[])', [userIds]);
    const registrations = await select('PatientRegistration', `"userId", ${names}, gender, "dateOfBirth", "addressStateId"`, '"userId"=ANY($1::text[])', [userIds], 'userId');
    requireSafe(patients.length === 8 && registrations.length === 10, 'count_mismatch');
    const patientByUser = new Map(patients.map(p => [p.userId, p]));
    for (const user of users) {
      const patient = patientByUser.get(user.id);
      requireSafe(user.status === 'ACTIVE' ? Boolean(patient && user.emailVerifiedAt instanceof Date) : !patient && user.emailVerifiedAt === null, 'unexpected_patient');
    }
    for (const patient of patients) {
      assertNames(patient, byUser.get(patient.userId));
      requireSafe(patient.status === 'ACTIVE' && patient.phone === byUser.get(patient.userId).phoneNormalized
        && patient.emergencyContact === 'Self' && ['nationalId', 'bloodType', 'addressDetails', 'nationalIdAttachmentPath', 'insuranceAttachmentPath'].every(key => patient[key] === null), 'unexpected_patient');
    }
    for (const registration of registrations) {
      assertNames(registration, byUser.get(registration.userId));
      const patient = patientByUser.get(registration.userId);
      requireSafe(!patient || ['dateOfBirth', 'gender', 'addressStateId', ...NAME_FIELDS].every(key => registration[key] === patient[key]), 'unexpected_registration');
    }
    const challenges = await select('VerificationChallenge', 'id, "userId", type, "targetNormalized", "authVersion", "attemptCount", "maxAttempts", "usedAt"', '"userId"=ANY($1::text[])', [userIds]);
    requireSafe(challenges.length === 10, 'unexpected_challenge');
    for (const user of users) {
      const own = challenges.filter(c => c.userId === user.id);
      requireSafe(own.length === 1 && own[0].type === 'REGISTRATION_EMAIL' && own[0].targetNormalized === user.email
        && own[0].authVersion === user.authVersion && own[0].maxAttempts === 5
        && (user.status === 'ACTIVE' ? Boolean(own[0].usedAt) && own[0].attemptCount === 1 : own[0].usedAt === null && own[0].attemptCount === 0), 'unexpected_challenge');
    }
    // This historical run predates durable capture storage. Never trust its
    // cascade: any linked capture, even expired, requires manual investigation.
    const verificationCaptures = await select('QaVerificationCapture', '"challengeId"', '"challengeId"=ANY($1::text[])', [challenges.map(c => c.id)], 'challengeId');
    requireSafe(verificationCaptures.length === 0, 'unexpected_related_records');
    const patientIds = patients.map(p => p.id);
    const appointments = await select('Appointment', 'id, "patientId", "doctorId", status, "appointmentDate", "appointmentTime"', '"patientId"=ANY($1::text[])', [patientIds]);
    requireSafe(appointments.length === 8, 'count_mismatch');
    for (const patient of patients) {
      const own = appointments.filter(a => a.patientId === patient.id);
      requireSafe(own.length === 1 && own[0].status === 'PENDING', 'unexpected_appointment');
    }
    const appointmentIds = appointments.map(a => a.id);
    const audits = await select('TenantAuditLog', 'id, "userId", action, details', '"userId"=ANY($1::text[])', [userIds]);
    const normalAuth = new Set(['AUTH_LOGIN', 'AUTH_LOGOUT', 'USER_LOGIN', 'USER_LOGOUT']);
    for (const user of users) {
      const own = audits.filter(a => a.userId === user.id);
      const patient = patientByUser.get(user.id);
      const appointment = appointments.find(a => a.patientId === patient?.id);
      requireSafe(own.filter(a => a.action === 'PATIENT_ACCOUNT_REGISTRATION').length === 1, 'unexpected_audit');
      for (const action of ['PATIENT_FILE_CREATED', 'PATIENT_RECORD_CREATED', 'PATIENT_APPOINTMENT_BOOKED']) {
        requireSafe(own.filter(a => a.action === action).length === (patient ? 1 : 0), 'unexpected_audit');
      }
      for (const audit of own) {
        if (normalAuth.has(audit.action) || audit.action === 'PATIENT_ACCOUNT_REGISTRATION') continue;
        if (audit.action === 'PATIENT_RECORD_CREATED') requireSafe(audit.details === `Created patient record ${patient?.id} for verified account.`, 'unexpected_audit');
        else if (audit.action === 'PATIENT_APPOINTMENT_BOOKED') requireSafe(audit.details === `Patient booked appointment ${appointment?.id}.`, 'unexpected_audit');
        else if (audit.action === 'PATIENT_FILE_CREATED') {
          let detail; try { detail = JSON.parse(audit.details); } catch { throw new CleanupRefusal('unexpected_audit'); }
          requireSafe(detail?.patientId === patient?.id && detail.fileNumber === patient?.fileNumber && detail.context === 'ONLINE_VERIFICATION', 'unexpected_audit');
        } else throw new CleanupRefusal('unexpected_audit');
      }
    }
    const mfaChallenges = await select('MfaChallenge', 'id, "userId", purpose, "authVersion"', '"userId"=ANY($1::text[])', [userIds]);
    requireSafe(mfaChallenges.every(c => c.purpose === 'LOGIN' && c.authVersion === byUser.get(c.userId)?.authVersion), 'unexpected_auth_record');
    const notifications = await select('Notification', 'id, "userId", type, "entityType", "entityId", "eventKey"',
      '"userId"=ANY($1::text[]) OR "entityId"=ANY($2::text[])', [userIds, [...userIds, ...patientIds, ...appointmentIds]]);
    for (const n of notifications) {
      const validPatient = n.entityType === 'Patient' && patientIds.includes(n.entityId) && n.type === 'PATIENT_REGISTERED';
      const validAppointment = n.entityType === 'Appointment' && appointmentIds.includes(n.entityId) && n.type === 'APPOINTMENT_BOOKED';
      requireSafe((validPatient || validAppointment) && n.eventKey?.startsWith(`${n.entityType}:${n.entityId}:`)
        && /^\d+$/.test(n.eventKey.slice(`${n.entityType}:${n.entityId}:`.length)), 'unexpected_notification');
    }
    await assertReferences(client, { User: users, Patient: patients, Appointment: appointments,
      PatientRegistration: registrations, VerificationChallenge: challenges, QaVerificationCapture: verificationCaptures, MfaChallenge: mfaChallenges,
      TenantAuditLog: audits, Notification: notifications });
    const counts = { accounts: users.length, patients: patients.length, appointments: appointments.length,
      registrations: registrations.length, verificationChallenges: challenges.length, verificationCaptures: verificationCaptures.length, authenticationChallenges: mfaChallenges.length,
      auditRows: audits.length, notifications: notifications.length };
    requireSafe(Object.entries(EXPECTED_FOOTPRINT).every(([key, expected]) => counts[key] === expected), 'count_mismatch');
    if (!config.execute) {
      await client.query('ROLLBACK'); inTransaction = false;
      return { namespace: config.namespace, dryRun: true, deleted: false, counts };
    }
    const remove = async (table, column, ids, expected) => {
      const result = await client.query(`DELETE FROM public.${quote(table)} WHERE ${quote(column)}=ANY($1::text[])`, [ids]);
      requireSafe(result.rowCount === expected, 'delete_count_mismatch');
    };
    await remove('Appointment', 'id', appointmentIds, 8);
    await remove('MfaChallenge', 'id', mfaChallenges.map(c => c.id), mfaChallenges.length);
    await remove('VerificationChallenge', 'id', challenges.map(c => c.id), 10);
    await remove('PatientRegistration', 'userId', userIds, 10);
    await remove('Notification', 'id', notifications.map(n => n.id), notifications.length);
    await remove('Patient', 'id', patientIds, 8);
    await remove('TenantAuditLog', 'userId', userIds, audits.length);
    await remove('User', 'id', userIds, 10);
    const { rows: [remaining] } = await client.query(`SELECT
      (SELECT count(*)::int FROM public."User" WHERE email=ANY($1::text[]) OR username=ANY($1::text[])) AS users,
      (SELECT count(*)::int FROM public."Patient" WHERE id=ANY($2::text[])) AS patients,
      (SELECT count(*)::int FROM public."Appointment" WHERE id=ANY($3::text[])) AS appointments`, [config.emails, patientIds, appointmentIds]);
    requireSafe(Object.values(remaining).every(count => count === 0), 'post_cleanup_verification_failed');
    await client.query('COMMIT'); inTransaction = false;
    return { namespace: config.namespace, dryRun: false, deleted: true, counts, remaining };
  } catch (error) {
    if (inTransaction) await client.query('ROLLBACK').catch(() => {});
    throw error instanceof CleanupRefusal ? error : new CleanupRefusal('cleanup_failed');
  }
}

function cleanupRefusalReason(error) {
  return error instanceof CleanupRefusal && REFUSALS.has(error.reason) ? error.reason : 'cleanup_failed';
}

async function withCleanupClient(env, createClient) {
  let client;
  try {
    validateCleanupEnvironment(env); // Reject unsafe markers before connecting.
    client = createClient({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 10_000 });
    // pg may emit connection errors between awaited queries. Do not let an
    // unhandled event print raw provider/connection error details.
    client.on?.('error', () => {});
    await client.connect();
    return await cleanupStagingQa({ env, client });
  } finally { if (client) await client.end().catch(() => {}); }
}

export async function cleanupCli({ env = process.env, args = [], createClient = options => new Client(options), log = line => console.log(line) } = {}) {
  try {
    requireSafe(args.length === 0, 'invalid_execution_flag');
    log(JSON.stringify(await withCleanupClient(env, createClient)));
    return 0;
  } catch (error) {
    log(JSON.stringify({ namespace: CLEANUP_NAMESPACE, result: 'REFUSED', reason: cleanupRefusalReason(error) }));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await cleanupCli({ args: process.argv.slice(2) });
