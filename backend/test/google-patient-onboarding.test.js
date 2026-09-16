import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import prisma from '../src/db.js';
import { app, shutdown } from '../src/server.js';
import { generateOnboardingCapability, hashOnboardingCapability } from '../src/services/externalAuthCapability.js';
import { completeGooglePatientOnboarding } from '../src/services/googlePatientOnboarding.js';
import { createVerificationChallenge } from '../src/services/verification.js';

const createdPending = [];
const createdUsers = [];
const createdIdentities = [];

after(async () => {
  if (createdPending.length) await prisma.pendingExternalAuth.deleteMany({ where: { id: { in: createdPending } } });
  if (createdIdentities.length) await prisma.userExternalIdentity.deleteMany({ where: { id: { in: createdIdentities } } });
  if (createdUsers.length) await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await shutdown('google-patient-onboarding-test');
});

function identity(overrides = {}) {
  return {
    provider: 'GOOGLE',
    providerSubject: `subject-${randomUUID()}`,
    verifiedEmail: `${randomUUID()}@example.invalid`,
    ...overrides
  };
}

async function createPending(overrides = {}) {
  const token = generateOnboardingCapability();
  const values = identity(overrides);
  const pending = await prisma.pendingExternalAuth.create({
    data: {
      provider: values.provider,
      providerSubject: values.providerSubject,
      verifiedEmail: values.verifiedEmail,
      capabilityHash: hashOnboardingCapability(token),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000)
    }
  });
  createdPending.push(pending.id);
  return { pending, token };
}

function payload(token, overrides = {}) {
  return {
    onboardingToken: token,
    firstNameAr: 'أحمد', fatherNameAr: 'محمد', grandfatherNameAr: 'علي', familyNameAr: 'سالم',
    firstNameEn: 'Ahmed', fatherNameEn: 'Mohamed', grandfatherNameEn: 'Ali', familyNameEn: 'Salem',
    dateOfBirth: '1990-01-01', gender: 'MALE', phone: `+249900${String(Date.now()).slice(-6)}`,
    password: 'ValidPass1!', addressStateId: 1,
    ...overrides
  };
}

async function createUser({ email, role = 'PATIENT', status = 'ACTIVE' }) {
  const user = await prisma.user.create({ data: {
    username: email, email, passwordHash: `test-only-${randomUUID()}`, role, status
  } });
  createdUsers.push(user.id);
  return user;
}

