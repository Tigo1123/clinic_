import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { getStagingLoadTestTarget, stagingLoadTestPreflight } from './stagingLoadTestSafety.js';
import { isQaVerificationCaptureEnabled, isSyntheticQaEmail, readQaCaptureStorageKey } from './qaVerificationCaptureConfig.js';
export { isQaVerificationCaptureEnabled, isSyntheticQaEmail, isValidQaVerificationCaptureToken } from './qaVerificationCaptureConfig.js';

const CHALLENGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE = /^\d{6}$/;
const CAPTURE_TTL_MS = 5 * 60 * 1000;
const selection = { id: true, userId: true, type: true, targetNormalized: true, usedAt: true,
  expiresAt: true, createdAt: true, authVersion: true, attemptCount: true, maxAttempts: true,
  user: { select: { id: true, email: true, username: true, role: true, status: true, authVersion: true } } };
const aad = (id, expiry) => Buffer.from('shifa-staging-qa-capture:v1:' + id + ':' + expiry.toISOString());

function encrypt(code, key, id, expiry) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(id, expiry));
  const encrypted = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join(':');
}
function decrypt(value, key, id, expiry) {
  if (typeof value !== 'string' || !/^v1:[a-f0-9]{24}:[a-f0-9]{32}:[a-f0-9]{12}$/.test(value)) throw new Error();
  const [, iv, tag, encrypted] = value.split(':');
  const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  cipher.setAAD(aad(id, expiry)); cipher.setAuthTag(Buffer.from(tag, 'hex'));
  const code = Buffer.concat([cipher.update(Buffer.from(encrypted, 'hex')), cipher.final()]).toString('utf8');
  if (!CODE.test(code)) throw new Error();
  return code;
}
const eligible = (env, id, client) => isQaVerificationCaptureEnabled(env) && CHALLENGE_ID.test(id || '')
  && typeof client?.$transaction === 'function' && stagingLoadTestPreflight(env).canInspectDatabase;
async function gateAllowed(tx, env) {
  const target = await getStagingLoadTestTarget(env, async () => {
    const [identity] = await tx.$queryRaw`SELECT current_database()::text AS database, current_schema()::text AS schema, current_user::text AS role`;
    return identity;
  });
  return target.loadTestAllowed === true;
}
async function lockedChallenge(tx, id) {
  const candidate = await tx.verificationChallenge.findUnique({ where: { id }, select: { userId: true } });
  if (!candidate) return null;
  // Match the normal verification transaction's lock order: user, challenge.
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${candidate.userId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "VerificationChallenge" WHERE "id"=${id} FOR UPDATE`;
  return tx.verificationChallenge.findUnique({ where: { id }, select: selection });
}
function valid(challenge, id, now, recipient = challenge?.targetNormalized) {
  return challenge?.id === id && challenge.type === 'REGISTRATION_EMAIL'
    && isSyntheticQaEmail(recipient) && challenge.targetNormalized === recipient && challenge.usedAt === null
    && challenge.expiresAt instanceof Date && challenge.expiresAt.getTime() > now
    && challenge.createdAt instanceof Date && challenge.createdAt.getTime() + CAPTURE_TTL_MS > now
    && challenge.user?.id === challenge.userId && challenge.user.email === recipient && challenge.user.username === recipient
    && challenge.user.role === 'PATIENT' && challenge.user.status === 'PENDING_VERIFICATION'
    && Number.isInteger(challenge.authVersion) && challenge.authVersion === challenge.user.authVersion
    && challenge.attemptCount < challenge.maxAttempts;
}

export async function captureQaVerificationCode({ env = process.env, prismaClient, challengeId, recipient, code, now = Date.now() }) {
  env = Object.freeze({ ...env });
  if (!eligible(env, challengeId, prismaClient) || !isSyntheticQaEmail(recipient) || !CODE.test(code || '')) return false;
  try {
    const stored = await prismaClient.$transaction(async tx => {
      if (!await gateAllowed(tx, env)) return false;
      const challenge = await lockedChallenge(tx, challengeId);
      if (!valid(challenge, challengeId, now)) {
        await tx.qaVerificationCapture.deleteMany({ where: { challengeId } });
        return false;
      }
      if (challenge.targetNormalized !== recipient) return false;
      await tx.qaVerificationCapture.deleteMany({ where: { challengeId, expiresAt: { lte: new Date(now) } } });
      const expiresAt = new Date(Math.min(challenge.expiresAt.getTime(), challenge.createdAt.getTime() + CAPTURE_TTL_MS, now + CAPTURE_TTL_MS));
      // Create, never overwrite or extend an existing capture.
      await tx.qaVerificationCapture.create({ data: { challengeId,
        codeEncrypted: encrypt(code, readQaCaptureStorageKey(env), challengeId, expiresAt),
        expiresAt, createdAt: new Date(now) } });
      return true;
    }, { timeout: 15000 });
    // Prune only this dedicated QA table, outside the account-lock transaction.
    // Maintenance failure cannot undo a successfully persisted capture.
    if (stored) await prismaClient.qaVerificationCapture.deleteMany({ where: { expiresAt: { lte: new Date(now) } } }).catch(() => {});
    return stored;
  } catch { return false; }
}

export async function consumeQaVerificationCapture({ env = process.env, prismaClient, challengeId, now = Date.now() }) {
  env = Object.freeze({ ...env });
  const refused = reason => ({ capture: null, reason });
  if (!eligible(env, challengeId, prismaClient)) return refused('capture_disabled');
  try {
    return await prismaClient.$transaction(async tx => {
      if (!await gateAllowed(tx, env)) return refused('gate_not_allowed');
      const challenge = await lockedChallenge(tx, challengeId);
      const capture = await tx.qaVerificationCapture.findUnique({ where: { challengeId } });
      if (!capture) return refused('capture_missing');
      const discard = async reason => {
        await tx.qaVerificationCapture.deleteMany({ where: { challengeId } });
        return refused(reason);
      };
      if (capture.expiresAt instanceof Date && capture.expiresAt.getTime() <= now) return discard('capture_missing');
      if (!valid(challenge, challengeId, now)
          || !(capture.createdAt instanceof Date) || !(capture.expiresAt instanceof Date)
          || now < capture.createdAt.getTime() || now >= capture.expiresAt.getTime()
          || capture.expiresAt.getTime() > Math.min(capture.createdAt.getTime() + CAPTURE_TTL_MS,
            (challenge?.createdAt?.getTime() || 0) + CAPTURE_TTL_MS, challenge?.expiresAt?.getTime() || 0)) {
        return discard('challenge_not_valid');
      }
      let code;
      try { code = decrypt(capture.codeEncrypted, readQaCaptureStorageKey(env), challengeId, capture.expiresAt); }
      catch { return discard('capture_consumption_failed'); }
      const claimed = await tx.qaVerificationCapture.deleteMany({ where: { challengeId, codeEncrypted: capture.codeEncrypted } });
      if (claimed.count !== 1) return refused('capture_consumption_failed');
      return { capture: { code, expiresAt: capture.expiresAt.getTime() }, reason: null };
    }, { timeout: 15000 });
  } catch { return refused('capture_consumption_failed'); }
}
