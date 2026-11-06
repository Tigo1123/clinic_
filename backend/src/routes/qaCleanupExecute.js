import { Client } from 'pg';
import {
  CLEANUP_NAMESPACE, CleanupRefusal, cleanupRefusalReason,
  cleanupStagingQa, validateCleanupEnvironment
} from '../../scripts/cleanup-staging-qa.mjs';
import { isQaVerificationCaptureEnabled, isValidQaVerificationCaptureToken } from '../utils/qaVerificationCapture.js';
import { normalizeQaMarker } from '../utils/qaEnvironmentMarkers.js';
import { getStagingLoadTestTarget } from '../utils/stagingLoadTestSafety.js';

const PATH = '/api/qa/cleanup-execute';
const SAFETY_REFUSALS = new Set(['invalid_environment', 'database_identity_not_allowed']);

// Temporary, single-namespace execution capability. This private snapshot is
// created only by this route after the separate execution authorization check.
// The dry-run route has its own wrapper which always forces execution=false.
export function registerQaCleanupExecuteRoute(app, {
  prismaClient, env = process.env, createClient = options => new Client(options)
} = {}) {
  app.all(PATH, async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache', 'X-Robots-Tag': 'noindex' });
    if (req.method !== 'POST' || req.originalUrl !== PATH
        || req.get('transfer-encoding') || Number(req.get('content-length') || 0) !== 0
        || (req.body && Object.keys(req.body).length !== 0)) return res.sendStatus(404);
    if (env.QA_CLEANUP_EXECUTION_ALLOWED !== 'true' || !isQaVerificationCaptureEnabled(env)) return res.sendStatus(404);
    const match = /^Bearer ([^\s]+)$/i.exec(req.get('authorization') || '');
    if (!match || !isValidQaVerificationCaptureToken(match[1], env)) return res.sendStatus(404);

    const snapshot = Object.freeze({ ...env,
      QA_CLEANUP_NAMESPACE: CLEANUP_NAMESPACE,
      QA_EXPECTED_CLEANUP_ACCOUNTS: '9',
      QA_EXPECTED_CLEANUP_APPOINTMENTS: '8',
      QA_EXECUTE_CLEANUP: 'true'
    });
    try {
      validateCleanupEnvironment(snapshot);
      if (normalizeQaMarker(snapshot.QA_PAYMENT_MODE) !== 'disabled') return res.sendStatus(404);
      const target = await getStagingLoadTestTarget(snapshot, async () => {
        const [identity] = await prismaClient.$queryRaw`
          SELECT current_database()::text AS database,
            current_schema()::text AS schema,
            current_user::text AS role
        `;
        return identity;
      });
      if (target.loadTestAllowed !== true) return res.sendStatus(404);
    } catch {
      return res.sendStatus(404);
    }

    let client;
    try {
      client = createClient({ connectionString: snapshot.DATABASE_URL, connectionTimeoutMillis: 10_000 });
      client.on?.('error', () => {});
      await client.connect();
      // Repeats identity, exact footprint and reference validation inside the
      // existing SERIALIZABLE transaction before its first scoped DELETE.
      const result = await cleanupStagingQa({ env: snapshot, client });
      if (result.namespace !== CLEANUP_NAMESPACE || result.deleted !== true || result.dryRun !== false
          || !['users', 'patients', 'appointments'].every(key => result.remaining?.[key] === 0)) {
        throw new CleanupRefusal('cleanup_failed');
      }
      return res.json({ namespace: CLEANUP_NAMESPACE, deleted: true,
        remaining: { users: 0, patients: 0, appointments: 0 } });
    } catch (error) {
      const reason = cleanupRefusalReason(error);
      if (SAFETY_REFUSALS.has(reason)) return res.sendStatus(404);
      return res.status(409).json({ result: 'REFUSED', reason });
    } finally {
      if (client) await client.end().catch(() => {});
    }
  });
}
