import { Client } from 'pg';
import { cleanupStagingQa, cleanupRefusalReason, validateCleanupEnvironment, CleanupRefusal } from '../../scripts/cleanup-staging-qa.mjs';
import { isQaVerificationCaptureEnabled, isValidQaVerificationCaptureToken } from '../utils/qaVerificationCaptureConfig.js';
import { normalizeQaMarker } from '../utils/qaEnvironmentMarkers.js';

const PATH = '/api/qa/cleanup-execute';
const NAMESPACE = 'qa-20261106-73412c3e';
const EXPECTED = Object.freeze({ accounts: 10, patients: 8, appointments: 8, registrations: 10,
  verificationChallenges: 10, verificationCaptures: 0, authenticationChallenges: 0, auditRows: 34, notifications: 40 });
const OPAQUE = new Set(['invalid_namespace', 'invalid_environment', 'invalid_expected_counts',
  'invalid_execution_flag', 'database_identity_not_allowed']);

// Temporary, exact reviewed run only. No request data becomes cleanup options.
export function registerQaCleanupExecuteRoute(app, { env = process.env, createClient = options => new Client(options) } = {}) {
  app.all(PATH, async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache', 'X-Robots-Tag': 'noindex' });
    if (req.method !== 'POST' || req.originalUrl !== PATH || req.get('transfer-encoding')
        || ![undefined, '0'].includes(req.get('content-length'))
        || (req.body != null && Object.keys(req.body).length > 0)
        || env.QA_CLEANUP_EXECUTION_ALLOWED !== 'true') return res.sendStatus(404);
    const snapshot = Object.freeze({ ...env,
      QA_CLEANUP_NAMESPACE: NAMESPACE,
      QA_EXPECTED_CLEANUP_ACCOUNTS: '10', QA_EXPECTED_CLEANUP_APPOINTMENTS: '8',
      QA_EXECUTE_CLEANUP: 'true'
    });
    const credential = /^Bearer ([^\s]+)$/i.exec(req.get('authorization') || '');
    if (!isQaVerificationCaptureEnabled(snapshot) || !credential
        || !isValidQaVerificationCaptureToken(credential[1], snapshot)
        || normalizeQaMarker(snapshot.QA_PAYMENT_MODE) !== 'disabled') return res.sendStatus(404);
    let client;
    try {
      validateCleanupEnvironment(snapshot);
      client = createClient({ connectionString: snapshot.DATABASE_URL, connectionTimeoutMillis: 10000 });
      client.on?.('error', () => {});
      await client.connect();
      const result = await cleanupStagingQa({ env: snapshot, client, expectedCounts: EXPECTED });
      if (result.namespace !== NAMESPACE || result.deleted !== true || result.dryRun !== false
          || !['users', 'patients', 'appointments'].every(key => result.remaining?.[key] === 0)) {
        throw new CleanupRefusal('cleanup_failed');
      }
      return res.json({ namespace: NAMESPACE, deleted: true,
        remaining: { users: 0, patients: 0, appointments: 0 } });
    } catch (error) {
      const reason = cleanupRefusalReason(error);
      return OPAQUE.has(reason) ? res.sendStatus(404) : res.status(409).json({ result: 'REFUSED', reason });
    } finally {
      if (client) await client.end().catch(() => {});
    }
  });
}
