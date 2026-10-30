import test from 'node:test';
import assert from 'node:assert/strict';
import { createPharmacyRead, readPharmacyJson, pharmacyReadErrorMessage, validatePharmacyPayload } from '../src/services/pharmacyReads.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const reply = (body = [], status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const store = request => createPharmacyRead(signal => readPharmacyJson(request, '/queue', 'catalog', signal));

test('successful empty Pharmacy read settles as success', async () => {
  const resource = store(async () => reply()); await resource.reload();
  assert.deepEqual(resource.getSnapshot(), { data: [], loading: false, error: null, status: 'success', page: 1, hasMore: false });
});
for (const status of [401, 403, 404, 409, 500]) test(`Pharmacy ${status} settles, localizes and supports retry`, async () => {
  let fail = true; const resource = store(async () => fail ? reply({ error: 'PRIVATE RAW ENGLISH ERROR' }, status) : reply([{ id: 'ok' }]));
  await resource.reload(); const state = resource.getSnapshot();
  assert.equal(state.loading, false); assert.equal(state.error.status, status);
  assert.equal(state.status, status >= 500 || status === 409 ? 'retryable-error' : 'error');
  assert.match(pharmacyReadErrorMessage(state.error, 'ar'), /[\u0600-\u06ff]/u);
  assert.doesNotMatch(pharmacyReadErrorMessage(state.error, 'en'), /[\u0600-\u06ff]|PRIVATE/u);
  fail = false; await resource.reload(); assert.equal(resource.getSnapshot().status, 'success');
});
for (const payload of [null, {}, { items: [] }, [null], [{ id: 'rx', prescribedDrugs: [] }]]) test(`malformed payload ${JSON.stringify(payload)} fails explicitly`, async () => {
  const resource = createPharmacyRead(signal => readPharmacyJson(async () => reply(payload), '/queue', 'prescriptions', signal));
  await resource.reload(); assert.equal(resource.getSnapshot().loading, false); assert.equal(resource.getSnapshot().error.code, 'MALFORMED_PAYLOAD');
});
test('invalid JSON and network rejection terminate loading', async () => {
  for (const request of [async () => new Response('{'), async () => { throw Error('offline'); }]) {
    const resource = store(request); await resource.reload(); assert.equal(resource.getSnapshot().status, 'retryable-error'); assert.equal(resource.getSnapshot().loading, false);
  }
});
test('slow read remains pending while other panels succeed or fail independently', async () => {
  const slow = deferred(), resource = store(() => slow.promise), good = store(async () => reply([{ id: 'ok' }])), bad = store(async () => reply({}, 500));
  const pending = resource.reload(); await Promise.all([good.reload(), bad.reload()]);
  assert.equal(resource.getSnapshot().status, 'pending'); assert.equal(good.getSnapshot().status, 'success'); assert.equal(bad.getSnapshot().status, 'retryable-error');
  slow.resolve(reply()); await pending; assert.equal(resource.getSnapshot().loading, false);
});
test('cancel settles hung fetch/body without a timer; late responses cannot overwrite retry', async () => {
  for (const bodyPending of [false, true]) {
    const slow = deferred(); let count = 0;
    const resource = store(async () => ++count === 1 ? (bodyPending ? { ok: true, json: () => slow.promise } : slow.promise) : reply([{ id: 'new' }]));
    const pending = resource.reload(); await Promise.resolve(); resource.cancel(); await pending;
    assert.equal(resource.getSnapshot().loading, false); assert.equal(resource.getSnapshot().error.code, 'CANCELLED');
    await resource.reload(); slow.resolve(bodyPending ? [{ id: 'old' }] : reply([{ id: 'old' }])); await Promise.resolve();
    assert.deepEqual(resource.getSnapshot().data, [{ id: 'new' }]);
  }
});
test('StrictMode dispose/remount ignores superseded responses', async () => {
  const slow = deferred(); let count = 0; const resource = store(async () => ++count < 2 ? slow.promise : reply([{ id: 'latest' }]));
  const first = resource.reload(); resource.dispose(); await resource.reload(); slow.resolve(reply([{ id: 'old' }])); await first;
  assert.equal(resource.getSnapshot().status, 'success'); assert.deepEqual(resource.getSnapshot().data, [{ id: 'latest' }]);
});
test('queue paging retains loaded pages on refresh', async () => {
  const resource = createPharmacyRead(async (_, page) => ({ data: [{ id: page === 1 ? 'one' : 'two' }], hasMore: page === 1 }), { paged: true });
  await resource.reload(); await resource.loadMore(); await resource.reload();
  assert.deepEqual(resource.getSnapshot().data.map(row => row.id), ['one', 'two']); assert.equal(resource.getSnapshot().page, 2);
});
test('formulary and payment shapes are validated before render', () => {
  assert.throws(() => validatePharmacyPayload({ items: [], pagination: { page: 1, totalPages: 'many' } }, 'formulary'));
  assert.throws(() => validatePharmacyPayload({ dispensingAllowed: true, invoice: {} }, 'payment'));
  assert.doesNotThrow(() => validatePharmacyPayload({ dispensingAllowed: false, invoice: null, allowedPaymentMethods: [] }, 'payment'));
});
