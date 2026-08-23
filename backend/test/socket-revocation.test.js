import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { Client } from 'pg';
import { io as connectSocket } from 'socket.io-client';
import prisma from '../src/db.js';
import { signAccessToken } from '../src/services/accessTokens.js';
import { parseRevocationPayload, SOCKET_REVOCATION_CHANNEL, SocketRevocationService } from '../src/services/socketRevocation.js';

const waitFor = (emitter, event, timeoutMs = 5000) => Promise.race([
  once(emitter, event),
  new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out waiting for ${event}.`)), timeoutMs))
]);

function waitForMessage(child, type, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for child message ${type}.`)), timeoutMs);
    const handler = (message) => {
      if (message?.type !== type) return;
      clearTimeout(timer);
      child.off('message', handler);
      resolve(message);
    };
    child.on('message', handler);
  });
}

async function startNode(extraEnv = {}) {
  const child = fork(new URL('./helpers/socket-revocation-node.js', import.meta.url), [], {
    env: { ...process.env, PORT: '0', ...extraEnv },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc']
  });
  const ready = await waitForMessage(child, 'ready');
  assert.equal(ready.state, 'READY');
  return { child, url: `http://127.0.0.1:${ready.port}` };
}

async function connect(url, token) {
  const socket = connectSocket(url, { auth: { token }, transports: ['websocket'], reconnection: false });
  await waitFor(socket, 'connect');
  return socket;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createFakeTimers() {
  let nextId = 1;
  const entries = new Map();
  const add = (type, callback, delay) => {
    const id = nextId++;
    entries.set(id, { type, callback, delay });
    return id;
  };
  return {
    api: {
      setTimeout: (callback, delay) => add('timeout', callback, delay),
      clearTimeout: (id) => entries.delete(id),
      setInterval: (callback, delay) => add('interval', callback, delay),
      clearInterval: (id) => entries.delete(id)
    },
    callback(type, delay) {
      return [...entries.values()].find((entry) => entry.type === type && entry.delay === delay)?.callback;
    },
    runTimeout(delay) {
      const match = [...entries.entries()].find(([, entry]) => entry.type === 'timeout' && entry.delay === delay);
      assert.ok(match, `Expected timeout with delay ${delay}.`);
      entries.delete(match[0]);
      match[1].callback();
    },
    count(type, delay) {
      return [...entries.values()].filter((entry) => entry.type === type && (delay === undefined || entry.delay === delay)).length;
    }
  };
}

function createListenerRaceHarness(findMany) {
  const clients = [];
  class FakeClient extends EventEmitter {
    constructor() {
      super();
      this.ended = false;
      clients.push(this);
    }
    async connect() {}
    async query() {}
    async end() { this.ended = true; }
  }
  const timers = createFakeTimers();
  const socket = {
    id: 'socket-a', user: { id: '10000000-0000-4000-8000-000000000001', role: 'DOCTOR', av: 1 },
    emit() {}, disconnect() { this.disconnected = true; }
  };
  const sockets = new Map([[socket.id, socket]]);
  const service = new SocketRevocationService({
    of: () => ({ sockets, adapter: { rooms: new Map() } })
  }, { databaseUrl: 'not-used', reconcileMs: 25, unhealthyGraceMs: 50 }, {
    ClientClass: FakeClient,
    timers: timers.api,
    prismaClient: { user: { findMany } }
  });
  return { clients, service, socket, timers };
}

const currentUser = {
  id: '10000000-0000-4000-8000-000000000001', status: 'ACTIVE', role: 'DOCTOR', authVersion: 1
};

test('a stale reconciliation failure cannot poison a newer ready listener generation', async () => {
  const oldReconciliation = deferred();
  let queryCount = 0;
  const harness = createListenerRaceHarness(async () => {
    queryCount += 1;
    if (queryCount === 2) return oldReconciliation.promise;
    return [currentUser];
  });

  await harness.service.start();
  const generationAClient = harness.clients[0];
  const generationATick = harness.timers.callback('interval', 25);
  generationATick();
  assert.equal(queryCount, 2);

  generationAClient.emit('error', new Error('listener A failed'));
  assert.equal(harness.service.state, 'UNHEALTHY');
  harness.timers.runTimeout(1000);
  await new Promise((resolve) => setImmediate(resolve));

  const generationBClient = harness.clients[1];
  assert.equal(harness.service.state, 'READY');
  assert.equal(generationBClient.ended, false);
  assert.equal(harness.timers.count('timeout', 50), 0);

  oldReconciliation.reject(new Error('stale reconciliation A failed'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.service.state, 'READY');
  assert.equal(generationBClient.ended, false);
  assert.equal(harness.timers.count('timeout', 50), 0);
  assert.equal(harness.socket.disconnected, undefined);
  await harness.service.stop();
});

test('current reconciliation failure remains fail closed', async () => {
  const reconciliation = deferred();
  let queryCount = 0;
  const harness = createListenerRaceHarness(async () => {
    queryCount += 1;
    return queryCount === 1 ? [currentUser] : reconciliation.promise;
  });
  await harness.service.start();
  harness.timers.callback('interval', 25)();
  reconciliation.reject(new Error('current reconciliation failed'));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.service.state, 'UNHEALTHY');
  assert.equal(harness.clients[0].ended, true);
  assert.equal(harness.timers.count('timeout', 50), 1);
  harness.timers.runTimeout(50);
  assert.equal(harness.socket.disconnected, true);
  await harness.service.stop();
});

test('periodic reconciliation does not overlap within one listener generation', async () => {
  const reconciliation = deferred();
  let queryCount = 0;
  const harness = createListenerRaceHarness(async () => {
    queryCount += 1;
    return queryCount === 1 ? [currentUser] : reconciliation.promise;
  });
  await harness.service.start();
  const tick = harness.timers.callback('interval', 25);
  tick();
  tick();
  assert.equal(queryCount, 2);
  reconciliation.resolve([currentUser]);
  await new Promise((resolve) => setImmediate(resolve));
  await harness.service.stop();
});

test('stop neutralizes a late reconciliation rejection', async () => {
  const reconciliation = deferred();
  let queryCount = 0;
  const harness = createListenerRaceHarness(async () => {
    queryCount += 1;
    return queryCount === 1 ? [currentUser] : reconciliation.promise;
  });
  await harness.service.start();
  harness.timers.callback('interval', 25)();
  await harness.service.stop();
  reconciliation.reject(new Error('late failure after stop'));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.service.state, 'STOPPED');
  assert.equal(harness.timers.count('timeout'), 0);
  assert.equal(harness.socket.disconnected, undefined);
});

