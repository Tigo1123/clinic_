// Cutover-prep checks against the compiled Nest app (npm run build:nest first).
import test from 'node:test';
import assert from 'node:assert/strict';

function fakeHost(path = '/api/records/x') {
  const res = {
    headersSent: false,
    statusCode: 0,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  const req = { method: 'POST', url: path, originalUrl: path, id: 'req-1' };
  return { res, host: { switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }) } };
}

test('ApiExceptionFilter: unhandled Prisma errors return the Express 500 envelope', async () => {
  const { ApiExceptionFilter } = await import('../dist/common/filters/api-exception.filter.js');
  const filter = new ApiExceptionFilter();
  for (const code of ['P2002', 'P2025', 'P2034']) {
    const error = Object.assign(new Error(`prisma ${code}`), { name: 'PrismaClientKnownRequestError', code, meta: { target: ['username'] } });
    const { res, host } = fakeHost();
    filter.catch(error, host);
    assert.equal(res.statusCode, 500, code);
    assert.deepEqual(res.body, {
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected server error occurred.' }
    }, code);
  }
});

test('labReviewSchema normalizes like the Express route and never rejects', async () => {
  const { labReviewSchema } = await import('../dist/modules/laboratory/lab-review.schema.js');
  assert.deepEqual(
    labReviewSchema.parse({ decision: ' link_existing ', note: '  hi ', serviceId: ' svc ', service: { labelEn: 'A' } }),
    { decision: 'LINK_EXISTING', note: 'hi', serviceId: 'svc', service: { labelEn: 'A' } }
  );
  for (const body of [undefined, null, [], 'x', { decision: 5, note: '   ', serviceId: 7, service: 'str' }]) {
    assert.deepEqual(labReviewSchema.parse(body), { decision: '', note: null, serviceId: '', service: {} });
  }
  // Client-supplied price keys must survive so the service can answer LAB_PRICE_ADMIN_REQUIRED.
  const parsed = labReviewSchema.parse({ decision: 'CREATE_SERVICE', service: { labelEn: 'A', labelAr: 'ب', baseFeeSdg: 10 } });
  assert.equal(Object.hasOwn(parsed.service, 'baseFeeSdg'), true);
});

// --- Cutover: NestJS is the production entrypoint ---------------------------------

import { readFileSync } from 'node:fs';

const readRepo = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

test('cutover: backend image and start scripts run NestJS, Express stays as rollback', () => {
  const dockerfile = readRepo('backend/Dockerfile');
  assert.match(dockerfile, /^CMD \["node", "dist\/main\.js"\]$/m);
  assert.match(dockerfile, /RUN npm run build:nest/);
  assert.match(dockerfile, /COPY --from=builder --chown=node:node \/app\/dist \.\/dist\//);

  const { scripts, main } = JSON.parse(readRepo('backend/package.json'));
  assert.equal(main, 'dist/main.js');
  for (const name of ['start', 'start:container', 'start:staging']) assert.match(scripts[name], /node dist\/main\.js$/, name);
  assert.match(scripts.dev, /nest start --watch$/);
  assert.match(scripts['start:express'], /node src\/server\.js$/);
});

test('cutover: createApp matches the Express HTTP edge', async () => {
  const { createApp } = await import('../dist/main.js');
  const previous = process.env.TRUST_PROXY;
  try {
    for (const [value, expected] of [['true', 1], ['false', false], [undefined, false]]) {
      if (value === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = value;
      const app = await createApp({ logger: false });
      const express = app.getHttpAdapter().getInstance();
      assert.equal(express.get('trust proxy'), expected, `TRUST_PROXY=${value}`);
      assert.equal(express.enabled('x-powered-by'), false);
      await app.close();
    }
  } finally {
    if (previous === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = previous;
  }
});

test('cutover: shutdown stops revocation before servers close and disconnects Prisma after', async () => {
  const { PrismaConnectionLifecycle } = await import('../dist/database/prisma.service.js');
  const { SocketRevocationService } = await import('../dist/modules/realtime/socket-revocation.service.js');
  // Nest closes in this order: onModuleDestroy -> HTTP/Socket.IO dispose -> onApplicationShutdown.
  assert.equal(typeof SocketRevocationService.prototype.onModuleDestroy, 'function');
  assert.equal(typeof PrismaConnectionLifecycle.prototype.onApplicationShutdown, 'function');
  assert.equal(PrismaConnectionLifecycle.prototype.onModuleDestroy, undefined);

  const main = readRepo('backend/src/main.ts');
  assert.match(main, /handleShutdownSignals\(app\);/);
});

test('cutover: a shutdown signal closes the app once and exits 0, or 1 on failure', async () => {
  const { handleShutdownSignals } = await import('../dist/main.js');
  for (const [closeResult, expectedCode] of [[Promise.resolve(), 0], [Promise.reject(new Error('close failed')), 1]]) {
    closeResult.catch(() => {});
    let closes = 0;
    const exited = new Promise((resolve) => {
      handleShutdownSignals({ close: () => { closes += 1; return closeResult; } }, resolve);
    });
    process.emit('SIGTERM', 'SIGTERM');
    process.emit('SIGINT', 'SIGINT');
    assert.equal(await exited, expectedCode);
    assert.equal(closes, 1);
  }
});
