// Express <-> NestJS Socket.IO parity.
//
// Boots the Express server (src/server.js) and the compiled Nest app (dist/app.module.js) one
// after the other and runs the same socket.io-client scenarios against each:
// handshake rejection codes, room joining, Authorization-header-only rejection, and
// disconnect on a revocation notification.
//
// Run through the project runner so the schema is isolated and seeded:
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5433/clinic_test \
//     [NEST_DIST_DIR=/path/to/tsc-output] \
//     node test/run-tests.js test/nestjs-socket-parity.test.js
import 'reflect-metadata';
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { io as connectSocket } from 'socket.io-client';
import { backendDir } from './helpers/testRunner.js';

const distRoot = process.env.NEST_DIST_DIR ? path.resolve(process.env.NEST_DIST_DIR) : path.join(backendDir, 'dist');
const distEntry = path.join(distRoot, 'app.module.js');
const skipReason = !fs.existsSync(distEntry)
  ? `${path.relative(backendDir, distEntry) || distEntry} is missing (build with npm run build:nest first)`
  : !process.env.TEST_DATABASE_URL || !process.env.DATABASE_URL
    ? 'no test database configured (TEST_DATABASE_URL); run via node test/run-tests.js'
    : null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout(promise, label, ms = 5000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), ms); })
  ]).finally(() => clearTimeout(timer));
}

async function waitUntil(predicate, label, ms = 10000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(50);
  }
  throw new Error(`Timed out: ${label}`);
}

function client(url, options = {}) {
  return connectSocket(url, { transports: ['websocket'], reconnection: false, ...options });
}

async function expectConnectError(url, options) {
  const socket = client(url, options);
  try {
    const [error] = await withTimeout(once(socket, 'connect_error'), 'connect_error');
    return { message: error.message, code: error.data?.code };
  } finally {
    socket.close();
  }
}

async function connectOk(url, token) {
  const socket = client(url, { auth: { token } });
  await withTimeout(once(socket, 'connect'), 'connect');
  return socket;
}

