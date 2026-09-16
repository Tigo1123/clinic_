import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../src/db.js';

const createdUsers = [];
const createdPending = [];
const provider = 'google';
const capabilityHash = (character) => character.repeat(64);

async function createUser() {
  const id = randomUUID();
  const user = await prisma.user.create({
    data: {
      username: `${id}@example.invalid`,
      email: `${id}@example.invalid`,
      passwordHash: `test-only-${id}`,
      role: 'PATIENT'
    }
  });
  createdUsers.push(user.id);
  return user;
}

after(async () => {
  if (createdPending.length) await prisma.pendingExternalAuth.deleteMany({ where: { id: { in: createdPending } } });
  if (createdUsers.length) await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

test('external identities link to users and enforce provider uniqueness', async () => {
  const first = await createUser();
  const second = await createUser();
  const identity = await prisma.userExternalIdentity.create({
    data: { userId: first.id, provider, providerSubject: `subject-${randomUUID()}`, normalizedEmailAtLink: first.email }
  });

  assert.equal((await prisma.userExternalIdentity.findUnique({ where: { id: identity.id } })).userId, first.id);
  await assert.rejects(
    prisma.userExternalIdentity.create({ data: { userId: second.id, provider, providerSubject: identity.providerSubject, normalizedEmailAtLink: second.email } }),
    { code: 'P2002' }
  );
  await assert.rejects(
    prisma.userExternalIdentity.create({ data: { userId: first.id, provider, providerSubject: `other-${randomUUID()}`, normalizedEmailAtLink: first.email } }),
    { code: 'P2002' }
  );
});

test('different users can link different identities from the same provider', async () => {
  const first = await createUser();
  const second = await createUser();
  const subjects = [randomUUID(), randomUUID()];
  await prisma.userExternalIdentity.createMany({
    data: [first, second].map((user, index) => ({ userId: user.id, provider, providerSubject: `subject-${subjects[index]}`, normalizedEmailAtLink: user.email }))
  });
  assert.equal(await prisma.userExternalIdentity.count({ where: { provider, providerSubject: { in: subjects.map((subject) => `subject-${subject}`) } } }), 2);
});

test('pending external auth has no User or Patient and supports expiry/consumption lifecycle', async () => {
  const providerSubject = `pending-${randomUUID()}`;
  const verifiedEmail = `${randomUUID()}@example.invalid`;
  const firstCapabilityHash = capabilityHash('a');
  const pending = await prisma.pendingExternalAuth.create({
    data: { provider, providerSubject, verifiedEmail, capabilityHash: firstCapabilityHash, expiresAt: new Date(Date.now() + 10 * 60 * 1000) }
  });
  createdPending.push(pending.id);

  assert.equal(await prisma.user.count({ where: { email: verifiedEmail } }), 0);
  // PendingExternalAuth has no User/Patient relation by design; creation above
  // cannot create either medical/account record.
  assert.equal(pending.consumedAt, null);
  assert.equal(pending.capabilityHash, firstCapabilityHash);
  assert.ok(pending.expiresAt > new Date());

  const rotatedCapabilityHash = capabilityHash('b');
  const rotated = await prisma.pendingExternalAuth.update({ where: { id: pending.id }, data: { capabilityHash: rotatedCapabilityHash } });
  assert.equal(rotated.capabilityHash, rotatedCapabilityHash);
  assert.equal(await prisma.pendingExternalAuth.count({ where: { capabilityHash: firstCapabilityHash } }), 0);
  assert.equal(await prisma.pendingExternalAuth.count({ where: { capabilityHash: rotatedCapabilityHash } }), 1);

  const consumed = await prisma.pendingExternalAuth.update({ where: { id: pending.id }, data: { consumedAt: new Date(), expiresAt: new Date(Date.now() - 1000) } });
  assert.ok(consumed.consumedAt);
  assert.ok(consumed.expiresAt < new Date());
  await assert.rejects(
    prisma.pendingExternalAuth.create({ data: { provider, providerSubject, verifiedEmail, capabilityHash: capabilityHash('c'), expiresAt: new Date(Date.now() + 600000) } }),
    { code: 'P2002' }
  );

  await assert.rejects(
    prisma.pendingExternalAuth.create({ data: { provider, providerSubject: `other-${randomUUID()}`, verifiedEmail: `${randomUUID()}@example.invalid`, capabilityHash: rotatedCapabilityHash, expiresAt: new Date(Date.now() + 600000) } }),
    { code: 'P2002' }
  );

  const concurrentSubject = `concurrent-${randomUUID()}`;
  const concurrent = await Promise.allSettled(Array.from({ length: 2 }, () => prisma.pendingExternalAuth.create({
    data: { provider, providerSubject: concurrentSubject, verifiedEmail: `${randomUUID()}@example.invalid`, capabilityHash: capabilityHash(randomUUID().replace(/-/g, '').slice(0, 1)), expiresAt: new Date(Date.now() + 600000) }
  })));
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
  const concurrentRow = await prisma.pendingExternalAuth.findUnique({ where: { provider_providerSubject: { provider, providerSubject: concurrentSubject } } });
  if (concurrentRow) createdPending.push(concurrentRow.id);
});

test('deleting a User cascades its external identities', async () => {
  const user = await createUser();
  const identity = await prisma.userExternalIdentity.create({
    data: { userId: user.id, provider, providerSubject: `delete-${randomUUID()}`, normalizedEmailAtLink: user.email }
  });
  await prisma.user.delete({ where: { id: user.id } });
  assert.equal(await prisma.userExternalIdentity.count({ where: { id: identity.id } }), 0);
  createdUsers.splice(createdUsers.indexOf(user.id), 1);
});
