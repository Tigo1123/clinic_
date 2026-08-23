import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import i18n from '../src/i18n.js';
import { createStaffSocketLifecycle } from '../src/services/staffSocket.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (relative) => readFileSync(path.join(root, relative), 'utf8');

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.connectCalls = 0;
    this.disconnectCalls = 0;
    this.reconnectionValues = [];
    this.io = { reconnection: (value) => this.reconnectionValues.push(value) };
  }
  connect() { this.connectCalls += 1; }
  disconnect() { this.disconnectCalls += 1; }
}

function createFakeTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeoutFn(callback, delay) {
      const id = nextId++;
      pending.set(id, { callback, delay });
      return id;
    },
    clearTimeoutFn(id) { pending.delete(id); },
    runNext() {
      const next = pending.entries().next().value;
      assert.ok(next, 'Expected a pending retry timer.');
      pending.delete(next[0]);
      next[1].callback();
    },
    delays: () => [...pending.values()].map(({ delay }) => delay),
    count: () => pending.size
  };
}

function createLifecycleHarness() {
  const socket = new FakeSocket();
  const timers = createFakeTimers();
  let session = { token: 'test-access-token' };
  let terminalCalls = 0;
  const lifecycle = createStaffSocketLifecycle(socket, {
    readSession: () => session,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn
  });
  lifecycle.configureSessionRevocation(() => { terminalCalls += 1; });
  lifecycle.connect();
  return {
    lifecycle, socket, timers,
    clearSession: () => { session = null; },
    terminalCalls: () => terminalCalls
  };
}

test('terminal socket events cancel retries and invoke session handling once', () => {
  for (const code of ['SESSION_REVOKED', 'INVALID_TOKEN', 'AUTHENTICATION_REQUIRED']) {
    const harness = createLifecycleHarness();
    harness.socket.emit('connect_error', { data: { code: 'SOCKET_SECURITY_UNAVAILABLE' } });
    assert.equal(harness.timers.count(), 1);
    harness.socket.emit('connect_error', { data: { code } });
    harness.socket.emit('sessionRevoked');
    assert.equal(harness.timers.count(), 0);
    assert.equal(harness.socket.disconnectCalls, 1);
    assert.equal(harness.terminalCalls(), 1);
    assert.equal(harness.socket.reconnectionValues.at(-1), false);
  }
});

test('security-unavailable retry is single, bounded, session-aware, and reset by connection', () => {
  const harness = createLifecycleHarness();
  harness.socket.emit('connect_error', { data: { code: 'SOCKET_SECURITY_UNAVAILABLE' } });
  harness.socket.emit('connect_error', { data: { code: 'SOCKET_SECURITY_UNAVAILABLE' } });
  assert.equal(harness.terminalCalls(), 0);
  assert.deepEqual(harness.timers.delays(), [1000]);

  harness.timers.runNext();
  assert.equal(harness.socket.connectCalls, 2);
  harness.socket.emit('connect_error', { data: { code: 'SOCKET_SECURITY_UNAVAILABLE' } });
  assert.deepEqual(harness.timers.delays(), [2000]);
  harness.socket.emit('connect');
  assert.equal(harness.timers.count(), 0);
  harness.socket.emit('connect_error', { data: { code: 'SOCKET_SECURITY_UNAVAILABLE' } });
  assert.deepEqual(harness.timers.delays(), [1000]);
});

test('manual retry and explicit disconnect never reconnect without an active staff session', () => {
  const missingSession = createLifecycleHarness();
  missingSession.socket.emit('connect_error', { data: { code: 'SOCKET_SECURITY_UNAVAILABLE' } });
  missingSession.clearSession();
  missingSession.timers.runNext();
  assert.equal(missingSession.socket.connectCalls, 1);

  const disconnected = createLifecycleHarness();
  disconnected.socket.emit('connect_error', { data: { code: 'SOCKET_SECURITY_UNAVAILABLE' } });
  disconnected.lifecycle.disconnect();
  assert.equal(disconnected.timers.count(), 0);
  assert.equal(disconnected.socket.reconnectionValues.at(-1), false);
});

test('forced server disconnect is terminal while transport failures retain native reconnect behavior', () => {
  const forced = createLifecycleHarness();
  forced.socket.emit('disconnect', 'io server disconnect');
  assert.equal(forced.terminalCalls(), 1);
  assert.equal(forced.socket.disconnectCalls, 1);

  for (const reason of ['transport close', 'transport error', 'ping timeout']) {
    const transient = createLifecycleHarness();
    transient.socket.emit('disconnect', reason);
    assert.equal(transient.terminalCalls(), 0);
    assert.equal(transient.timers.count(), 0);
    assert.equal(transient.socket.disconnectCalls, 0);
  }
});

test('staff realtime notifications use one shared authenticated socket', () => {
  const service = source('src/services/staffSocket.js');
  const notifications = source('src/components/NotificationDropdown.jsx');
  assert.equal((service.match(/\bio\s*\(/g) || []).length, 1);
  assert.doesNotMatch(notifications, /from ['"]socket\.io-client['"]/);
  assert.match(notifications, /staffSocket as socket/);
  assert.match(notifications, /socket\.off\('notification', handleNotification\)/);
  assert.doesNotMatch(notifications, /socket\.off\('notification'\)/);
});

test('terminal socket security errors stop reconnection and invoke central session handling', () => {
  const service = source('src/services/staffSocket.js');
  const app = source('src/App.jsx');
  assert.match(service, /sessionRevoked/);
  assert.match(service, /SESSION_REVOKED/);
  assert.match(service, /INVALID_TOKEN/);
  assert.match(service, /reconnection\(false\)/);
  assert.match(service, /terminalSessionHandler\?\.\(\)/);
  assert.match(app, /configureStaffSocketSessionRevocation/);
  assert.match(app, /clearStaffSession\(\)/);
  assert.match(app, /setView\('login'\)/);
  assert.doesNotMatch(service, /SOCKET_SECURITY_UNAVAILABLE['"]\]\s*\.includes/);
});

test('localized revoked-session messages are generic and available in both languages', async () => {
  await i18n.changeLanguage('en');
  assert.equal(i18n.t('sessionNoLongerValid'), 'Your session is no longer valid. Please sign in again.');
  await i18n.changeLanguage('ar');
  assert.equal(i18n.t('sessionNoLongerValid'), 'لم تعد جلستك صالحة. سجّل الدخول مرة أخرى.');
});
