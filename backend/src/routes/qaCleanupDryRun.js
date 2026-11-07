import { Client } from 'pg';
import { cleanupStagingQa, cleanupRefusalReason, validateCleanupEnvironment, CleanupRefusal } from '../../scripts/cleanup-staging-qa.mjs';
import { isQaVerificationCaptureEnabled, isValidQaVerificationCaptureToken } from '../utils/qaVerificationCaptureConfig.js';
import { normalizeQaMarker } from '../utils/qaEnvironmentMarkers.js';

const PATH = '/api/qa/cleanup-dry-run';
const NAMESPACE = 'qa-20261106-73412c3e';
const COUNTS = ['accounts', 'patients', 'appointments', 'registrations', 'verificationChallenges',
  'verificationCaptures', 'authenticationChallenges', 'auditRows', 'notifications'];
const OPAQUE = new Set(['invalid_namespace', 'invalid_environment', 'invalid_expected_counts',
  'invalid_execution_flag', 'database_identity_not_allowed']);

// Temporary exact-run diagnostic. There is no execution route, caller options,
// command invocation, or path from this handler to an execution=true snapshot.
export function registerQaCleanupDryRunRoute(app, { env = process.env, createClient = options => new Client(options) } = {}) {
  app.all(PATH, async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache', 'X-Robots-Tag': 'noindex' });
    if (req.method !== 'GET' || req.originalUrl !== PATH || req.get('transfer-encoding')
        || ![undefined, '0'].includes(req.get('content-length'))
        || (req.body != null && Object.keys(req.body).length > 0)) return res.sendStatus(404);
    const snapshot = Object.freeze({ ...env,
      QA_CLEANUP_NAMESPACE: NAMESPACE,
      QA_EXPECTED_CLEANUP_ACCOUNTS: '10', QA_EXPECTED_CLEANUP_APPOINTMENTS: '8',
      QA_EXECUTE_CLEANUP: 'false'
    });
    const credential = /^Bearer ([^\s]+)$/i.exec(req.get('authorization') || '');
    if (!isQaVerificationCaptureEnabled(snapshot) || !credential
        || !isValidQaVerificationCaptureToken(credential[1], snapshot)
        || normalizeQaMarker(snapshot.QA_PAYMENT_MODE) !== 'disabled') return res.sendStatus(404);
    let client;
    try {
      validateCleanupEnvironment(snapshot); // Full marker/pin validation before connecting.
      client = createClient({ connectionString: snapshot.DATABASE_URL, connectionTimeoutMillis: 10000 });
      client.on?.('error', () => {}); // Never print provider connection errors.
      await client.connect();
      // Reuses the full live identity, footprint and reference checks inside
      // BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY, followed by ROLLBACK.
      const result = await cleanupStagingQa({ env: snapshot, client });
      if (result.namespace !== NAMESPACE || result.dryRun !== true || result.deleted !== false
          || !COUNTS.every(key => Number.isSafeInteger(result.counts?.[key]) && result.counts[key] >= 0)) {
        throw new CleanupRefusal('cleanup_failed');
      }
      return res.json({ namespace: NAMESPACE, dryRun: true, deleted: false,
        counts: Object.fromEntries(COUNTS.map(key => [key, result.counts[key]])) });
    } catch (error) {
      const reason = cleanupRefusalReason(error);
      return OPAQUE.has(reason) ? res.sendStatus(404) : res.status(409).json({ result: 'REFUSED', reason });
    } finally {
      if (client) await client.end().catch(() => {});
    }
  });
}
