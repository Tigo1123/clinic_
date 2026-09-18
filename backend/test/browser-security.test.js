import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { securityHeadersMiddleware } from '../src/utils/edgeSecurity.js';

test('production security headers include a strict CSP without unsafe script directives', async () => {
  const app = express();
  app.use(securityHeadersMiddleware(true));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  const response = await request(app).get('/health');
  const csp = response.headers['content-security-policy'];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-frame-options'], 'DENY');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
  assert.match(response.headers['permissions-policy'], /camera=\(\)/);
});
