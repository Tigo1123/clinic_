import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { verifyGoogleCredential } from '../src/services/googleIdentity.js';

const originalClientId = process.env.GOOGLE_CLIENT_ID;
const clientId = 'test-google-web-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_ID = clientId;

after(() => {
  if (originalClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = originalClientId;
});

function payload(overrides = {}) {
  return {
    iss: 'https://accounts.google.com',
    aud: clientId,
    sub: 'google-subject-1',
    email: 'Patient@Example.COM',
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 300,
    ...overrides
  };
}

function clientFor(claims, error) {
  return {
    async verifyIdToken({ idToken, audience }) {
      assert.equal(idToken, 'credential');
      assert.equal(audience, clientId);
      if (error) throw error;
      return { getPayload: () => claims };
    }
  };
}

async function verify(claims, options = {}) {
  return verifyGoogleCredential('credential', { client: clientFor(claims), ...options });
}

test('valid verified credential returns normalized allowlisted identity', async () => {
  assert.deepEqual(await verify(payload({ name: 'Ignored', picture: 'https://example.invalid/picture', role: 'ADMIN' })), {
    provider: 'GOOGLE',
    providerSubject: 'google-subject-1',
    email: 'patient@example.com'
  });
});

test('missing credential and unavailable configuration fail safely', async () => {
  await assert.rejects(verifyGoogleCredential(''), { code: 'GOOGLE_CREDENTIAL_REQUIRED' });
  const configured = process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_ID;
  await assert.rejects(verifyGoogleCredential('credential'), { code: 'GOOGLE_AUTH_UNAVAILABLE', status: 503 });
  process.env.GOOGLE_CLIENT_ID = configured;
});

test('credential library failures are sanitized and classified', async () => {
  await assert.rejects(verifyGoogleCredential('credential', { client: clientFor(null, new Error('Invalid token signature')) }), { code: 'GOOGLE_CREDENTIAL_INVALID' });
  await assert.rejects(verifyGoogleCredential('credential', { client: clientFor(null, new Error('Wrong audience')) }), { code: 'GOOGLE_AUDIENCE_INVALID' });
  await assert.rejects(verifyGoogleCredential('credential', { client: clientFor(null, new Error('Token expired')) }), { code: 'GOOGLE_CREDENTIAL_EXPIRED' });
  await assert.rejects(verifyGoogleCredential('credential', { client: clientFor(null, new Error('Unable to fetch JWK')) }), { code: 'GOOGLE_VERIFICATION_UNAVAILABLE' });
});

test('audience, issuer, expiry, subject, email, and email verification are fail-closed', async () => {
  await assert.rejects(verify(payload({ aud: 'other-client' })), { code: 'GOOGLE_AUDIENCE_INVALID' });
  await assert.rejects(verify(payload({ iss: 'https://accounts.example.invalid' })), { code: 'GOOGLE_ISSUER_INVALID' });
  await assert.rejects(verify(payload({ exp: Math.floor(Date.now() / 1000) - 1 })), { code: 'GOOGLE_CREDENTIAL_EXPIRED' });
  await assert.rejects(verify(payload({ sub: '' })), { code: 'GOOGLE_SUBJECT_INVALID' });
  await assert.rejects(verify(payload({ email: 'not-an-email' })), { code: 'GOOGLE_EMAIL_INVALID' });
  await assert.rejects(verify(payload({ email: 'patient@example.com', email_verified: false })), { code: 'GOOGLE_EMAIL_UNVERIFIED' });
});

test('nonce is optional until a transaction supplies one, then mismatches fail closed', async () => {
  assert.equal((await verify(payload({ nonce: 'expected' }), { expectedNonce: 'expected' })).providerSubject, 'google-subject-1');
  await assert.rejects(verify(payload({ nonce: 'actual' }), { expectedNonce: 'expected' }), { code: 'GOOGLE_NONCE_MISMATCH' });
  assert.equal((await verify(payload({ nonce: 'present-but-not-yet-bound' }))).email, 'patient@example.com');
});

test('verification performs no persistence and returns no raw Google claims', async () => {
  const identity = await verify(payload({ name: 'Ignored', picture: 'ignored', hd: 'example.com', role: 'ADMIN' }));
  assert.deepEqual(Object.keys(identity).sort(), ['email', 'provider', 'providerSubject']);
  assert.equal('name' in identity, false);
  assert.equal('picture' in identity, false);
  assert.equal('role' in identity, false);
});
