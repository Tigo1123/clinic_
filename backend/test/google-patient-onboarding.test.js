import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import prisma from '../src/db.js';
import { app, shutdown } from '../src/server.js';
import { generateOnboardingCapability, hashOnboardingCapability } from '../src/services/externalAuthCapability.js';
import { PrismaClient } from '../src/generated/prisma/index.js';
import { completeGooglePatientOnboarding } from '../src/services/googlePatientOnboarding.js';

const createdPending = [], createdUsers = [], createdPatients = [];
after(async () => {
  if (createdPatients.length) await prisma.patient.deleteMany({ where: { id: { in: createdPatients } } });
  if (createdPending.length) await prisma.pendingExternalAuth.deleteMany({ where: { id: { in: createdPending } } });
  if (createdUsers.length) await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await shutdown('google-patient-onboarding-test');
});

async function createPending(overrides = {}) {
  const token = generateOnboardingCapability();
  const pending = await prisma.pendingExternalAuth.create({ data: {
    provider: 'GOOGLE', providerSubject: `subject-${randomUUID()}`, verifiedEmail: `${randomUUID()}@example.invalid`,
    capabilityHash: hashOnboardingCapability(token), expiresAt: new Date(Date.now() + 15 * 60 * 1000), ...overrides
  } });
  createdPending.push(pending.id);
  return { pending, token };
}
function payload(token, overrides = {}) { return {
  onboardingToken: token, firstNameAr: 'أحمد', fatherNameAr: 'محمد', grandfatherNameAr: 'علي', familyNameAr: 'سالم',
  firstNameEn: 'Ahmed', fatherNameEn: 'Mohamed', grandfatherNameEn: 'Ali', familyNameEn: 'Salem',
  dateOfBirth: '1990-01-01', gender: 'MALE', phone: `+249900${String(Date.now()).slice(-6)}`,
  password: 'ValidPass1!', addressStateId: 1, ...overrides
}; }
async function findCreatedUser(email) {
  const user = await prisma.user.findUnique({ where: { email }, include: { externalIdentities: true, pendingPatientRegistration: true, patient: true } });
  createdUsers.push(user.id); return user;
}

test('Google completion strictly accepts token and registration fields only', async () => {
  const { token } = await createPending();
  const response = await request(app).post('/api/patient-auth/google/complete').send({ ...payload(token), email: 'attacker@example.invalid' });
  assert.equal(response.status, 422); assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('new Google patient completes with trusted email, active account, Patient, MRN, and no challenge', async () => {
  const { pending, token } = await createPending();
  const response = await request(app).post('/api/patient-auth/google/complete').send(payload(token));
  assert.equal(response.status, 201); assert.equal(response.body.status, 'AUTHENTICATED'); assert.ok(response.body.token);
  assert.equal(response.body.challengeId, undefined);
  const user = await findCreatedUser(pending.verifiedEmail);
  assert.equal(user.role, 'PATIENT'); assert.equal(user.status, 'ACTIVE'); assert.ok(user.emailVerifiedAt); assert.equal(user.phoneVerifiedAt, null);
  assert.ok(user.patient?.fileNumber); assert.equal(user.externalIdentities.length, 1); assert.equal(user.externalIdentities[0].providerSubject, pending.providerSubject);
  assert.equal(await prisma.verificationChallenge.count({ where: { userId: user.id } }), 0);
  assert.ok((await prisma.pendingExternalAuth.findUnique({ where: { id: pending.id } })).consumedAt);
});

test('Google completion waits beyond the default acquisition budget for a busy connection', async () => {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'Contention test requires local PostgreSQL');
  url.searchParams.set('connection_limit', '1');
  const db = new PrismaClient({ datasources: { db: { url: url.href } } });
  const { pending, token } = await createPending();
  let release;
  let acquired;
  const held = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { acquired = resolve; });
  const blocker = db.$transaction(async () => { acquired(); await held; }, { timeout: 15000 });
  // Also surface startup failures rather than leaving the test waiting for ready.
  let timer;
  try {
    await Promise.race([ready, blocker]);
    await assert.rejects(db.$transaction(async () => {}, { timeout: 15000 }), error => {
      assert.equal(error.code, 'P2028');
      assert.match(error.message, /Unable to start a transaction in the given time/);
      return true;
    });
    const fields = payload(token);
    // Finish bcrypt before occupying the acquisition queue so the delay is deterministic.
    const completion = completeGooglePatientOnboarding({ onboardingToken: token, fields, db: {
      $transaction(callback, options) {
        assert.deepEqual(options, { maxWait: 10000, timeout: 15000 });
        timer = setTimeout(release, 2500);
        return db.$transaction(callback, options);
      }
    } });
    const result = await completion;
    assert.equal(result.status, 'AUTHENTICATED');
    assert.ok(result.token);
    const user = await findCreatedUser(pending.verifiedEmail);
    assert.equal(user.externalIdentities.length, 1);
    assert.ok(user.patient?.fileNumber);
    assert.ok((await prisma.pendingExternalAuth.findUnique({ where: { id: pending.id } })).consumedAt);
  } finally {
    clearTimeout(timer);
    release();
    await blocker;
    await db.$disconnect();
  }
});

