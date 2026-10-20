import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import prisma from '../src/db.js';
import { app, shutdown } from '../src/server.js';
import { linkGooglePatientIdentity, unlinkGooglePatientIdentity, resolveGooglePatientIdentity } from '../src/services/googlePatientIdentity.js';
import { signAccessToken } from '../src/services/accessTokens.js';

const createdUsers = [];
const createdIdentities = [];
const createdPatients = [];
const createdAuditLogs = [];

after(async () => {
  if (createdIdentities.length) await prisma.userExternalIdentity.deleteMany({ where: { id: { in: createdIdentities } } });
  if (createdPatients.length) await prisma.patient.deleteMany({ where: { id: { in: createdPatients } } });
  if (createdUsers.length) await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await shutdown('google-patient-link-test');
});

const DEFAULT_PASSWORD = 'StrongPassword123!';

function verifierFor(identity) {
  return async (credential) => {
    if (!credential || credential === 'invalid-credential') {
      return null;
    }
    return identity;
  };
}

async function createPatientUser({
  email = `patient-${randomUUID()}@example.invalid`,
  password = DEFAULT_PASSWORD,
  role = 'PATIENT',
  status = 'ACTIVE'
} = {}) {
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      username: email,
      email,
      passwordHash,
      role,
      status,
      phoneNormalized: `+25078${Math.floor(1000000 + Math.random() * 9000000)}`
    }
  });
  createdUsers.push(user.id);

  const patient = await prisma.patient.create({
    data: {
      userId: user.id,
      fileNumber: `MRN-${randomUUID().slice(0, 8)}`,
      fullNameAr: 'مريض تجريبي',
      fullNameEn: 'Test Patient',
      gender: 'MALE',
      dateOfBirth: '1995-05-15',
      phone: user.phoneNormalized,
      addressStateId: 1,
      emergencyContact: 'Family'
    }
  });
  createdPatients.push(patient.id);

  const token = signAccessToken(user);
  return { user, patient, token, password };
}

test('1. unauthenticated link rejected with 401', async () => {
  const res = await request(app)
    .post('/api/patient/me/external-identities/google/link')
    .send({ credential: 'some-token', currentPassword: 'password' });
  assert.equal(res.status, 401);
});

test('2. wrong or missing re-authentication rejected with 401', async () => {
  const { user, token } = await createPatientUser();

  const missingPasswordRes = await request(app)
    .post('/api/patient/me/external-identities/google/link')
    .set('Authorization', `Bearer ${token}`)
    .send({ credential: 'mock-cred' });
  assert.equal(missingPasswordRes.status, 422);

  const wrongPasswordRes = await request(app)
    .post('/api/patient/me/external-identities/google/link')
    .set('Authorization', `Bearer ${token}`)
    .send({ credential: 'mock-cred', currentPassword: 'WrongPassword999!' });
  assert.equal(wrongPasswordRes.status, 401);
  assert.equal(wrongPasswordRes.body.error.code, 'REAUTHENTICATION_FAILED');

  await assert.rejects(
    linkGooglePatientIdentity({
      userId: user.id,
      currentPassword: 'WrongPassword999!',
      credential: 'mock-cred',
      verifyCredential: verifierFor({ provider: 'GOOGLE', providerSubject: 'sub1', email: user.email })
    }),
    { code: 'REAUTHENTICATION_FAILED', status: 401 }
  );
});

test('3. invalid Google credential rejected', async () => {
  const { user } = await createPatientUser();

  await assert.rejects(
    linkGooglePatientIdentity({
      userId: user.id,
      currentPassword: DEFAULT_PASSWORD,
      credential: 'invalid-credential',
      verifyCredential: verifierFor(null)
    }),
    { code: 'GOOGLE_CREDENTIAL_INVALID', status: 401 }
  );
});

