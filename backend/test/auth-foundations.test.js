import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import prisma from '../src/db.js';
import { app, httpServer } from '../src/server.js';
import { createVerificationChallenge, consumeVerificationChallenge } from '../src/services/verification.js';
import { signAccessToken } from '../src/services/accessTokens.js';
import { authenticateSocketAccessToken } from '../src/middleware/auth.js';
import { SocketRevocationService, SOCKET_REVOCATION_CHANNEL } from '../src/services/socketRevocation.js';
import { Client } from 'pg';

const api = request(app);
const password = crypto.randomBytes(24).toString('base64') + 'aA1!';
const hash = await bcrypt.hash(password, 4);
let sequence = 0;
const auth = (token) => ({ Authorization: `Bearer ${token}` });
async function account(status = 'ACTIVE', role = 'PATIENT') {
  const unique = crypto.randomUUID();
  const user = await prisma.user.create({ data: { username: `${unique}@example.invalid`, email: `${unique}@example.invalid`, phoneNormalized: `+2507898${String(++sequence).padStart(5, '0')}`, passwordHash: hash, role, status } });
  if (role === 'PATIENT') await prisma.patient.create({ data: { userId: user.id, fullNameAr: 'Test', fullNameEn: 'Test', gender: 'MALE', dateOfBirth: '1990-01-01', phone: user.phoneNormalized, addressStateId: 1, emergencyContact: 'Self' } });
  return { user, token: signAccessToken(user) };
}
const verify = (issued) => api.post('/api/patient-auth/verify').send({ challengeId: issued.challenge.id, code: issued.developmentCode });
const issue = (user, purpose = 'REGISTRATION_PHONE', target = user.phoneNormalized) => createVerificationChallenge(user, purpose, target);
async function consume(issued, purpose, extras = {}) {
  return consumeVerificationChallenge({ challengeId: issued.challenge.id, code: issued.developmentCode, purpose, transition: async () => true, ...extras });
}
async function socketError(token) {
  return new Promise((resolve) => authenticateSocketAccessToken({ handshake: { auth: { token } } }, (error) => resolve(error)));
}
after(async () => { await prisma.$disconnect(); if (httpServer.listening) await new Promise((resolve) => httpServer.close(resolve)); });

test('registration accepts only its purpose; reset, email-change and ordinary phone challenges cannot activate accounts', async () => {
  const pending = await account('PENDING_VERIFICATION');
  const registration = await issue(pending.user);
  assert.equal((await verify(registration)).status, 200);
  for (const purpose of ['PASSWORD_RESET', 'PROFILE_EMAIL_CHANGE', 'PHONE']) {
    const { user } = await account();
    const issued = await issue(user, purpose, purpose === 'PHONE' ? user.phoneNormalized : user.email);
    await prisma.user.update({ where: { id: user.id }, data: { status: 'PENDING_VERIFICATION' } });
    assert.equal((await verify(issued)).status, 422);
    assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).status, 'PENDING_VERIFICATION');
    assert.equal((await prisma.verificationChallenge.findUnique({ where: { id: issued.challenge.id } })).usedAt, null);
  }
});

test('verification rejects wrong owner, wrong purpose, wrong target, stale generation and legacy challenges', async () => {
  const { user } = await account('PENDING_VERIFICATION');
  const issued = await issue(user);
  await assert.rejects(consume(issued, 'REGISTRATION_PHONE', { userId: crypto.randomUUID() }));
  await assert.rejects(consume(issued, 'REGISTRATION_EMAIL'));
  await prisma.verificationChallenge.update({ where: { id: issued.challenge.id }, data: { targetNormalized: '+250700000000' } });
  assert.equal((await verify(issued)).status, 422);
  await prisma.verificationChallenge.update({ where: { id: issued.challenge.id }, data: { targetNormalized: user.phoneNormalized } });
  await prisma.user.update({ where: { id: user.id }, data: { phoneNormalized: '+250700000001' } });
  assert.equal((await verify(issued)).status, 422);
  await prisma.user.update({ where: { id: user.id }, data: { phoneNormalized: user.phoneNormalized, authVersion: { increment: 1 } } });
  assert.equal((await verify(issued)).status, 422);
  await prisma.verificationChallenge.update({ where: { id: issued.challenge.id }, data: { authVersion: null } });
  assert.equal((await verify(issued)).status, 422);
});

