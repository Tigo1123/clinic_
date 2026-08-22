import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {
  ACCESS_TOKEN_ALGORITHM,
  accessTokenAudience,
  accessTokenIssuer,
  signAccessToken,
  verifyAccessToken
} from '../src/services/accessTokens.js';

process.env.JWT_SECRET ||= 'test-jwt-secret-at-least-thirty-two-characters';

const identity = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'token-test@example.invalid',
  role: 'ADMIN',
  authVersion: 0
};

function rawToken(payload, options = {}) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    algorithm: ACCESS_TOKEN_ALGORITHM,
    issuer: accessTokenIssuer(),
    audience: accessTokenAudience(),
    subject: identity.id,
    expiresIn: '5m',
    ...options
  });
}

test('issued access token has the strict application claims', () => {
  const claims = verifyAccessToken(signAccessToken(identity));
  assert.equal(claims.typ, 'access');
  assert.equal(claims.iss, accessTokenIssuer());
  assert.equal(claims.aud, accessTokenAudience());
  assert.equal(claims.sub, identity.id);
  assert.equal(claims.id, identity.id);
  assert.equal(claims.av, identity.authVersion);
});

test('access-token generation is explicit and strictly validated', () => {
  assert.throws(() => signAccessToken({ id: identity.id, username: identity.username, role: identity.role }));
  for (const av of [undefined, null, '0', -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => verifyAccessToken(rawToken({ ...identity, typ: 'access', av })));
  }
});

test('wrong-purpose and missing-purpose tokens are rejected', () => {
  assert.throws(() => verifyAccessToken(rawToken({ ...identity, typ: 'mfa_challenge' })));
  assert.throws(() => verifyAccessToken(rawToken(identity)));
});

test('wrong issuer and audience are rejected', () => {
  assert.throws(() => verifyAccessToken(rawToken({ ...identity, typ: 'access' }, { issuer: 'wrong-issuer' })));
  assert.throws(() => verifyAccessToken(rawToken({ ...identity, typ: 'access' }, { audience: 'wrong-audience' })));
});

test('expired and tampered tokens are rejected', () => {
  const expired = rawToken({ ...identity, typ: 'access' }, { expiresIn: -1 });
  assert.throws(() => verifyAccessToken(expired));

  const valid = signAccessToken(identity);
  const tampered = `${valid.slice(0, -2)}aa`;
  assert.throws(() => verifyAccessToken(tampered));
});

test('tokens signed with an unexpected algorithm are rejected', () => {
  const token = jwt.sign(
    { ...identity, typ: 'access' },
    process.env.JWT_SECRET,
    {
      algorithm: 'HS384',
      issuer: accessTokenIssuer(),
      audience: accessTokenAudience(),
      subject: identity.id,
      expiresIn: '5m'
    }
  );
  assert.throws(() => verifyAccessToken(token));
});
