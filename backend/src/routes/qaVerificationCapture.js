import {
  consumeQaVerificationCapture,
  discardQaVerificationCapture,
  isQaVerificationCaptureEnabled,
  isValidQaVerificationCaptureToken,
  peekQaVerificationCapture
} from '../utils/qaVerificationCapture.js';
import { isStagingQaEnvironment, normalizeQaMarker } from '../utils/qaEnvironmentMarkers.js';
import { getStagingLoadTestTarget } from '../utils/stagingLoadTestSafety.js';
import { logger } from '../utils/logger.js';

export function registerQaVerificationCaptureRoutes(app, { prismaClient, env = process.env, log = logger }) {
  function sensitiveResponse(res) {
    res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache', 'X-Robots-Tag': 'noindex' });
  }

  function authorized(req) {
    const authorization = req.get('authorization') || '';
    const match = /^Bearer ([^\s]+)$/i.exec(authorization);
    return Boolean(match && isValidQaVerificationCaptureToken(match[1], env));
  }

  async function targetAllowed() {
    const target = await getStagingLoadTestTarget(env, async () => {
      const [identity] = await prismaClient.$queryRaw`
        SELECT current_database()::text AS database,
          current_schema()::text AS schema,
          current_user::text AS role
      `;
      return identity;
    });
    return target.loadTestAllowed === true;
  }

  function deny(res, reason) {
    // Internal diagnostics stay in the explicit staging QA sink. Never pass
    // request data, capture data, environment values, or exceptions to logging.
    if (isStagingQaEnvironment(env) && normalizeQaMarker(env.QA_NOTIFICATION_MODE) === 'sink') {
      log.info('qa.verification_capture_denied', { reason });
    }
    return res.sendStatus(404);
  }

  // Define the static diagnostic before the challenge handler. It never reads
  // or consumes a capture and exposes no body, identity, or token-derived data.
  app.get('/api/qa/verification-capture-auth-check', async (req, res) => {
    sensitiveResponse(res);
    if (!isQaVerificationCaptureEnabled(env)) return res.sendStatus(404);
    if (!authorized(req)) return res.sendStatus(404);
    if (!(await targetAllowed())) return res.sendStatus(404);
    return res.sendStatus(204);
  });

  // Preserve the existing one-time capture authentication, DB challenge checks,
  // no-store headers, success payload, and externally indistinguishable 404s.
  app.get('/api/qa/verification-capture/:challengeId', async (req, res) => {
    sensitiveResponse(res);
    if (!isQaVerificationCaptureEnabled(env)) return deny(res, 'capture_disabled');
    if (!authorized(req)) return deny(res, 'authorization_missing_or_invalid');
    if (!(await targetAllowed())) return deny(res, 'gate_not_allowed');

    const challengeId = req.params.challengeId;
    const capture = peekQaVerificationCapture(challengeId);
    if (!capture) return deny(res, 'capture_missing');
    try {
      const challenge = await prismaClient.verificationChallenge.findFirst({
        where: {
          id: challengeId,
          type: 'REGISTRATION_EMAIL',
          targetNormalized: capture.recipient,
          usedAt: null,
          expiresAt: { gt: new Date() },
          user: { is: { email: capture.recipient, username: capture.recipient, role: 'PATIENT', status: 'PENDING_VERIFICATION' } }
        },
        select: { id: true }
      });
      if (!challenge) {
        discardQaVerificationCapture(challengeId);
        return deny(res, 'challenge_not_valid');
      }
    } catch {
      return deny(res, 'challenge_not_valid');
    }

    const consumed = consumeQaVerificationCapture(challengeId);
    if (!consumed) return deny(res, 'capture_consumption_failed');
    log.info('qa.verification_capture_served');
    return res.json({ challengeId, code: consumed.code, expiresAt: new Date(consumed.expiresAt).toISOString() });
  });
}
