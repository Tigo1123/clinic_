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