test('Google completion never auto-links a legacy Patient without phone verification', async () => {
  const { pending, token } = await createPending(); const fields = payload(token);
  const legacy = await prisma.patient.create({ data: { fullNameAr: 'مريض سابق', fullNameEn: 'Legacy Patient', gender: fields.gender, dateOfBirth: fields.dateOfBirth, phone: fields.phone, addressStateId: 1, emergencyContact: 'Self' } });
  createdPatients.push(legacy.id);
  const response = await request(app).post('/api/patient-auth/google/complete').send(fields);
  assert.equal(response.body.state, 'MANUAL_REVIEW_REQUIRED'); assert.equal(response.body.token, undefined);
  const user = await findCreatedUser(pending.verifiedEmail); assert.equal(user.phoneVerifiedAt, null);
  assert.equal((await prisma.patient.findUnique({ where: { id: legacy.id } })).userId, null); assert.equal(await prisma.patient.count({ where: { userId: user.id } }), 0);
});

test('ambiguous legacy identity requires review and never creates a duplicate Patient', async () => {
  const { pending, token } = await createPending(); const fields = payload(token);
  for (const name of ['Legacy One', 'Legacy Two']) { const patient = await prisma.patient.create({ data: { fullNameAr: name, fullNameEn: name, gender: fields.gender, dateOfBirth: fields.dateOfBirth, phone: fields.phone, addressStateId: 1, emergencyContact: 'Self' } }); createdPatients.push(patient.id); }
  const response = await request(app).post('/api/patient-auth/google/complete').send(fields);
  assert.equal(response.body.state, 'AMBIGUOUS_MATCH'); assert.equal(response.body.token, undefined);
  const user = await findCreatedUser(pending.verifiedEmail); assert.equal(await prisma.patient.count({ where: { userId: user.id } }), 0); assert.equal(await prisma.patient.count({ where: { phone: fields.phone } }), 2);
});

test('disabled phone provider does not affect Google completion and creates no phone challenge', async () => {
  const { pending, token } = await createPending(); const previous = process.env.PHONE_VERIFICATION_PROVIDER; process.env.PHONE_VERIFICATION_PROVIDER = 'disabled';
  try { const response = await request(app).post('/api/patient-auth/google/complete').send(payload(token)); assert.equal(response.status, 201); assert.equal(response.body.status, 'AUTHENTICATED'); }
  finally { if (previous === undefined) delete process.env.PHONE_VERIFICATION_PROVIDER; else process.env.PHONE_VERIFICATION_PROVIDER = previous; }
  const user = await findCreatedUser(pending.verifiedEmail); assert.equal(user.phoneVerifiedAt, null); assert.equal(await prisma.verificationChallenge.count({ where: { userId: user.id } }), 0);
});

test('completion replay is rejected and concurrent completion creates one durable account', async () => {
  const { pending, token } = await createPending();
  const responses = await Promise.all([request(app).post('/api/patient-auth/google/complete').send(payload(token)), request(app).post('/api/patient-auth/google/complete').send(payload(token))]);
  assert.equal(responses.filter((response) => response.status === 201).length, 1); assert.equal(responses.filter((response) => [409, 422].includes(response.status)).length, 1);
  const user = await findCreatedUser(pending.verifiedEmail); assert.equal(await prisma.user.count({ where: { email: pending.verifiedEmail } }), 1); assert.equal(await prisma.patient.count({ where: { userId: user.id } }), 1); assert.equal(await prisma.userExternalIdentity.count({ where: { userId: user.id } }), 1);
  const replay = await request(app).post('/api/patient-auth/google/complete').send(payload(token)); assert.equal(replay.status, 422); assert.equal(replay.body.error.code, 'GOOGLE_ONBOARDING_INVALID');
});

test('unknown, expired, and consumed capabilities are rejected without writes', async () => {
  const unknown = await request(app).post('/api/patient-auth/google/complete').send(payload(generateOnboardingCapability())); assert.equal(unknown.status, 422);
  const expired = await createPending(); await prisma.pendingExternalAuth.update({ where: { id: expired.pending.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await request(app).post('/api/patient-auth/google/complete').send(payload(expired.token))).status, 422);
  const consumed = await createPending({ consumedAt: new Date() }); assert.equal((await request(app).post('/api/patient-auth/google/complete').send(payload(consumed.token))).status, 422);
});
