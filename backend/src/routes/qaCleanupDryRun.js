import {
  CLEANUP_NAMESPACE, CleanupRefusal, cleanupDryRunEnvironment,
  cleanupRefusalReason, cleanupStagingQaDryRun, validateCleanupEnvironment
} from '../../scripts/cleanup-staging-qa.mjs';
import { isQaVerificationCaptureEnabled, isValidQaVerificationCaptureToken } from '../utils/qaVerificationCapture.js';
import { normalizeQaMarker } from '../utils/qaEnvironmentMarkers.js';
import { getStagingLoadTestTarget } from '../utils/stagingLoadTestSafety.js';

const COUNT_KEYS = ['accounts', 'patients', 'appointments', 'registrations',
  'verificationChallenges', 'authenticationChallenges', 'auditRows', 'notifications'];
const SAFETY_REFUSALS = new Set(['invalid_environment', 'database_identity_not_allowed']);

// Temporary, fixed-scope diagnostic. No commands, SQL, or cleanup options are
// taken from the request. The script's read-only transaction remains mandatory.
export function registerQaCleanupDryRunRoute(app, { prismaClient, env = process.env, createClient } = {}) {
  app.get('/api/qa/cleanup-dry-run', async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache', 'X-Robots-Tag': 'noindex' });
    if (req.method !== 'GET' || req.originalUrl.includes('?')
        || req.get('transfer-encoding') || Number(req.get('content-length') || 0) !== 0
        || (req.body && Object.keys(req.body).length !== 0)) return res.sendStatus(404);

    const snapshot = cleanupDryRunEnvironment(env);
    const match = /^Bearer ([^\s]+)$/i.exec(req.get('authorization') || '');
    if (!isQaVerificationCaptureEnabled(snapshot)
        || !match || !isValidQaVerificationCaptureToken(match[1], snapshot)) return res.sendStatus(404);

    try {
      validateCleanupEnvironment(snapshot); // Includes the exact target and DB pins.
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

    try {
      const result = await cleanupStagingQaDryRun({ env: snapshot, createClient });
      if (result.namespace !== CLEANUP_NAMESPACE || result.dryRun !== true || result.deleted !== false
          || !COUNT_KEYS.every(key => Number.isSafeInteger(result.counts?.[key]) && result.counts[key] >= 0)) {
        throw new CleanupRefusal('cleanup_failed');
      }
      return res.json({ namespace: CLEANUP_NAMESPACE, dryRun: true, deleted: false,
        counts: Object.fromEntries(COUNT_KEYS.map(key => [key, result.counts[key]])) });
    } catch (error) {
      const reason = cleanupRefusalReason(error);
      if (SAFETY_REFUSALS.has(reason)) return res.sendStatus(404);
      return res.status(409).json({ result: 'REFUSED', reason });
    }
  });
}
