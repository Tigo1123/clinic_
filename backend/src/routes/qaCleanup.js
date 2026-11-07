import { Client } from 'pg';
import {
  cleanupStagingQa,
  CleanupRefusal,
  validateCleanupEnvironment
} from '../../scripts/cleanup-staging-qa.mjs';
import { isQaVerificationCaptureEnabled, isValidQaVerificationCaptureToken } from '../utils/qaVerificationCaptureConfig.js';
import { getStagingLoadTestTarget, stagingLoadTestPreflight } from '../utils/stagingLoadTestSafety.js';

const DRY_PATH = '/api/qa/cleanup-dry-run';
const EXECUTE_PATH = '/api/qa/cleanup-execute';
const NAMESPACE = 'qa-20261106-73412c3e';
const TARGET = 'clinic-staging-qa-20261106';
const DATABASE_IDENTITY = Object.freeze({ database: 'neondb', schema: 'public', role: 'clinic_runtime' });
const COUNTS = Object.freeze({ accounts: 10, patients: 8, appointments: 8, registrations: 10,
  verificationChallenges: 10, verificationCaptures: 0, authenticationChallenges: 0, auditRows: 34, notifications: 40 });
const COUNT_KEYS = Object.keys(COUNTS);
const OPAQUE_REFUSALS = new Set(['invalid_namespace', 'invalid_environment', 'invalid_expected_counts',
  'invalid_execution_flag', 'database_identity_not_allowed']);
const SAFE_REFUSALS = new Set(['count_mismatch', 'unexpected_account', 'unexpected_patient', 'unexpected_registration',
  'unexpected_challenge', 'unexpected_appointment', 'unexpected_audit', 'unexpected_notification',
  'unexpected_auth_record', 'unexpected_related_records', 'unsupported_relation', 'delete_count_mismatch',
  'post_cleanup_verification_failed', 'cleanup_failed']);

function privateSnapshot(env, execute) {
  return Object.freeze({ ...env,
    QA_CLEANUP_NAMESPACE: NAMESPACE,
    QA_EXPECTED_CLEANUP_ACCOUNTS: String(COUNTS.accounts),
    QA_EXPECTED_CLEANUP_APPOINTMENTS: String(COUNTS.appointments),
    QA_EXECUTE_CLEANUP: execute ? 'true' : 'false'
  });
}

function credentialsValid(req, env) {
  const match = /^Bearer ([^\s]+)$/i.exec(req.get('authorization') || '');
  return Boolean(match && isQaVerificationCaptureEnabled(env)
    && isValidQaVerificationCaptureToken(match[1], env));
}

function environmentSafe(env, execute) {
  if (execute && env.QA_CLEANUP_EXECUTION_ALLOWED !== 'true') return false;
  const preflight = stagingLoadTestPreflight(env);
  return preflight.canInspectDatabase === true
    && preflight.environment === 'staging'
    && preflight.databaseEnvironment === 'staging'
    && preflight.targetId === TARGET
    && preflight.expectedDatabase === DATABASE_IDENTITY.database
    && preflight.expectedSchema === DATABASE_IDENTITY.schema
    && preflight.expectedRole === DATABASE_IDENTITY.role
    && preflight.notifications === 'sink'
    && preflight.payments === 'disabled'
    && preflight.verificationCapture === 'enabled';
}

async function verifyLiveIdentity(env, createClient) {
  let client;
  try {
    client = createClient({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 10_000 });
    client.on?.('error', () => {});
    await client.connect();
    const { rows: [identity] } = await client.query(
      'SELECT current_database()::text AS database, current_schema()::text AS schema, current_user::text AS role');
    if (!Object.entries(DATABASE_IDENTITY).every(([key, value]) => identity?.[key] === value)) return false;
    const gate = await getStagingLoadTestTarget(env, async () => identity);
    return gate.loadTestAllowed === true && gate.targetId === TARGET;
  } catch {
    return false;
  } finally {
    if (client) await client.end().catch(() => {});
  }
}

function refusalReason(error) {
  if (!(error instanceof CleanupRefusal)) return 'cleanup_failed';
  return SAFE_REFUSALS.has(error.reason) || OPAQUE_REFUSALS.has(error.reason) ? error.reason : 'cleanup_failed';
}

async function handleCleanup(req, res, { env, createClient, execute }) {
  res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache', 'X-Robots-Tag': 'noindex' });
  const path = execute ? EXECUTE_PATH : DRY_PATH;
  if (req.method !== (execute ? 'POST' : 'GET') || req.originalUrl !== path
      || req.get('transfer-encoding') || ![undefined, '0'].includes(req.get('content-length'))
      || req.body !== undefined) return res.sendStatus(404);

  const snapshot = privateSnapshot(env, execute);
  if (!environmentSafe(snapshot, execute) || !credentialsValid(req, snapshot)) return res.sendStatus(404);

  // This standalone identity probe is deliberately completed before opening
  // the transaction connection. cleanupStagingQa repeats it inside its own tx.
  try { validateCleanupEnvironment(snapshot); }
  catch { return res.sendStatus(404); }
  if (!(await verifyLiveIdentity(snapshot, createClient))) return res.sendStatus(404);

  let client;
  try {
    client = createClient({ connectionString: snapshot.DATABASE_URL, connectionTimeoutMillis: 10_000 });
    client.on?.('error', () => {});
    await client.connect();
    const result = await cleanupStagingQa({ env: snapshot, client });
    if (result.namespace !== NAMESPACE || result.dryRun !== !execute || result.deleted !== execute) {
      throw new CleanupRefusal('cleanup_failed');
    }
    if (!execute) {
      if (!COUNT_KEYS.every(key => Number.isSafeInteger(result.counts?.[key]) && result.counts[key] === COUNTS[key])) {
        throw new CleanupRefusal('count_mismatch');
      }
      return res.json({ namespace: NAMESPACE, dryRun: true, deleted: false, counts: result.counts });
    }
    if (!['users', 'patients', 'appointments'].every(key => result.remaining?.[key] === 0)) {
      throw new CleanupRefusal('cleanup_failed');
    }
    return res.json({ namespace: NAMESPACE, deleted: true, remaining: { users: 0, patients: 0, appointments: 0 } });
  } catch (error) {
    const reason = refusalReason(error);
    return OPAQUE_REFUSALS.has(reason) ? res.sendStatus(404) : res.status(409).json({ result: 'REFUSED', reason });
  } finally {
    if (client) await client.end().catch(() => {});
  }
}

// Mount before CORS and body parsers. Every method at either exact route or a
// path below it is intercepted, so OPTIONS and alternate suffixes cannot fall
// through into middleware that might parse a body.
export function registerQaCleanupRoutes(app, { env = process.env, createClient = options => new Client(options) } = {}) {
  app.use((req, res, next) => {
    const isDryPath = req.path === DRY_PATH || req.path.startsWith(`${DRY_PATH}/`);
    const isExecutePath = req.path === EXECUTE_PATH || req.path.startsWith(`${EXECUTE_PATH}/`);
    if (!isDryPath && !isExecutePath) return next();
    return handleCleanup(req, res, { env, createClient, execute: isExecutePath });
  });
}
