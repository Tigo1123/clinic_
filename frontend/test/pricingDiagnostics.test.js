import test from 'node:test';
import assert from 'node:assert/strict';
import { createPricingDiagnostics } from '../src/features/admin/pricingDiagnostics.js';

const host = (flag = '1') => ({ sessionStorage: { getItem: () => flag }, setTimeout, clearTimeout });
test('diagnostics require both an allowed build and explicit session opt-in', () => {
  for (const [allowed, flag] of [[false, '1'], [true, null], [true, '0']]) {
    const browser = host(flag), trace = createPricingDiagnostics({ allowed, host: browser });
    assert.equal(trace.enabled, false); trace.mount(); trace.click('doctors', { id: 'doctor' }, { priceSdg: '500' });
    assert.equal(browser.__SHIFA_PRICING_DIAGNOSTICS__, undefined);
    assert.deepEqual(trace.headers('request'), {});
  }
  const blocked = createPricingDiagnostics({ allowed: true, host: { sessionStorage: { getItem() { throw Error('blocked storage'); } } } });
  assert.equal(blocked.enabled, false);
});

test('trace uses a whitelist: no credentials, headers, names, raw responses or raw errors', () => {
  const browser = host(), trace = createPricingDiagnostics({ allowed: true, host: browser }); trace.mount();
  const secret = 'SECRET_TOKEN_OR_PASSWORD';
  const item = { id: 'medicine-id', unitPriceSdg: 100, status: 'ACTIVE', labelEn: secret, token: secret, password: secret };
  const actionId = trace.click('medicines', item, { priceSdg: '150', status: 'ACTIVE', authorization: secret });
  trace.startSave(actionId, { priceSdg: 150, status: 'ACTIVE', token: secret });
  trace.event('read.invalidated', { version: 4, authorization: secret, error: secret });
  const requestId = trace.requestStart('PATCH', { actionId, reason: secret });
  trace.saved(actionId, 'medicines', { ...item, unitPriceSdg: 150 });
  trace.requestEnd(requestId, { status: 200, data: { ...item, unitPriceSdg: 150, error: { message: secret, code: secret } }, errorName: secret });
  trace.endSave(actionId, 'success');
  trace.ui({ pricing: { medicines: [item] }, drafts: { 'medicines:medicine-id': { priceSdg: secret, status: secret } }, saving: {}, loading: false, activeTab: 'pricing' }, null);
  const events = browser.__SHIFA_PRICING_DIAGNOSTICS__.getEvents();
  assert.doesNotMatch(JSON.stringify(events), /SECRET_TOKEN_OR_PASSWORD|authorization|password|labelEn/);
  assert.deepEqual(events.find(event => event.type === 'save.start').payload, { priceSdg: 150, status: 'ACTIVE' });
  assert.equal(events.find(event => event.type === 'request.end').response.errorCode, 'OTHER');
  trace.unmount();
});

test('bounded event buffer returns detached snapshots and clear removes captured events', () => {
  const browser = host(), trace = createPricingDiagnostics({ allowed: true, host: browser }); trace.mount();
  for (let version = 0; version < 700; version++) trace.event('read.invalidated', { version });
  const api = browser.__SHIFA_PRICING_DIAGNOSTICS__, events = api.getEvents();
  assert.equal(events.length, 500); assert.equal(events.at(-1).version, 699);
  events.at(-1).version = -1; assert.equal(api.getEvents().at(-1).version, 699);
  api.clear(); assert.deepEqual(api.getEvents(), []); trace.unmount();
});

test('instance IDs identify separate pricing owners without mixing their pending requests', () => {
  const browser = host();
  const a = createPricingDiagnostics({ allowed: true, host: browser }), b = createPricingDiagnostics({ allowed: true, host: browser });
  a.mount(); b.mount();
  const action = a.click('services', { id: 'service' }, { priceSdg: '500', status: 'ACTIVE' });
  a.startSave(action, { priceSdg: 500, status: 'ACTIVE' });
  const request = b.requestStart('GET'); b.requestEnd(request, { status: 200, data: {} });
  const events = browser.__SHIFA_PRICING_DIAGNOSTICS__.getEvents();
  const mounts = events.filter(event => event.type === 'instance.mount'); assert.notEqual(mounts[0].instanceId, mounts[1].instanceId);
  assert.equal(events.find(event => event.type === 'request.start').refreshStartedBeforeSaveCompleted, false);
  a.endSave(action, 'failure'); a.unmount(); b.unmount();
});

test('request completion after unmount cannot schedule UI state updates', async () => {
  const browser = host(), trace = createPricingDiagnostics({ allowed: true, host: browser }); let idle = 0;
  trace.onIdle(() => idle++); trace.mount();
  const action = trace.click('doctors', { id: 'doctor' }, { priceSdg: '500' }); trace.startSave(action, { priceSdg: 500 });
  const request = trace.requestStart('PATCH', { actionId: action }); trace.unmount();
  trace.requestEnd(request, { status: 200 }); trace.endSave(action, 'success');
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(idle, 0);
});

test('diagnostics distinguish a discarded stale GET from an applied stale overwrite', () => {
  for (const applied of [false, true]) {
    const browser = host(), trace = createPricingDiagnostics({ allowed: true, host: browser }); trace.mount();
    const old = { id: 'medicine', unitPriceSdg: 100, status: 'INACTIVE' };
    const read = trace.requestStart('GET');
    const action = trace.click('medicines', old, { priceSdg: '875', status: 'ACTIVE' });
    trace.startSave(action, { priceSdg: 875, status: 'ACTIVE' });
    trace.saved(action, 'medicines', { ...old, unitPriceSdg: 875, status: 'ACTIVE' }); trace.endSave(action, 'success');
    trace.requestEnd(read, { status: 200, data: { medicines: [old] }, applied });
    const end = browser.__SHIFA_PRICING_DIAGNOSTICS__.getEvents().find(event => event.type === 'request.end');
    assert.equal(end.olderGetCompletedAfterSave, true);
    assert.equal(end.overwroteNewerState, applied);
    assert.deepEqual(end.wouldOverwriteSavedRows, ['medicines:medicine']);
    trace.unmount();
  }
});