async function listenLocal(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

// Same-process Express world: server.js exports the http server, io and revocation monitor.
async function bootExpress() {
  const { httpServer, io, socketRevocation } = await import('../src/server.js');
  await socketRevocation.start();
  const url = await listenLocal(httpServer);
  return {
    url,
    getIo: () => io,
    isReady: () => socketRevocation.isReady(),
    async close() {
      await socketRevocation.stop();
      io.close(); // also closes httpServer
    }
  };
}

async function bootNest() {
  const { NestFactory } = await import('@nestjs/core');
  const load = (file) => import(pathToFileURL(path.join(distRoot, file)).href);
  const { AppModule } = await load('app.module.js');
  const { AppConfigService } = await load('modules/config/config.service.js');
  const { RealtimeGateway } = await load('modules/realtime/realtime.gateway.js');
  const { SocketRevocationService } = await load('modules/realtime/socket-revocation.service.js');
  const { securityHeadersMiddleware, corsMiddleware } = await load('utils/edgeSecurity.js');
  const app = await NestFactory.create(AppModule, { logger: false });
  const configService = app.get(AppConfigService);
  app.use(securityHeadersMiddleware(configService.isProduction));
  app.use(corsMiddleware(configService.allowedOrigins));
  app.setGlobalPrefix('api');
  await app.init();
  const revocation = app.get(SocketRevocationService);
  const gateway = app.get(RealtimeGateway);
  const url = await listenLocal(app.getHttpServer());
  return {
    url,
    getIo: () => gateway.server,
    isReady: () => revocation.isReady(),
    close: () => app.close()
  };
}

async function resetAndSeed(prisma) {
  const [{ schema }] = await prisma.$queryRawUnsafe('SELECT current_schema() AS schema');
  if (!/^(test|schedule_workflow)_/.test(schema)) throw new Error(`Refusing to reset non-test schema "${schema}".`);
  const tables = await prisma.$queryRawUnsafe(
    "SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'"
  );
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map(({ tablename }) => `"${tablename}"`).join(', ')} CASCADE`);
  }
  try {
    execFileSync(process.execPath, ['prisma/seed.js'], { cwd: backendDir, env: process.env, stdio: 'pipe' });
  } catch (error) {
    throw new Error(`prisma/seed.js failed: ${String(error.stderr || error.message).slice(0, 2000)}`);
  }
}

function defineSuite(worldName, boot) {
  describe(`${worldName} socket handshake`, () => {
    let prisma;
    let signAccessToken;
    let world;
    let admin;
    let doctorUser;

    const tokenFor = (user, authVersion = user.authVersion) => signAccessToken({
      id: user.id,
      username: user.username,
      role: user.role,
      authVersion,
      doctorId: user.doctor?.id ?? null
    });

    before(async () => {
      ({ default: prisma } = await import('../src/db.js'));
      ({ signAccessToken } = await import('../src/services/accessTokens.js'));
      await resetAndSeed(prisma);
      world = await boot();
      await waitUntil(() => world.isReady(), `${worldName} revocation listener ready`);
      admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, include: { doctor: true } });
      doctorUser = await prisma.user.findFirst({ where: { role: 'DOCTOR', doctor: { isNot: null } }, include: { doctor: true } });
      assert.ok(admin, 'seed has an ADMIN user');
    });

    after(async () => {
      await world?.close();
    });

    test('no token -> AUTHENTICATION_REQUIRED', async () => {
      const result = await expectConnectError(world.url, {});
      assert.equal(result.code, 'AUTHENTICATION_REQUIRED');
      assert.equal(result.message, 'Authentication required.');
    });

    test('bad token -> INVALID_TOKEN', async () => {
      const result = await expectConnectError(world.url, { auth: { token: 'not-a-valid-token' } });
      assert.equal(result.code, 'INVALID_TOKEN');
      assert.equal(result.message, 'Invalid or expired token.');
    });

    test('revoked session (authVersion bumped) -> SESSION_REVOKED', async () => {
      const user = await prisma.user.create({
        data: { username: `sock-revoked-${worldName.toLowerCase()}@example.com`, passwordHash: 'x', role: 'RECEPTIONIST' }
      });
      const token = tokenFor(user);
      await prisma.user.update({ where: { id: user.id }, data: { authVersion: { increment: 1 } } });
      const result = await expectConnectError(world.url, { auth: { token } });
      assert.equal(result.code, 'SESSION_REVOKED');
      assert.equal(result.message, 'Session is no longer active.');
    });

    test('valid staff token connects and joins user_/role_ rooms', async () => {
      const socket = await connectOk(world.url, tokenFor(admin));
      try {
        const expected = [`user_${admin.id}`, `role_${admin.role}`].sort();
        await waitUntil(() => {
          const rooms = world.getIo().of('/').sockets.get(socket.id)?.rooms;
          return rooms && expected.every((room) => rooms.has(room));
        }, 'rooms joined');
        const rooms = [...world.getIo().of('/').sockets.get(socket.id).rooms].filter((room) => room !== socket.id).sort();
        assert.deepEqual(rooms, expected);
      } finally {
        socket.close();
      }
    });

    test('doctor token also joins doctor_ room', async (t) => {
      if (!doctorUser) return t.skip('seed has no doctor user');
      const socket = await connectOk(world.url, tokenFor(doctorUser));
      try {
        const expected = [`user_${doctorUser.id}`, `role_DOCTOR`, `doctor_${doctorUser.doctor.id}`].sort();
        await waitUntil(() => {
          const rooms = world.getIo().of('/').sockets.get(socket.id)?.rooms;
          return rooms && expected.every((room) => rooms.has(room));
        }, 'doctor rooms joined');
        const rooms = [...world.getIo().of('/').sockets.get(socket.id).rooms].filter((room) => room !== socket.id).sort();
        assert.deepEqual(rooms, expected);
      } finally {
        socket.close();
      }
    });

    test('token via Authorization header only -> rejected', async () => {
      const result = await expectConnectError(world.url, {
        extraHeaders: { Authorization: `Bearer ${tokenFor(admin)}` }
      });
      assert.equal(result.code, 'AUTHENTICATION_REQUIRED');
    });

    test('revocation notification disconnects a live socket', async () => {
      const socket = await connectOk(world.url, tokenFor(admin));
      try {
        const revoked = withTimeout(once(socket, 'sessionRevoked'), 'sessionRevoked event');
        const disconnected = withTimeout(once(socket, 'disconnect'), 'disconnect');
        await prisma.$executeRawUnsafe(
          `SELECT pg_notify('clinic_auth_revocation_v1', $1)`,
          JSON.stringify({ type: 'AUTH_VERSION_CHANGED', userId: admin.id, authVersion: admin.authVersion + 1 })
        );
        const [payload] = await revoked;
        assert.deepEqual(payload, { reason: 'CREDENTIALS_CHANGED' });
        await disconnected;
      } finally {
        socket.close();
      }
    });
  });
}

if (skipReason) {
  test.skip(`NestJS socket parity skipped: ${skipReason}`, () => {});
} else {
  defineSuite('Express', bootExpress);
  defineSuite('Nest', bootNest);

  after(async () => {
    const { default: prisma } = await import('../src/db.js');
    await prisma.$disconnect();
  });
}
