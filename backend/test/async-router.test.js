import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { asyncRouter } from '../src/utils/asyncRouter.js';
import { ApiError, errorHandler } from '../src/utils/apiError.js';

function buildApp(router) {
  const app = express();
  app.use('/t', router);
  app.use(errorHandler);
  return app;
}

test('async handler rejection returns 500 without leaking details', async () => {
  const router = asyncRouter();
  router.get('/boom', async () => {
    throw new Error('secret database detail');
  });
  const res = await request(buildApp(router)).get('/t/boom').timeout(2000);
  assert.equal(res.status, 500);
  assert.equal(res.body.error.code, 'INTERNAL_SERVER_ERROR');
  assert.ok(!JSON.stringify(res.body).includes('secret database detail'));
});

test('async ApiError keeps its status and code', async () => {
  const router = asyncRouter();
  router.get('/conflict', async () => {
    throw new ApiError(409, 'SOME_CONFLICT', 'Conflict.');
  });
  const res = await request(buildApp(router)).get('/t/conflict').timeout(2000);
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'SOME_CONFLICT');
});

test('rejection inside async middleware and later handlers is forwarded', async () => {
  const router = asyncRouter();
  router.use(async () => {
    throw new Error('middleware failure');
  });
  router.get('/never', (req, res) => res.json({ ok: true }));
  const res = await request(buildApp(router)).get('/t/never').timeout(2000);
  assert.equal(res.status, 500);
});

test('successful async handlers and normal middleware chains still work', async () => {
  const router = asyncRouter();
  const addValue = (req, res, next) => { req.value = 42; next(); };
  router.get('/ok', addValue, async (req, res) => {
    await Promise.resolve();
    res.json({ value: req.value });
  });
  const res = await request(buildApp(router)).get('/t/ok').timeout(2000);
  assert.equal(res.status, 200);
  assert.equal(res.body.value, 42);
});

test('every route module uses asyncRouter instead of a bare express.Router', () => {
  const routesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/routes');
  const offenders = fs.readdirSync(routesDir)
    .filter((file) => file.endsWith('.js'))
    .filter((file) => fs.readFileSync(path.join(routesDir, file), 'utf8').includes('express.Router('));
  assert.deepEqual(offenders, []);
});