test('expired, used and inactive-account registration challenges are rejected', async () => {
  for (const state of ['expired', 'used', 'inactive']) {
    const { user } = await account('PENDING_VERIFICATION');
    const issued = await issue(user);
    if (state === 'inactive') await prisma.user.update({ where: { id: user.id }, data: { status: 'INACTIVE' } });
    else await prisma.verificationChallenge.update({ where: { id: issued.challenge.id }, data: state === 'expired' ? { expiresAt: new Date(0) } : { usedAt: new Date() } });
    assert.equal((await verify(issued)).status, 422);
    assert.notEqual((await prisma.user.findUnique({ where: { id: user.id } })).status, 'ACTIVE');
  }
});

test('concurrent challenge consumption permits exactly one transition', async () => {
  const { user } = await account('PENDING_VERIFICATION');
  const issued = await issue(user);
  const results = await Promise.all(Array.from({ length: 8 }, () => verify(issued)));
  assert.equal(results.filter((result) => result.status === 200).length, 1);
  assert.equal(await prisma.patient.count({ where: { userId: user.id } }), 1);
});

test('concurrent incorrect attempts cannot exceed the budget for any verification purpose', async () => {
  for (const purpose of ['REGISTRATION_PHONE', 'PHONE', 'PASSWORD_RESET', 'PROFILE_EMAIL_CHANGE']) {
    const { user } = await account(purpose.startsWith('REGISTRATION') ? 'PENDING_VERIFICATION' : 'ACTIVE');
    const issued = await issue(user, purpose, purpose.endsWith('PHONE') ? user.phoneNormalized : user.email);
    const outcomes = await Promise.allSettled(Array.from({ length: 9 }, () => consume(issued, purpose, { code: '000000', currentPassword: password })));
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 0);
    const stored = await prisma.verificationChallenge.findUnique({ where: { id: issued.challenge.id } });
    assert.equal(stored.attemptCount, stored.maxAttempts);
    await assert.rejects(consume(issued, purpose, { currentPassword: password }), { code: 'VERIFICATION_ATTEMPTS_EXCEEDED' });
  }
});

test('recovery email needs current password and atomically revokes old reset codes and sessions without relinking records', async () => {
  const { user, token } = await account();
  const patientBefore = await prisma.patient.findUnique({ where: { userId: user.id } });
  const oldReset = await issue(user, 'PASSWORD_RESET', user.email);
  const email = `${crypto.randomUUID()}@example.invalid`;
  const url = '/api/patient/me/email-change/request';
  assert.equal((await api.post(url).set(auth(token)).send({ email })).status, 422);
  assert.equal((await api.post(url).set(auth(token)).send({ email, currentPassword: 'wrong' })).status, 401);
  const started = await api.post(url).set(auth(token)).send({ email, currentPassword: password });
  assert.equal(started.status, 201);
  const body = { challengeId: started.body.challengeId, code: started.body.developmentCode };
  const finish = '/api/patient/me/email-change/verify';
  assert.equal((await api.post(finish).set(auth(token)).send(body)).status, 422);
  assert.equal((await api.post(finish).set(auth(token)).send({ ...body, currentPassword: 'wrong' })).status, 401);
  const changed = await api.post(finish).set(auth(token)).send({ ...body, currentPassword: password });
  assert.equal(changed.status, 200);
  assert.match(changed.headers['cache-control'], /no-store/);
  const updated = await prisma.user.findUnique({ where: { id: user.id } });
  assert.equal(updated.email, email);
  assert.equal(updated.authVersion, user.authVersion + 1);
  assert.deepEqual(await prisma.patient.findUnique({ where: { userId: user.id } }), patientBefore);
  assert.equal((await api.get('/api/patient/me').set(auth(token))).status, 401);
  assert.ok((await prisma.verificationChallenge.findUnique({ where: { id: oldReset.challenge.id } })).usedAt);
  assert.equal((await api.post('/api/patient-auth/reset-password').send({ challengeId: oldReset.challenge.id, code: oldReset.developmentCode, newPassword: password })).status, 422);
});

test('logout revokes copied tokens for all six roles, leaves unrelated accounts valid, and repeated logout is harmless', async () => {
  const other = await account();
  for (const role of ['PATIENT', 'ADMIN', 'RECEPTIONIST', 'DOCTOR', 'PHARMACIST', 'LAB_TECH']) {
    const { user, token } = await account('ACTIVE', role);
    assert.equal(await socketError(token), undefined);
    const results = await Promise.all([api.post('/api/auth/logout').set(auth(token)), api.post('/api/auth/logout').set(auth(token))]);
    assert.ok(results.every((result) => [204, 401].includes(result.status)));
    assert.ok(results.some((result) => result.status === 204));
    assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).authVersion, user.authVersion + 1);
    assert.equal((await api.get('/api/patient/me').set(auth(token))).status, 401);
    assert.equal((await api.get('/api/auth/users').set(auth(token))).status, 401);
    assert.equal((await socketError(token)).data.code, 'SESSION_REVOKED');
    assert.equal((await api.post('/api/auth/logout').set(auth(token))).status, 401);
    assert.equal((await api.get('/api/patient/me').set(auth(other.token))).status, 200);
  }
});

