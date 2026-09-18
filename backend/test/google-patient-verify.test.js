import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import prisma from '../src/db.js';
import { app, shutdown } from '../src/server.js';
import { resolveGooglePatientIdentity } from '../src/services/googlePatientIdentity.js';
import { generateOnboardingCapability, hashOnboardingCapability, lookupPendingExternalAuthCapability } from '../src/services/externalAuthCapability.js';
import { verifyAccessToken } from '../src/services/accessTokens.js';

const createdUsers = [];
const createdPending = [];
const createdIdentities = [];
const createdPatientRegistrations = [];

after(async () => {
  if (createdPending.length) await prisma.pendingExternalAuth.deleteMany({ where: { id: { in: createdPending } } });
  if (createdIdentities.length) await prisma.userExternalIdentity.deleteMany({ where: { id: { in: createdIdentities } } });
  if (createdPatientRegistrations.length) await prisma.patientRegistration.deleteMany({ where: { userId: { in: createdPatientRegistrations } } });
  if (createdUsers.length) await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await shutdown('google-patient-verify-test');
});

function trustedIdentity(overrides = {}) {
  return { provider: 'GOOGLE', providerSubject: `google-${randomUUID()}`, email: `${randomUUID()}@example.invalid`, ...overrides };
}

function verifierFor(identity) {
  return async (credential) => {
    assert.equal(credential, 'mock-google-credential');
    return identity;
  };
}

async function createUser({ role = 'PATIENT', status = 'ACTIVE', email = `${randomUUID()}@example.invalid` } = {}) {
  const user = await prisma.user.create({
    data: {
      username: email,
      email,
      passwordHash: `test-only-${randomUUID()}`,
      role,
      status
    }
  });
  createdUsers.push(user.id);
  return user;
}

async function createLinkedPatient(identity, options = {}) {
  const user = await createUser({ role: 'PATIENT', ...options });
  const linked = await prisma.userExternalIdentity.create({
    data: { userId: user.id, provider: 'GOOGLE', providerSubject: identity.providerSubject, normalizedEmailAtLink: options.linkedEmail || identity.email }
  });
  createdIdentities.push(linked.id);
  return user;
}

async function resolve(identity, options = {}) {
  return resolveGooglePatientIdentity({ credential: 'mock-google-credential', verifyCredential: verifierFor(identity), ...options });
}

test('Google endpoint strictly validates the minimal credential body and keeps Google unavailable controlled', async () => {
  const malformed = await request(app).post('/api/patient-auth/google/verify').send({ credential: 'x', role: 'ADMIN' });
  assert.equal(malformed.status, 422);
  assert.equal(malformed.body.error.code, 'VALIDATION_ERROR');

  const unavailable = await request(app).post('/api/patient-auth/google/verify').send({ credential: 'mock-google-credential' });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.error.code, 'GOOGLE_AUTH_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(unavailable.body), /mock-google-credential|google-auth-library|stack/i);
});

test('linked eligible patient authenticates by provider subject and tolerates Google email drift', async () => {
  const identity = trustedIdentity({ email: 'new-email@example.invalid' });
  const user = await createLinkedPatient(identity, { linkedEmail: 'old-email@example.invalid' });
  const result = await resolve(identity, { db: prisma });

  assert.equal(result.status, 'AUTHENTICATED');
  assert.equal(result.user.id, user.id);
  assert.equal(result.user.role, 'PATIENT');
  assert.equal(verifyAccessToken(result.token).sub, user.id);
  assert.equal((await prisma.user.findUnique({ where: { id: user.id }, select: { email: true } })).email, user.email);
  assert.equal(await prisma.userExternalIdentity.count({ where: { userId: user.id } }), 1);
});

test('linked non-patient and ineligible patient identities fail closed without JWTs', async () => {
  const staffIdentity = trustedIdentity();
  await createLinkedPatient(staffIdentity, { role: 'ADMIN' });
  await assert.rejects(resolve(staffIdentity), { code: 'GOOGLE_SIGN_IN_UNAVAILABLE', status: 403 });

  const inactiveIdentity = trustedIdentity();
  await createLinkedPatient(inactiveIdentity, { status: 'INACTIVE' });
  await assert.rejects(resolve(inactiveIdentity), { code: 'GOOGLE_SIGN_IN_UNAVAILABLE', status: 403 });
});

test('resolver fails closed when the verifier does not return a complete trusted identity', async () => {
  await assert.rejects(
    () => resolveGooglePatientIdentity({ credential: 'mock-google-credential', verifyCredential: async () => ({ provider: 'GOOGLE', email: 'missing-sub@example.invalid' }) }),
    { code: 'GOOGLE_CREDENTIAL_INVALID', status: 401 }
  );
  await assert.rejects(
    () => resolveGooglePatientIdentity({ credential: 'mock-google-credential', verifyCredential: async () => ({ provider: 'OTHER', providerSubject: 'attacker', email: 'attacker@example.invalid' }) }),
    { code: 'GOOGLE_CREDENTIAL_INVALID', status: 401 }
  );
});

test('new Google identity creates only one pending state with a 256-bit opaque capability', async () => {
  const identity = trustedIdentity();
  const before = await Promise.all([
    prisma.user.count(), prisma.patient.count(), prisma.patientRegistration.count()
  ]);
  const result = await resolve(identity);
  assert.equal(result.status, 'ONBOARDING_REQUIRED');
  assert.match(result.onboardingToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.onboardingToken.length, 43);

  const pending = await prisma.pendingExternalAuth.findUnique({ where: { provider_providerSubject: { provider: 'GOOGLE', providerSubject: identity.providerSubject } } });
  createdPending.push(pending.id);
  assert.equal(pending.capabilityHash, hashOnboardingCapability(result.onboardingToken));
  assert.match(pending.capabilityHash, /^[0-9a-f]{64}$/);
  const lookedUp = await lookupPendingExternalAuthCapability(result.onboardingToken);
  assert.equal(lookedUp.id, pending.id);
  assert.deepEqual(await Promise.all([
    prisma.user.count(), prisma.patient.count(), prisma.patientRegistration.count()
  ]), before);
});