test('revocation payload validation is identical for strings and decoded objects', () => {
  const userId = '10000000-0000-4000-8000-000000000001';
  const valid = { type: 'AUTH_VERSION_CHANGED', userId, authVersion: 3 };
  const extra = { ...valid, role: 'DOCTOR' };
  const makeService = () => {
    const socket = {
      id: 'socket-a', user: { id: userId, role: 'DOCTOR', av: 2 }, emit() {},
      disconnect() { this.disconnected = true; }
    };
    return {
      socket,
      service: new SocketRevocationService({
        of: () => ({
          sockets: new Map([[socket.id, socket]]),
          adapter: { rooms: new Map([[`user_${userId}`, new Set([socket.id])]]) }
        })
      }, { databaseUrl: 'not-used', reconcileMs: 10000, unhealthyGraceMs: 15000 })
    };
  };

  assert.deepEqual(parseRevocationPayload(JSON.stringify(valid)), valid);
  assert.equal(parseRevocationPayload(JSON.stringify(extra)), null);

  const accepted = makeService();
  assert.equal(accepted.service.handleNotification(valid), 1);
  assert.equal(accepted.socket.disconnected, true);

  for (const payload of [extra, { ...valid, authVersion: '3' }, JSON.stringify({ ...valid, authVersion: -1 })]) {
    const rejected = makeService();
    assert.equal(rejected.service.handleNotification(payload), 0);
    assert.equal(rejected.socket.disconnected, undefined);
  }
});