test('Google completion strictly accepts the token and registration fields only', async () => {
  const { token } = await createPending();
  const response = await request(app).post('/api/patient-auth/google/complete').send({ ...payload(token), email: 'attacker@example.invalid' });
  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('phone delivery failure leaves a pending account recoverable through phone resend', async () => {
  const { pending, token } = await createPending();
  const fields = payload(token);
  await assert.rejects(
    completeGooglePatientOnboarding({
      onboardingToken: token,
      fields,
      phoneDelivery: async () => { throw new Error('provider credentials must stay private'); }
    }),
    { code: 'VERIFICATION_DELIVERY_FAILED', status: 503, message: 'Verification could not be delivered.' }
  );

  const user = await prisma.user.findUnique({ where: { email: pending.verifiedEmail }, include: { externalIdentities: true, pendingPatientRegistration: true } });
  createdUsers.push(user.id);
  assert.equal(user.status, 'PENDING_VERIFICATION');
  assert.ok(user.emailVerifiedAt);
  assert.equal(user.phoneVerifiedAt, null);
  assert.equal(user.externalIdentities.length, 1);
  assert.ok(user.pendingPatientRegistration);
  assert.equal(await prisma.patient.count({ where: { userId: user.id } }), 0);
  assert.ok((await prisma.pendingExternalAuth.findUnique({ where: { id: pending.id } })).consumedAt);

  const failedChallenge = await prisma.verificationChallenge.findFirst({ where: { userId: user.id, type: 'REGISTRATION_PHONE' }, orderBy: { createdAt: 'desc' } });
  assert.ok(failedChallenge);
  assert.equal(failedChallenge.usedAt, null);

  const resend = await createVerificationChallenge(user, 'REGISTRATION_PHONE', user.phoneNormalized);
  assert.ok(resend.developmentCode);
  const resentChallenge = await prisma.verificationChallenge.findUnique({ where: { id: resend.challenge.id } });
  assert.equal(resentChallenge.type, 'REGISTRATION_PHONE');
  assert.equal(resentChallenge.targetNormalized, user.phoneNormalized);
  assert.ok((await prisma.verificationChallenge.findUnique({ where: { id: failedChallenge.id } })).usedAt);

  const verified = await request(app).post('/api/patient-auth/verify').send({ challengeId: resend.challenge.id, code: resend.developmentCode });
  assert.equal(verified.status, 200);
  const verifiedUser = await prisma.user.findUnique({ where: { id: user.id }, select: { emailVerifiedAt: true, phoneVerifiedAt: true } });
  assert.ok(verifiedUser.emailVerifiedAt);
  assert.ok(verifiedUser.phoneVerifiedAt);
  assert.equal(await prisma.patient.count({ where: { userId: user.id } }), 1);
});

test('unknown, expired, and consumed capabilities are rejected without persistence', async () => {
  const unknown = await request(app).post('/api/patient-auth/google/complete').send(payload(generateOnboardingCapability()));
  assert.equal(unknown.status, 422);
  assert.equal(unknown.body.error.code, 'GOOGLE_ONBOARDING_INVALID');

  const expired = await createPending();
  await prisma.pendingExternalAuth.update({ where: { id: expired.pending.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const expiredResponse = await request(app).post('/api/patient-auth/google/complete').send(payload(expired.token));
  assert.equal(expiredResponse.status, 422);
  assert.equal(expiredResponse.body.error.code, 'GOOGLE_ONBOARDING_INVALID');

  const consumed = await createPending();
  await prisma.pendingExternalAuth.update({ where: { id: consumed.pending.id }, data: { consumedAt: new Date() } });
  const consumedResponse = await request(app).post('/api/patient-auth/google/complete').send(payload(consumed.token));
  assert.equal(consumedResponse.status, 422);
  assert.equal(consumedResponse.body.error.code, 'GOOGLE_ONBOARDING_INVALID');
});

test('valid completion creates only the pending patient account state and links Google atomically', async () => {
  const { pending, token } = await createPending({ verifiedEmail: `${randomUUID()}@example.invalid` });
  const response = await request(app).post('/api/patient-auth/google/complete').send(payload(token));
  assert.equal(response.status, 201);
  assert.equal(response.body.state, 'VERIFICATION_REQUIRED');
  assert.ok(response.body.challengeId);
  assert.ok(response.body.developmentCode);
  assert.equal(response.body.onboardingToken, undefined);
  assert.equal(response.body.capabilityHash, undefined);
  assert.equal(response.body.providerSubject, undefined);

  const user = await prisma.user.findUnique({ where: { email: pending.verifiedEmail }, include: { pendingPatientRegistration: true, externalIdentities: true } });
  createdUsers.push(user.id);
  assert.equal(user.role, 'PATIENT');
  assert.equal(user.status, 'PENDING_VERIFICATION');
  assert.ok(user.emailVerifiedAt);
  assert.equal(user.phoneVerifiedAt, null);
  assert.notEqual(user.passwordHash, 'ValidPass1!');
  assert.equal(user.externalIdentities.length, 1);
  assert.equal(user.externalIdentities[0].provider, 'GOOGLE');
  assert.equal(user.externalIdentities[0].providerSubject, pending.providerSubject);
  assert.equal(user.pendingPatientRegistration.userId, user.id);
  assert.equal(await prisma.patient.count({ where: { userId: user.id } }), 0);
  const challenge = await prisma.verificationChallenge.findUnique({ where: { id: response.body.challengeId } });
  assert.equal(challenge.type, 'REGISTRATION_PHONE');
  assert.equal(challenge.targetNormalized, user.phoneNormalized);
  assert.equal((await prisma.pendingExternalAuth.findUnique({ where: { id: pending.id } })).consumedAt !== null, true);

  const previousProvider = process.env.VERIFICATION_PROVIDER;
  process.env.VERIFICATION_PROVIDER = 'email';
  let verified;
  try {
    verified = await request(app).post('/api/patient-auth/verify').send({ challengeId: response.body.challengeId, code: response.body.developmentCode });
  } finally {
    if (previousProvider === undefined) delete process.env.VERIFICATION_PROVIDER;
    else process.env.VERIFICATION_PROVIDER = previousProvider;
  }
  assert.equal(verified.status, 200);
  const verifiedUser = await prisma.user.findUnique({ where: { id: user.id }, select: { emailVerifiedAt: true, phoneVerifiedAt: true } });
  assert.ok(verifiedUser.emailVerifiedAt);
  assert.ok(verifiedUser.phoneVerifiedAt);
  assert.equal(await prisma.patient.count({ where: { userId: user.id } }), 1);
});

test('completion replay is rejected and does not create duplicates', async () => {
  const { token } = await createPending();
  const first = await request(app).post('/api/patient-auth/google/complete').send(payload(token));
  assert.equal(first.status, 201);
  const replay = await request(app).post('/api/patient-auth/google/complete').send(payload(token));
  assert.equal(replay.status, 422);
  assert.equal(replay.body.error.code, 'GOOGLE_ONBOARDING_INVALID');
  const pending = await prisma.pendingExternalAuth.findUnique({ where: { capabilityHash: hashOnboardingCapability(token) }, select: { consumedAt: true } });
  assert.ok(pending?.consumedAt);
});

test('changed account state blocks completion without creating a patient account', async () => {
  const pending = await createPending();
  const user = await createUser({ email: pending.pending.verifiedEmail });
  const before = await prisma.patientRegistration.count();
  const response = await request(app).post('/api/patient-auth/google/complete').send(payload(pending.token));
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'ACCOUNT_LINK_REQUIRED');
  assert.equal(await prisma.patientRegistration.count(), before);
  assert.equal((await prisma.pendingExternalAuth.findUnique({ where: { id: pending.pending.id } })).consumedAt, null);
  assert.equal(user.role, 'PATIENT');
});

test('pending registration and staff collisions are controlled and generic', async () => {
  const pending = await createPending();
  const user = await createUser({ email: pending.pending.verifiedEmail, status: 'PENDING_VERIFICATION' });
  await prisma.patientRegistration.create({ data: {
    userId: user.id, fullNameAr: 'اختبار', fullNameEn: 'Pending Patient', gender: 'MALE', dateOfBirth: '1990-01-01', addressStateId: 1
  } });
  const pendingResponse = await request(app).post('/api/patient-auth/google/complete').send(payload(pending.token));
  assert.equal(pendingResponse.status, 409);
  assert.equal(pendingResponse.body.error.code, 'REGISTRATION_PENDING');

  const staffPending = await createPending();
  await createUser({ email: staffPending.pending.verifiedEmail, role: 'DOCTOR' });
  const staffResponse = await request(app).post('/api/patient-auth/google/complete').send(payload(staffPending.token));
  assert.equal(staffResponse.status, 409);
  assert.equal(staffResponse.body.error.code, 'GOOGLE_SIGN_IN_CONFLICT');
  assert.doesNotMatch(JSON.stringify(staffResponse.body), /DOCTOR|ADMIN|role/i);
});

test('two concurrent completions yield one account and one usable verification workflow', async () => {
  const pending = await createPending();
  const responses = await Promise.all([
    request(app).post('/api/patient-auth/google/complete').send(payload(pending.token)),
    request(app).post('/api/patient-auth/google/complete').send(payload(pending.token))
  ]);
  assert.equal(responses.filter((response) => response.status === 201).length, 1);
  assert.equal(responses.filter((response) => [409, 422].includes(response.status)).length, 1);
  const user = await prisma.user.findUnique({ where: { email: pending.pending.verifiedEmail }, select: { id: true } });
  createdUsers.push(user.id);
  assert.equal(await prisma.user.count({ where: { email: pending.pending.verifiedEmail } }), 1);
  assert.equal(await prisma.patientRegistration.count({ where: { userId: user.id } }), 1);
  assert.equal(await prisma.userExternalIdentity.count({ where: { userId: user.id } }), 1);
  assert.equal(await prisma.verificationChallenge.count({ where: { userId: user.id, type: 'REGISTRATION_PHONE' } }), 1);
  assert.equal(await prisma.patient.count({ where: { userId: user.id } }), 0);
});

test('disabled phone delivery fails before any Google onboarding writes', async () => {
  const { pending, token } = await createPending();
  const beforeRegistrations = await prisma.patientRegistration.count();
  const previous = process.env.PHONE_VERIFICATION_PROVIDER;
  process.env.PHONE_VERIFICATION_PROVIDER = 'disabled';
  try {
    const response = await request(app).post('/api/patient-auth/google/complete').send(payload(token));
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, 'VERIFICATION_UNAVAILABLE');
  } finally {
    if (previous === undefined) delete process.env.PHONE_VERIFICATION_PROVIDER;
    else process.env.PHONE_VERIFICATION_PROVIDER = previous;
  }
  assert.equal(await prisma.user.count({ where: { email: pending.verifiedEmail } }), 0);
  assert.equal(await prisma.patientRegistration.count(), beforeRegistrations);
  const state = await prisma.pendingExternalAuth.findUnique({ where: { id: pending.id }, select: { consumedAt: true } });
  assert.equal(state.consumedAt, null);
});