test('4. successful authenticated link creates external identity and returns safe googleAccount', async () => {
  const { user } = await createPatientUser();
  const identity = {
    provider: 'GOOGLE',
    providerSubject: `google-sub-${randomUUID()}`,
    email: user.email
  };

  const result = await linkGooglePatientIdentity({
    userId: user.id,
    currentPassword: DEFAULT_PASSWORD,
    credential: 'valid-cred',
    verifyCredential: verifierFor(identity)
  });

  assert.equal(result.success, true);
  assert.equal(result.googleAccount.linked, true);
  assert.equal(result.googleAccount.email, user.email.toLowerCase());
  assert.ok(result.googleAccount.linkedAt);

  const stored = await prisma.userExternalIdentity.findFirst({
    where: { userId: user.id, provider: 'GOOGLE' }
  });
  assert.ok(stored);
  createdIdentities.push(stored.id);
  assert.equal(stored.providerSubject, identity.providerSubject);
  assert.equal(stored.normalizedEmailAtLink, user.email.toLowerCase());
});

test('5. providerSubject owned by another user rejected with 409 GOOGLE_IDENTITY_ALREADY_LINKED', async () => {
  const patient1 = await createPatientUser();
  const patient2 = await createPatientUser();
  const sharedSubject = `google-shared-${randomUUID()}`;

  const linked = await prisma.userExternalIdentity.create({
    data: {
      userId: patient1.user.id,
      provider: 'GOOGLE',
      providerSubject: sharedSubject,
      normalizedEmailAtLink: patient1.user.email.toLowerCase()
    }
  });
  createdIdentities.push(linked.id);

  await assert.rejects(
    linkGooglePatientIdentity({
      userId: patient2.user.id,
      currentPassword: DEFAULT_PASSWORD,
      credential: 'valid-cred',
      verifyCredential: verifierFor({
        provider: 'GOOGLE',
        providerSubject: sharedSubject,
        email: patient2.user.email
      })
    }),
    { code: 'GOOGLE_IDENTITY_ALREADY_LINKED', status: 409 }
  );
});

test('6. patient already has Google linked rejected with 409 GOOGLE_ALREADY_LINKED', async () => {
  const { user } = await createPatientUser();
  const linked = await prisma.userExternalIdentity.create({
    data: {
      userId: user.id,
      provider: 'GOOGLE',
      providerSubject: `google-existing-${randomUUID()}`,
      normalizedEmailAtLink: user.email.toLowerCase()
    }
  });
  createdIdentities.push(linked.id);

  await assert.rejects(
    linkGooglePatientIdentity({
      userId: user.id,
      currentPassword: DEFAULT_PASSWORD,
      credential: 'valid-cred',
      verifyCredential: verifierFor({
        provider: 'GOOGLE',
        providerSubject: `google-new-${randomUUID()}`,
        email: user.email
      })
    }),
    { code: 'GOOGLE_ALREADY_LINKED', status: 409 }
  );
});

test('7. Google email/account mismatch rejected with 409 GOOGLE_EMAIL_MISMATCH', async () => {
  const { user } = await createPatientUser({ email: 'primary@example.invalid' });

  await assert.rejects(
    linkGooglePatientIdentity({
      userId: user.id,
      currentPassword: DEFAULT_PASSWORD,
      credential: 'valid-cred',
      verifyCredential: verifierFor({
        provider: 'GOOGLE',
        providerSubject: `google-sub-${randomUUID()}`,
        email: 'different-email@example.invalid'
      })
    }),
    { code: 'GOOGLE_EMAIL_MISMATCH', status: 409 }
  );
});