test('local disconnects fail closed for malformed generations and preserve current, newer, and unrelated sockets', () => {
  const revoked = [];
  const makeSocket = (id, user) => ({
    id, user, emit: (event, payload) => revoked.push({ id, event, payload }),
    disconnect() {
      this.disconnected = true;
      sockets.delete(id);
      for (const members of rooms.values()) members.delete(id);
    }
  });
  const userA = '10000000-0000-4000-8000-000000000001';
  const userB = '10000000-0000-4000-8000-000000000002';
  const oldA = makeSocket('old-a', { id: userA, role: 'DOCTOR', av: 2 });
  const currentA = makeSocket('current-a', { id: userA, role: 'DOCTOR', av: 3 });
  const newerA = makeSocket('newer-a', { id: userA, role: 'DOCTOR', av: 4 });
  const malformedA = makeSocket('malformed-a', { id: userA, role: 'DOCTOR', av: '2' });
  const otherB = makeSocket('other-b', { id: userB, role: 'RECEPTIONIST', av: 1 });
  const sockets = new Map([
    ['old-a', oldA], ['current-a', currentA], ['newer-a', newerA],
    ['malformed-a', malformedA], ['other-b', otherB]
  ]);
  const rooms = new Map([
    [`user_${userA}`, new Set(['old-a', 'current-a', 'newer-a', 'malformed-a'])],
    [`user_${userB}`, new Set(['other-b'])],
    ['role_DOCTOR', new Set(['old-a', 'current-a', 'newer-a', 'malformed-a'])]
  ]);
  const service = new SocketRevocationService({ of: () => ({ sockets, adapter: { rooms } }) }, {
    databaseUrl: 'not-used', reconcileMs: 10000, unhealthyGraceMs: 15000
  });

  assert.equal(service.handleNotification({ type: 'AUTH_VERSION_CHANGED', userId: userA, authVersion: 3 }), 2);
  assert.equal(oldA.disconnected, true);
  assert.equal(malformedA.disconnected, true);
  assert.equal(currentA.disconnected, undefined);
  assert.equal(newerA.disconnected, undefined);
  assert.equal(otherB.disconnected, undefined);
  assert.equal(revoked.every((entry) => entry.event === 'sessionRevoked' && entry.payload.reason === 'CREDENTIALS_CHANGED'), true);
});

test('reconciliation is authoritative and batched', async () => {
  const makeSocket = (id, user) => ({
    id, user, emit() {},
    disconnect() { this.disconnected = true; sockets.delete(id); }
  });
  const userA = '10000000-0000-4000-8000-000000000001';
  const userB = '10000000-0000-4000-8000-000000000002';
  const currentA = makeSocket('current-a', { id: userA, role: 'DOCTOR', av: 3 });
  const otherB = makeSocket('other-b', { id: userB, role: 'RECEPTIONIST', av: 1 });
  const sockets = new Map([['current-a', currentA], ['other-b', otherB]]);
  let queryCount = 0;
  const service = new SocketRevocationService({
    of: () => ({ sockets, adapter: { rooms: new Map() } })
  }, { databaseUrl: 'not-used', reconcileMs: 10000, unhealthyGraceMs: 15000 }, {
    prismaClient: { user: { findMany: async () => {
      queryCount += 1;
      return [
        { id: userA, status: 'ACTIVE', role: 'DOCTOR', authVersion: 3 },
        { id: userB, status: 'INACTIVE', role: 'RECEPTIONIST', authVersion: 1 }
      ];
    } } }
  });

  const result = await service.reconcile();
  assert.equal(queryCount, 1);
  assert.deepEqual(result, { checked: 2, disconnected: 1 });
  assert.equal(currentA.disconnected, undefined);
  assert.equal(otherB.disconnected, true);
});

