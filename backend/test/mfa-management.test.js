import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import * as OTPAuth from 'otpauth';
import request from 'supertest';
import prisma from '../src/db.js';
import { app } from '../src/server.js';
import { encryptMfaSecret } from '../src/services/mfaCrypto.js';
import { createMfaChallenge, generateRecoveryCodes, hashRecoveryCodes } from '../src/services/mfa.js';
import { signAccessToken } from '../src/services/accessTokens.js';
import { resetTestRateLimiters } from '../src/utils/edgeSecurity.js';

const api = request(app);
const password = 'Local-Mfa-Management@123';
beforeEach(async () => resetTestRateLimiters());
after(async () => prisma.$disconnect());
async function enabled({ leadingZero = false, usedTotp = false, corrupt = false } = {}) {
  let secret, totp, code;
  do {
    secret = new OTPAuth.Secret({ size: 20 });
    totp = new OTPAuth.TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret });
    code = totp.generate();
  } while (leadingZero && !code.startsWith('0'));
  const user = await prisma.user.create({ data: { username: `mfa-management-${crypto.randomUUID()}@example.test`, role: 'RECEPTIONIST', passwordHash: await bcrypt.hash(password, 4), mfaEnabled: true } });
  await prisma.mfaConfiguration.create({ data: { userId: user.id, state: 'ACTIVE', secretEncrypted: corrupt ? 'unreadable-configuration' : encryptMfaSecret(secret.base32, user.id), lastTotpStep: usedTotp ? BigInt(Math.floor(Date.now() / 30000)) : null } });
  const [recoveryCode] = generateRecoveryCodes();
  const [codeHash] = await hashRecoveryCodes([recoveryCode]);
  const recovery = await prisma.mfaRecoveryCode.create({ data: { userId: user.id, codeHash } });
  const token = signAccessToken({ id: user.id, username: user.username, role: user.role, authVersion: user.authVersion });
  return { user, code, totp, recoveryCode, recovery, headers: { Authorization: `Bearer ${token}` } };
}
const disable = (fixture, body) => api.delete('/api/auth/mfa').set(fixture.headers).send(body);

test('current password and fresh leading-zero TOTP disable MFA and remove configuration, challenges, codes and sessions', async () => {
  const f = await enabled({ leadingZero: true });
  await createMfaChallenge(f.user.id, f.user.authVersion);
  const response = await disable(f, { currentPassword: password, totpCode: f.code });
  assert.equal(response.status, 200); assert.deepEqual(response.body, { state: 'DISABLED' });
  assert.match(response.headers['cache-control'], /no-store/);
  const user = await prisma.user.findUnique({ where: { id: f.user.id } });
  assert.equal(user.mfaEnabled, false); assert.equal(user.authVersion, f.user.authVersion + 1);
  assert.equal(await prisma.mfaConfiguration.count({ where: { userId: user.id } }), 0);
  assert.equal(await prisma.mfaRecoveryCode.count({ where: { userId: user.id } }), 0);
  assert.equal(await prisma.mfaChallenge.count({ where: { userId: user.id } }), 0);
  assert.equal((await api.get('/api/patients').set(f.headers)).status, 401);
});

test('wrong password, invalid TOTP and reused TOTP use the same safe error and do not change MFA', async () => {
  const f = await enabled();
  const wrongPassword = await disable(f, { currentPassword: 'wrong-password', totpCode: f.code });
  let invalidCode = '000000';
  while (f.totp.validate({ token: invalidCode, window: 1 }) !== null) invalidCode = String(Number(invalidCode) + 1).padStart(6, '0');
  const wrongTotp = await disable(f, { currentPassword: password, totpCode: invalidCode });
  assert.equal(wrongPassword.status, 401); assert.equal(wrongTotp.status, 401); assert.deepEqual(wrongPassword.body, wrongTotp.body);
  assert.equal((await prisma.mfaConfiguration.findUnique({ where: { userId: f.user.id } })).lastTotpStep, null);
  await prisma.mfaConfiguration.update({ where: { userId: f.user.id }, data: { lastTotpStep: BigInt(Math.floor(Date.now() / 30000)) } });
  const reused = await disable(f, { currentPassword: password, totpCode: f.totp.generate() });
  assert.equal(reused.status, 401); assert.deepEqual(reused.body, wrongPassword.body);
  assert.equal((await prisma.user.findUnique({ where: { id: f.user.id } })).mfaEnabled, true);
});

