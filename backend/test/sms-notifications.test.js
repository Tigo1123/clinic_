import test from 'node:test';
import assert from 'node:assert/strict';
import { sendSMS } from '../src/utils/notifications.js';

const input = { to: '+249912345678', body: 'private appointment message marker', language: 'en' };

test('SMS is disabled by default and notification logs contain neither full phone nor body', async () => {
  const logs = [];
  const sent = await sendSMS(input, { env: { NODE_ENV: 'production' }, log: async (entry) => logs.push(entry) });
  assert.equal(sent, false);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].data.status, 'FAILED');
  assert.notEqual(logs[0].data.recipientPhone, input.to);
  assert.match(logs[0].data.recipientPhone, /•/);
  assert.doesNotMatch(JSON.stringify(logs), /private appointment message marker|\+249912345678/);
});

test('SMS development simulation is limited to development/test and never reports sent', async () => {
  for (const NODE_ENV of ['development', 'test']) {
    const logs = [];
    const transported = await sendSMS(input, { env: { NODE_ENV, SMS_PROVIDER: 'development' }, transport: async () => assert.fail('simulation must not call a transport'), log: async (entry) => logs.push(entry) });
    assert.equal(transported, false);
    assert.equal(logs[0].data.status, 'SIMULATED');
    assert.equal(logs[0].data.messageBody, 'Appointment notification');
  }
  for (const NODE_ENV of ['staging', 'production']) {
    const logs = [];
    const transported = await sendSMS(input, { env: { NODE_ENV, SMS_PROVIDER: 'development' }, log: async (entry) => logs.push(entry) });
    assert.equal(transported, false);
    assert.equal(logs[0].data.status, 'FAILED');
  }
});

test('notification disablement skips transport and operational log writes', async () => {
  let writes = 0;
  const transported = await sendSMS(input, {
    env: { NODE_ENV: 'test', NOTIFICATIONS_DISABLED: 'true' },
    transport: async () => assert.fail('disabled SMS must not invoke transport'),
    log: async () => { writes += 1; }
  });
  assert.equal(transported, false);
  assert.equal(writes, 0);
});

test('mock transport failures and notification-log failures do not escape the post-commit SMS boundary', async () => {
  const logs = [];
  const failure = await sendSMS(input, {
    env: { NODE_ENV: 'test', SMS_PROVIDER: 'transport' },
    transport: async () => { throw new Error('secret and message must not be logged'); },
    log: async (entry) => logs.push(entry)
  });
  assert.equal(failure, false);
  assert.equal(logs[0].data.status, 'FAILED');

  const loggingFailure = await sendSMS(input, {
    env: { NODE_ENV: 'test', SMS_PROVIDER: 'transport' },
    transport: async () => { throw new Error('synthetic failure'); },
    log: async () => { throw new Error('database unavailable'); }
  });
  assert.equal(loggingFailure, false);
});

test('mock transport receives only delivery fields and simulated acceptance is never reported as sent', async () => {
  const calls = [];
  const logs = [];
  const sent = await sendSMS(input, {
    env: { NODE_ENV: 'test', SMS_PROVIDER: 'transport' },
    simulated: true,
    transport: async (payload) => { calls.push(payload); return { accepted: true }; },
    log: async (entry) => logs.push(entry)
  });
  assert.equal(sent, false);
  assert.deepEqual(calls, [input]);
  assert.equal(logs[0].data.status, 'SIMULATED');
  assert.notEqual(logs[0].data.recipientPhone, input.to);
  assert.doesNotMatch(JSON.stringify(logs), /private appointment message marker|\+249912345678/);
});

test('disabled and unknown SMS providers fail closed even when a transport is injected', async () => {
  for (const SMS_PROVIDER of ['disabled', undefined, 'unknown-provider']) {
    let calls = 0;
    const logs = [];
    const sent = await sendSMS(input, {
      env: { NODE_ENV: 'test', SMS_PROVIDER },
      transport: async () => { calls += 1; return { accepted: true }; },
      log: async (entry) => logs.push(entry)
    });
    assert.equal(sent, false, String(SMS_PROVIDER));
    assert.equal(calls, 0, String(SMS_PROVIDER));
    assert.equal(logs[0].data.status, 'FAILED');
  }
});

test('transport rejection and malformed results never report acceptance', async () => {
  for (const result of [false, undefined, null, 'accepted', [], {}, { accepted: false }, { accepted: true, delivered: true }, new (class Acceptance { constructor() { this.accepted = true; } })()]) {
    const logs = [];
    const sent = await sendSMS(input, {
      env: { NODE_ENV: 'test', SMS_PROVIDER: 'transport' },
      transport: async () => result,
      log: async (entry) => logs.push(entry)
    });
    assert.equal(sent, false, JSON.stringify(result));
    assert.equal(logs[0].data.status, 'FAILED', JSON.stringify(result));
  }
});

test('provider acceptance is distinct from handset delivery', async () => {
  const logs = [];
  const accepted = await sendSMS(input, {
    env: { NODE_ENV: 'test', SMS_PROVIDER: 'transport' },
    transport: async () => ({ accepted: true }),
    log: async (entry) => logs.push(entry)
  });
  assert.equal(accepted, true);
  assert.equal(logs[0].data.status, 'ACCEPTED');
  assert.notEqual(logs[0].data.status, 'DELIVERED');
});
