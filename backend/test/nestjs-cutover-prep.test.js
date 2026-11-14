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