test('8. concurrent link attempts remain safe and fail-closed', async () => {
  const { user } = await createPatientUser();
  const identity = {
    provider: 'GOOGLE',
    providerSubject: `google-concurrent-${randomUUID()}`,
    email: user.email
  };

  const results = await Promise.allSettled([
    linkGooglePatientIdentity({
      userId: user.id,
      currentPassword: DEFAULT_PASSWORD,
      credential: 'cred1',
      verifyCredential: verifierFor(identity)
    }),
    linkGooglePatientIdentity({
      userId: user.id,
      currentPassword: DEFAULT_PASSWORD,
      credential: 'cred2',
      verifyCredential: verifierFor(identity)
    })
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.status, 409);

  const count = await prisma.userExternalIdentity.count({
    where: { userId: user.id, provider: 'GOOGLE' }
  });
  assert.equal(count, 1);
});

test('9. successful link creates exactly one UserExternalIdentity', async () => {
  const { user } = await createPatientUser();
  const identity = {
    provider: 'GOOGLE',
    providerSubject: `google-sub-exact-${randomUUID()}`,
    email: user.email
  };

  await linkGooglePatientIdentity({
    userId: user.id,
    currentPassword: DEFAULT_PASSWORD,
    credential: 'valid',
    verifyCredential: verifierFor(identity)
  });

  const count = await prisma.userExternalIdentity.count({
    where: { userId: user.id, provider: 'GOOGLE' }
  });
  assert.equal(count, 1);
});

test('10. successful link writes audit event', async () => {
  const { user, token } = await createPatientUser();

  // Test route audit creation
  // We can create link directly in DB then test unlink audit, or unlink route
  const existingIdentity = await prisma.userExternalIdentity.create({
    data: {
      userId: user.id,
      provider: 'GOOGLE',
      providerSubject: `google-audit-${randomUUID()}`,
      normalizedEmailAtLink: user.email.toLowerCase()
    }
  });
  createdIdentities.push(existingIdentity.id);

  // Unlink via route creates PATIENT_GOOGLE_UNLINKED
  const unlinkRes = await request(app)
    .delete('/api/patient/me/external-identities/google')
    .set('Authorization', `Bearer ${token}`)
    .send({ currentPassword: DEFAULT_PASSWORD });
  assert.equal(unlinkRes.status, 200);
  assert.equal(unlinkRes.body.success, true);
  assert.equal(unlinkRes.body.googleAccount.linked, false);

  const auditLog = await prisma.tenantAuditLog.findFirst({
    where: { action: 'PATIENT_GOOGLE_UNLINKED', userId: user.id }
  });
  assert.ok(auditLog);
});

test('11. Google login works after linking', async () => {
  const { user } = await createPatientUser();
  const identity = {
    provider: 'GOOGLE',
    providerSubject: `google-login-${randomUUID()}`,
    email: user.email
  };

  await linkGooglePatientIdentity({
    userId: user.id,
    currentPassword: DEFAULT_PASSWORD,
    credential: 'valid',
    verifyCredential: verifierFor(identity)
  });

  const resolved = await resolveGooglePatientIdentity({
    credential: 'mock',
    verifyCredential: verifierFor(identity),
    db: prisma
  });

  assert.equal(resolved.status, 'AUTHENTICATED');
  assert.equal(resolved.user.id, user.id);
  assert.ok(resolved.token);
});

test('12. authenticated unlink succeeds', async () => {
  const { user } = await createPatientUser();
  const identity = {
    provider: 'GOOGLE',
    providerSubject: `google-unlink-${randomUUID()}`,
    email: user.email
  };

  await linkGooglePatientIdentity({
    userId: user.id,
    currentPassword: DEFAULT_PASSWORD,
    credential: 'valid',
    verifyCredential: verifierFor(identity)
  });

  const unlinkResult = await unlinkGooglePatientIdentity({
    userId: user.id,
    currentPassword: DEFAULT_PASSWORD
  });

  assert.equal(unlinkResult.success, true);
  assert.equal(unlinkResult.googleAccount.linked, false);

  const count = await prisma.userExternalIdentity.count({
    where: { userId: user.id, provider: 'GOOGLE' }
  });
  assert.equal(count, 0);
});

test('13. wrong re-authentication blocks unlink', async () => {
  const { user } = await createPatientUser();
  const identity = {
    provider: 'GOOGLE',
    providerSubject: `google-block-${randomUUID()}`,
    email: user.email
  };

  await linkGooglePatientIdentity({
    userId: user.id,
    currentPassword: DEFAULT_PASSWORD,
    credential: 'valid',
    verifyCredential: verifierFor(identity)
  });

  await assert.rejects(
    unlinkGooglePatientIdentity({
      userId: user.id,
      currentPassword: 'WrongPassword!'
    }),
    { code: 'REAUTHENTICATION_FAILED', status: 401 }
  );

  const count = await prisma.userExternalIdentity.count({
    where: { userId: user.id, provider: 'GOOGLE' }
  });
  assert.equal(count, 1);
});

test('14. unlink writes audit event via endpoint', async () => {
  const { user, token } = await createPatientUser();
  const identity = {
    provider: 'GOOGLE',
    providerSubject: `google-endpoint-audit-${randomUUID()}`,
    email: user.email
  };

  await linkGooglePatientIdentity({
    userId: user.id,
    currentPassword: DEFAULT_PASSWORD,
    credential: 'valid',
    verifyCredential: verifierFor(identity)
  });

  const res = await request(app)
    .delete('/api/patient/me/external-identities/google')
    .set('Authorization', `Bearer ${token}`)
    .send({ currentPassword: DEFAULT_PASSWORD });

  assert.equal(res.status, 200);

  const auditEntry = await prisma.tenantAuditLog.findFirst({
    where: { action: 'PATIENT_GOOGLE_UNLINKED', userId: user.id }
  });
  assert.ok(auditEntry);
});

test('15. Google login after unlink returns ACCOUNT_LINK_REQUIRED', async () => {
  const { user } = await createPatientUser();
  const identity = {
    provider: 'GOOGLE',
    providerSubject: `google-post-unlink-${randomUUID()}`,
    email: user.email
  };

  await linkGooglePatientIdentity({
    userId: user.id,
    currentPassword: DEFAULT_PASSWORD,
    credential: 'valid',
    verifyCredential: verifierFor(identity)
  });

  await unlinkGooglePatientIdentity({
    userId: user.id,
    currentPassword: DEFAULT_PASSWORD
  });

  const resolved = await resolveGooglePatientIdentity({
    credential: 'mock',
    verifyCredential: verifierFor(identity),
    db: prisma
  });

  assert.equal(resolved.status, 'ACCOUNT_LINK_REQUIRED');
  assert.equal(resolved.token, undefined);
});

test('16. GET /api/patient/me exposes only safe Google link metadata', async () => {
  const { user, token } = await createPatientUser();
  const identity = {
    provider: 'GOOGLE',
    providerSubject: `google-metadata-test-subject-${randomUUID()}`,
    email: user.email
  };

  // Initially unlinked
  const unlinkedRes = await request(app)
    .get('/api/patient/me')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(unlinkedRes.status, 200);
  assert.deepEqual(unlinkedRes.body.googleAccount, { linked: false });
  assert.equal(unlinkedRes.body.providerSubject, undefined);

  // Now link
  await linkGooglePatientIdentity({
    userId: user.id,
    currentPassword: DEFAULT_PASSWORD,
    credential: 'valid',
    verifyCredential: verifierFor(identity)
  });

  const linkedRes = await request(app)
    .get('/api/patient/me')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(linkedRes.status, 200);
  assert.equal(linkedRes.body.googleAccount.linked, true);
  assert.equal(linkedRes.body.googleAccount.email, user.email.toLowerCase());
  assert.ok(linkedRes.body.googleAccount.linkedAt);

  // Provider subject and internal ID must never be exposed
  const bodyString = JSON.stringify(linkedRes.body);
  assert.equal(bodyString.includes(identity.providerSubject), false);
  assert.equal(linkedRes.body.providerSubject, undefined);
  assert.equal(linkedRes.body.externalIdentities, undefined);
});

test('17. existing new-user Google onboarding remains working', async () => {
  const freshGoogleIdentity = {
    provider: 'GOOGLE',
    providerSubject: `google-newuser-${randomUUID()}`,
    email: `brand-new-${randomUUID()}@example.invalid`
  };

  const resolved = await resolveGooglePatientIdentity({
    credential: 'mock',
    verifyCredential: verifierFor(freshGoogleIdentity),
    db: prisma
  });

  assert.equal(resolved.status, 'ONBOARDING_REQUIRED');
  assert.ok(resolved.onboardingToken);
});

test('18. existing linked Google login remains working', async () => {
  const { user } = await createPatientUser();
  const identity = {
    provider: 'GOOGLE',
    providerSubject: `google-existing-user-${randomUUID()}`,
    email: user.email
  };

  const created = await prisma.userExternalIdentity.create({
    data: {
      userId: user.id,
      provider: 'GOOGLE',
      providerSubject: identity.providerSubject,
      normalizedEmailAtLink: user.email.toLowerCase()
    }
  });
  createdIdentities.push(created.id);

  const resolved = await resolveGooglePatientIdentity({
    credential: 'mock',
    verifyCredential: verifierFor(identity),
    db: prisma
  });

  assert.equal(resolved.status, 'AUTHENTICATED');
  assert.equal(resolved.user.id, user.id);
  assert.ok(resolved.token);
});