test('unused recovery code disables MFA while used/invalid recovery stays generic', async () => {
  const f = await enabled();
  await prisma.mfaRecoveryCode.update({ where: { id: f.recovery.id }, data: { usedAt: new Date() } });
  const reused = await disable(f, { currentPassword: password, recoveryCode: f.recoveryCode });
  assert.equal(reused.status, 401); assert.equal(reused.body.error.code, 'MFA_REAUTH_FAILED');
  await prisma.mfaRecoveryCode.update({ where: { id: f.recovery.id }, data: { usedAt: null } });
  const response = await disable(f, { currentPassword: password, recoveryCode: f.recoveryCode });
  assert.equal(response.status, 200); assert.deepEqual(response.body, { state: 'DISABLED' });
});

test('malformed requests are distinct and required policy cannot be bypassed', async () => {
  const f = await enabled();
  for (const body of [{ currentPassword: password, totpCode: 123456 }, { currentPassword: password }, { currentPassword: password, totpCode: f.code, recoveryCode: f.recoveryCode }]) {
    const response = await disable(f, body);
    assert.equal(response.status, 422); assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  }
  const previous = process.env.STAFF_MFA_POLICY;
  try {
    process.env.STAFF_MFA_POLICY = 'required';
    const response = await disable(f, { currentPassword: password, totpCode: f.code });
    assert.equal(response.status, 403); assert.equal(response.body.error.code, 'MFA_REQUIRED_POLICY');
    assert.equal((await api.get('/api/public-config')).body.staffMfaRequired, true);
    assert.equal((await prisma.mfaConfiguration.findUnique({ where: { userId: f.user.id } })).lastTotpStep, null);
  } finally { if (previous === undefined) delete process.env.STAFF_MFA_POLICY; else process.env.STAFF_MFA_POLICY = previous; }
});

test('unreadable MFA configuration produces a safe server error rather than a credential error', async () => {
  const f = await enabled({ corrupt: true });
  const response = await disable(f, { currentPassword: password, totpCode: f.code });
  assert.equal(response.status, 500); assert.deepEqual(response.body, { error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected server error occurred.' } });
  assert.equal((await prisma.user.findUnique({ where: { id: f.user.id } })).mfaEnabled, true);
});

for (const proofType of ['totp', 'recovery']) test(`failed disable audit rolls back ${proofType} consumption and configuration changes`, async () => {
  const f = await enabled();
  await prisma.$executeRawUnsafe(`CREATE FUNCTION reject_mfa_disable_audit() RETURNS trigger AS $$ BEGIN IF NEW.action = 'MFA_DISABLED' THEN RAISE EXCEPTION 'forced MFA audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_mfa_disable_audit BEFORE INSERT ON "TenantAuditLog" FOR EACH ROW EXECUTE FUNCTION reject_mfa_disable_audit()`);
  const body = { currentPassword: password, ...(proofType === 'totp' ? { totpCode: f.code } : { recoveryCode: f.recoveryCode }) };
  try {
    const failed = await disable(f, body); assert.equal(failed.status, 500);
    const config = await prisma.mfaConfiguration.findUnique({ where: { userId: f.user.id } });
    assert.equal(config.lastTotpStep, null);
    assert.equal((await prisma.mfaRecoveryCode.findUnique({ where: { id: f.recovery.id } })).usedAt, null);
    assert.equal((await prisma.user.findUnique({ where: { id: f.user.id } })).authVersion, f.user.authVersion);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER reject_mfa_disable_audit ON "TenantAuditLog"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION reject_mfa_disable_audit()`);
  }
  assert.equal((await disable(f, body)).status, 200);
});

test('concurrent disable submissions commit one security change and one audit', async () => {
  const f = await enabled();
  const body = { currentPassword: password, totpCode: f.code };
  const results = await Promise.all([disable(f, body), disable(f, body)]);
  assert.equal(results.filter(response => response.status === 200).length, 1);
  assert.ok(results.every(response => [200, 401, 409].includes(response.status)));
  assert.equal(await prisma.tenantAuditLog.count({ where: { userId: f.user.id, action: 'MFA_DISABLED' } }), 1);
});
