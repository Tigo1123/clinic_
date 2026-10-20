import { createSocketAuthenticate } from '../src/middleware/auth.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createAuthenticate } from '../src/middleware/auth.js';
import { AccessTokenError } from '../src/services/accessTokens.js';
import { errorHandler } from '../src/utils/apiError.js';

function buildApp(verify) {
  const app = express();
  app.get('/protected', createAuthenticate({ verify }), (req, res) => res.json({ ok: true, user: req.user.id }));
  app.use(errorHandler);
  return app;
}

const bearer = { Authorization: 'Bearer any-token' };

test('missing token returns 401 AUTHENTICATION_REQUIRED', async () => {
  const res = await request(buildApp(async () => ({}))).get('/protected');
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'AUTHENTICATION_REQUIRED');
});

test('invalid token returns 401 INVALID_TOKEN', async () => {
  const verify = async () => { throw new AccessTokenError('INVALID_TOKEN', 'bad'); };
  const res = await request(buildApp(verify)).get('/protected').set(bearer);
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'INVALID_TOKEN');
});

test('revoked session returns 401 SESSION_REVOKED', async () => {
  const verify = async () => { throw new AccessTokenError('SESSION_REVOKED', 'revoked'); };
  const res = await request(buildApp(verify)).get('/protected').set(bearer);
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'SESSION_REVOKED');
});

test('infrastructure failure returns retryable 503, not 401, and leaks nothing', async () => {
  const verify = async () => { throw new Error('connection refused to internal-db-host'); };
  const res = await request(buildApp(verify)).get('/protected').set(bearer);
  assert.equal(res.status, 503);
  assert.equal(res.body.error.code, 'SERVICE_UNAVAILABLE');
  assert.ok(res.headers['retry-after']);
  assert.ok(!JSON.stringify(res.body).includes('internal-db-host'));
});

test('valid user passes authentication', async () => {
  const verify = async () => ({ id: 'user-1', role: 'ADMIN', mustChangePassword: false });
  const res = await request(buildApp(verify)).get('/protected').set(bearer);
  assert.equal(res.status, 200);
  assert.equal(res.body.user, 'user-1');
});

const socketWith = (token) => ({ handshake: { auth: { token } } });
const runSocketAuth = (verify, socket) => new Promise((resolve) => createSocketAuthenticate({ verify })(socket, (error) => resolve(error || null)));

test('socket: infrastructure failure maps to the retryable SOCKET_SECURITY_UNAVAILABLE code', async () => {
  const error = await runSocketAuth(async () => { throw new Error('db down'); }, socketWith('tok'));
  assert.equal(error.data.code, 'SOCKET_SECURITY_UNAVAILABLE');
  assert.ok(!error.message.includes('db down'));
});

test('socket: invalid and revoked tokens keep their terminal codes', async () => {
  const invalid = await runSocketAuth(async () => { throw new AccessTokenError('INVALID_TOKEN', 'bad'); }, socketWith('tok'));
  assert.equal(invalid.data.code, 'INVALID_TOKEN');
  const revoked = await runSocketAuth(async () => { throw new AccessTokenError('SESSION_REVOKED', 'gone'); }, socketWith('tok'));
  assert.equal(revoked.data.code, 'SESSION_REVOKED');
});