test('authVersion trigger emits only committed, changed generations with a minimal payload', async () => {
  const listener = new Client({ connectionString: process.env.SOCKET_REVOCATION_DATABASE_URL });
  await listener.connect();
  await listener.query(`LISTEN ${SOCKET_REVOCATION_CHANNEL}`);
  const events = [];
  listener.on('notification', (message) => {
    if (message.channel === SOCKET_REVOCATION_CHANNEL) events.push(parseRevocationPayload(message.payload));
  });
  const user = await prisma.user.create({
    data: { username: `trigger-${Date.now()}@test.local`, passwordHash: 'not-used', role: 'RECEPTIONIST', status: 'ACTIVE' }
  });
  try {
    await prisma.user.update({ where: { id: user.id }, data: { preferredLanguage: 'en' } });
    await prisma.user.update({ where: { id: user.id }, data: { authVersion: user.authVersion } });
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { authVersion: { increment: 1 } } });
      throw new Error('ROLLBACK_EXPECTED');
    }).catch((error) => assert.equal(error.message, 'ROLLBACK_EXPECTED'));
    const updated = await prisma.user.update({ where: { id: user.id }, data: { authVersion: { increment: 1 } } });
    while (!events.length) await waitFor(listener, 'notification');
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], { type: 'AUTH_VERSION_CHANGED', userId: user.id, authVersion: updated.authVersion });
    assert.deepEqual(Object.keys(events[0]).sort(), ['authVersion', 'type', 'userId']);
  } finally {
    await listener.end();
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('two independent backend processes revoke active sockets and reconcile missed notifications', async () => {
  const user = await prisma.user.create({
    data: { username: `socket-revoke-${Date.now()}@test.local`, passwordHash: 'not-used', role: 'RECEPTIONIST', status: 'ACTIVE' }
  });
  const nodes = [];
  const sockets = [];
  try {
    nodes.push(await startNode({ SOCKET_REVOCATION_RECONCILE_MS: '1000', SOCKET_REVOCATION_UNHEALTHY_GRACE_MS: '200' }));
    nodes.push(await startNode({ SOCKET_REVOCATION_RECONCILE_MS: '1000', SOCKET_REVOCATION_UNHEALTHY_GRACE_MS: '200' }));
    const tokenN = signAccessToken({ id: user.id, username: user.username, role: user.role, authVersion: user.authVersion });
    sockets.push(await connect(nodes[0].url, tokenN), await connect(nodes[1].url, tokenN));
    const revoked = sockets.map((socket) => waitFor(socket, 'sessionRevoked'));
    const disconnected = sockets.map((socket) => waitFor(socket, 'disconnect'));
    const updated = await prisma.user.update({ where: { id: user.id }, data: { authVersion: { increment: 1 } } });
    await Promise.all([...revoked, ...disconnected]);
    assert.equal(sockets.every((socket) => !socket.connected), true);

    for (const node of nodes) {
      const stale = connectSocket(node.url, { auth: { token: tokenN }, transports: ['websocket'], reconnection: false });
      const [error] = await waitFor(stale, 'connect_error');
      assert.equal(error.data?.code, 'SESSION_REVOKED');
      stale.disconnect();
    }

    const tokenCurrent = signAccessToken({ id: user.id, username: user.username, role: user.role, authVersion: updated.authVersion });
    const current = await connect(nodes[0].url, tokenCurrent);
    sockets.push(current);
    const stopMessage = waitForMessage(nodes[0].child, 'monitor-stopped');
    nodes[0].child.send({ type: 'stop-monitor' });
    await stopMessage;
    const newest = await prisma.user.update({ where: { id: user.id }, data: { authVersion: { increment: 1 } } });
    assert.equal(current.connected, true);
    const reconciled = waitFor(current, 'sessionRevoked');
    const startMessage = waitForMessage(nodes[0].child, 'monitor-started');
    nodes[0].child.send({ type: 'start-monitor' });
    assert.equal((await startMessage).state, 'READY');
    await reconciled;

    const latestToken = signAccessToken({ id: user.id, username: user.username, role: user.role, authVersion: newest.authVersion });
    const failClosedSocket = await connect(nodes[1].url, latestToken);
    sockets.push(failClosedSocket);
    const broken = waitForMessage(nodes[1].child, 'listener-broken');
    nodes[1].child.send({ type: 'break-listener' });
    await broken;
    const rejected = connectSocket(nodes[1].url, { auth: { token: latestToken }, transports: ['websocket'], reconnection: false });
    const [unavailable] = await waitFor(rejected, 'connect_error');
    assert.equal(unavailable.data?.code, 'SOCKET_SECURITY_UNAVAILABLE');
    rejected.disconnect();
    await waitFor(failClosedSocket, 'sessionRevoked');
  } finally {
    for (const socket of sockets) socket.disconnect();
    await Promise.all(nodes.map(async ({ child }) => {
      if (!child.connected) return;
      const exited = once(child, 'exit');
      child.send({ type: 'shutdown' });
      await exited;
    }));
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }
});