test('logout publishes a committed generation change which disconnects only stale account sockets', async () => {
  const { user, token } = await account();
  const other = await account();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`LISTEN ${SOCKET_REVOCATION_CHANNEL}`);
  let disconnects = 0;
  const makeSocket = (id, av) => ({ user: { id, av }, emit() {}, disconnect() { disconnects++; } });
  const sockets = new Map([['target', makeSocket(user.id, user.authVersion)], ['other', makeSocket(other.user.id, other.user.authVersion)]]);
  const service = new SocketRevocationService({ of: () => ({ sockets, adapter: { rooms: new Map([[`user_${user.id}`, new Set(['target'])], [`user_${other.user.id}`, new Set(['other'])]]) } }) }, {});
  try {
    const notice = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Revocation notification timeout')), 3000);
      client.on('notification', (message) => { const payload = JSON.parse(message.payload); if (payload.userId === user.id) { clearTimeout(timer); resolve(message.payload); } });
    });
    assert.equal((await api.post('/api/auth/logout').set(auth(token))).status, 204);
    service.handleNotification(await notice);
    assert.equal(disconnects, 1);
  } finally { await client.end(); }
});

test('authenticated phone verification has a separate owner-bound endpoint and never activates inactive accounts', async () => {
  const { user, token } = await account();
  const issued = await api.post('/api/patient-auth/verification/request').set(auth(token)).send({ type: 'PHONE' });
  assert.equal(issued.status, 201);
  const body = { challengeId: issued.body.challengeId, code: issued.body.developmentCode, type: 'PHONE' };
  const other = await account();
  assert.equal((await api.post('/api/patient-auth/verification/verify').set(auth(other.token)).send(body)).status, 422);
  assert.equal((await api.post('/api/patient-auth/verification/verify').set(auth(token)).send({ ...body, type: 'EMAIL' })).status, 422);
  assert.equal((await api.post('/api/patient-auth/verification/verify').set(auth(token)).send(body)).status, 200);
  assert.ok((await prisma.user.findUnique({ where: { id: user.id } })).phoneVerifiedAt);
});

test('phone change invalidates previous identity challenges even if the target later returns to its original value', async () => {
  const { user, token } = await account();
  await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  const oldPhone = await issue(user, 'PHONE');
  const oldReset = await issue(user, 'PASSWORD_RESET', user.email);
  const linkedBefore = await prisma.patient.findUnique({ where: { userId: user.id } });
  const response = await api.post('/api/patient/me/phone-change/request').set(auth(token)).send({ phone: '+250700012345' });
  assert.equal(response.status, 201);
  const body = { challengeId: response.body.challengeId, code: response.body.developmentCode };
  assert.equal((await api.post('/api/patient-auth/verify').send(body)).status, 422);
  assert.equal((await api.post('/api/patient/me/phone-change/verify').set(auth(token)).send(body)).status, 200);
  const linkedAfter = await prisma.patient.findUnique({ where: { userId: user.id } });
  assert.equal(linkedAfter.id, linkedBefore.id);
  assert.equal(linkedAfter.fileNumber, linkedBefore.fileNumber);
  assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).phoneVerifiedAt, null);
  await prisma.user.update({ where: { id: user.id }, data: { phoneNormalized: user.phoneNormalized } });
  await assert.rejects(consume(oldPhone, 'PHONE'));
  await assert.rejects(consume(oldReset, 'PASSWORD_RESET'));
});

test('failed security transition rolls back challenge consumption and activation together', async () => {
  const { user } = await account('PENDING_VERIFICATION');
  const issued = await issue(user);
  await assert.rejects(consume(issued, 'REGISTRATION_PHONE', { transition: async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { status: 'ACTIVE' } });
    throw new Error('Simulated transaction failure');
  } }));
  assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).status, 'PENDING_VERIFICATION');
  assert.equal((await prisma.verificationChallenge.findUnique({ where: { id: issued.challenge.id } })).usedAt, null);
});