test('reverification rotates the single pending capability and invalidates the old token', async () => {
  const identity = trustedIdentity();
  const first = await resolve(identity);
  const pending = await prisma.pendingExternalAuth.findUnique({ where: { provider_providerSubject: { provider: 'GOOGLE', providerSubject: identity.providerSubject } } });
  createdPending.push(pending.id);
  const second = await resolve(identity);
  assert.equal(second.status, 'ONBOARDING_REQUIRED');
  assert.notEqual(second.onboardingToken, first.onboardingToken);
  assert.equal(await lookupPendingExternalAuthCapability(first.onboardingToken), null);
  const current = await lookupPendingExternalAuthCapability(second.onboardingToken);
  assert.equal(current.id, pending.id);
  assert.equal(current.consumedAt, null);
  assert.ok(current.expiresAt > new Date());
});

test('existing active patient email requires explicit linking and performs no writes', async () => {
  const identity = trustedIdentity();
  const user = await createUser({ email: identity.email });
  const before = await prisma.userExternalIdentity.count();
  await assert.doesNotReject(async () => {
    const result = await resolve(identity);
    assert.deepEqual(result, { status: 'ACCOUNT_LINK_REQUIRED' });
  });
  assert.equal(await prisma.userExternalIdentity.count(), before);
  assert.equal((await prisma.user.findUnique({ where: { id: user.id }, select: { role: true } })).role, 'PATIENT');
});

test('pending patient registration returns registration-pending without creating Google state', async () => {
  const identity = trustedIdentity();
  const user = await createUser({ status: 'PENDING_VERIFICATION', email: identity.email });
  await prisma.patientRegistration.create({
    data: {
      userId: user.id, fullNameAr: 'اختبار', fullNameEn: 'Pending Patient',
      firstNameAr: 'اختبار', fatherNameAr: 'أب', grandfatherNameAr: 'جد', familyNameAr: 'عائلة',
      firstNameEn: 'Pending', fatherNameEn: 'Patient', grandfatherNameEn: 'Example', familyNameEn: 'Test',
      gender: 'MALE', dateOfBirth: '1990-01-01', addressStateId: 1
    }
  });
  createdPatientRegistrations.push(user.id);
  const before = await prisma.pendingExternalAuth.count();
  assert.deepEqual(await resolve(identity), { status: 'REGISTRATION_PENDING' });
  assert.equal(await prisma.pendingExternalAuth.count(), before);
});

test('staff email collision is generic and does not reveal role or create state', async () => {
  const identity = trustedIdentity();
  await createUser({ role: 'DOCTOR', email: identity.email });
  const before = await prisma.pendingExternalAuth.count();
  await assert.rejects(resolve(identity), { code: 'GOOGLE_SIGN_IN_CONFLICT', status: 409 });
  assert.equal(await prisma.pendingExternalAuth.count(), before);
});

test('ambiguous duplicate email ownership fails closed without creating pending state', async () => {
  const identity = trustedIdentity();
  await createUser({ email: identity.email });
  await createUser({ email: `${randomUUID()}@example.invalid` });
  // Simulate a legacy duplicate username/email ambiguity without relying on a
  // uniqueness violation in the current schema by injecting the resolver DB.
  const ambiguousDb = {
    userExternalIdentity: prisma.userExternalIdentity,
    user: { findMany: async () => [{ id: 'one', role: 'PATIENT', status: 'ACTIVE' }, { id: 'two', role: 'PATIENT', status: 'ACTIVE' }] }
  };
  await assert.rejects(resolve(identity, { db: ambiguousDb }), { code: 'GOOGLE_SIGN_IN_CONFLICT', status: 409 });
});

test('concurrent new-identity verification has one winner and one controlled loser', async () => {
  const identity = trustedIdentity();
  let entered;
  const firstEntered = new Promise((resolveEntered) => { entered = resolveEntered; });
  let release;
  const releaseFirst = new Promise((resolveRelease) => { release = resolveRelease; });
  const first = resolve(identity, { onPendingLockAcquired: async () => { entered(); await releaseFirst; } });
  await firstEntered;
  const second = resolve(identity);
  const firstSettled = first.then((value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason }));
  const secondSettled = second.then((value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason }));
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  release();
  const secondResult = await Promise.all([firstSettled, secondSettled]);
  const fulfilled = secondResult.filter((result) => result.status === 'fulfilled');
  const rejected = secondResult.filter((result) => result.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, 'GOOGLE_ONBOARDING_BUSY');
  const pendingRows = await prisma.pendingExternalAuth.findMany({ where: { provider: 'GOOGLE', providerSubject: identity.providerSubject } });
  assert.equal(pendingRows.length, 1);
  createdPending.push(pendingRows[0].id);
  assert.equal((await lookupPendingExternalAuthCapability(fulfilled[0].value.onboardingToken)).id, pendingRows[0].id);
});

test('capability helpers reject malformed values without exposing stored secrets', () => {
  const raw = generateOnboardingCapability();
  assert.match(raw, /^[A-Za-z0-9_-]{43}$/);
  assert.match(hashOnboardingCapability(raw), /^[0-9a-f]{64}$/);
  assert.throws(() => hashOnboardingCapability('not-a-capability'), { code: 'ONBOARDING_CAPABILITY_INVALID' });
});
