// Express <-> NestJS HTTP parity.
//
// Boots the Express app (src/server.js) and the compiled Nest app (dist/app.module.js,
// bootstrapped the same way as src/main.ts) and sends identical requests to both.
// Status code and normalised JSON body must match exactly.
//
// Run through the project runner so the schema is isolated and seeded:
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5433/clinic_test \
//     [NEST_DIST_DIR=/path/to/tsc-output] \
//     node test/run-tests.js test/nestjs-http-parity.test.js
// NEST_DIST_DIR defaults to dist/, which is only as current as the last `npm run build:nest`.
//
// Data isolation: each app gets its own freshly reset and reseeded schema. Within a
// run the scenario is an ordered list, so state-changing steps (change-password)
// behave identically in both worlds. The route sweep runs last, on its own fresh
// state, with a fresh ADMIN login, and boots a new Nest app every CHUNK requests so the
// Nest-only global ThrottlerGuard (100 req / 15 min) cannot mask route results with 429s.
import 'reflect-metadata';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { backendDir } from './helpers/testRunner.js';
import { normalise, parseExpressRoutes, concretePath, isRouteNotFound } from './helpers/parity.js';

const ADMIN_USERNAME = 'admin@cms.com';
const ADMIN_PASSWORD = 'Admin@123';
const ADMIN_NEW_PASSWORD = 'Rotated@Admin2026';
const PATIENT_USERNAME = 'parity-patient@example.com';
const PATIENT_PASSWORD = 'Patient@Parity2026';
const CHUNK = 60;

// NEST_DIST_DIR optionally points at another compiled tree (for example a fresh tsc output
// of src/); the default is the project's dist/, which is only as current as its last build.
const distRoot = process.env.NEST_DIST_DIR ? path.resolve(process.env.NEST_DIST_DIR) : path.join(backendDir, 'dist');
const distEntry = path.join(distRoot, 'app.module.js');
const skipReason = !fs.existsSync(distEntry)
  ? `${path.relative(backendDir, distEntry) || distEntry} is missing (build with npm run build:nest first)`
  : !process.env.TEST_DATABASE_URL || !process.env.DATABASE_URL
    ? 'no test database configured (TEST_DATABASE_URL); run via node test/run-tests.js'
    : null;

// Ordered scenario. `auth`: 'admin' | 'patient' | 'malformed' | omitted (no header).
// `expect` is checked against each app separately, in addition to the parity check.
// `capture` stores the login response token for later steps.
const SCENARIO = [
  { id: 'health-live', method: 'GET', path: '/api/health/live', expect: { status: 200 } },
  { id: 'public-config', method: 'GET', path: '/api/public-config', expect: { status: 200 } },
  // Both apps require an ADMIN token here (routes/specialties.js); this is not a public route.
  { id: 'specialties-no-token', method: 'GET', path: '/api/specialties', expect: { status: 401, code: 'AUTHENTICATION_REQUIRED' } },
  { id: 'protected-no-token', method: 'GET', path: '/api/auth/users', expect: { status: 401, code: 'AUTHENTICATION_REQUIRED' } },
  { id: 'protected-bad-token', method: 'GET', path: '/api/auth/users', auth: 'malformed', expect: { status: 401, code: 'INVALID_TOKEN' } },
  { id: 'unknown-api-route', method: 'GET', path: '/api/no-such-route', expect: { status: 404, code: 'ROUTE_NOT_FOUND' } },
  { id: 'login-empty-body', method: 'POST', path: '/api/auth/login', body: {}, expect: { status: 422, code: 'VALIDATION_ERROR', hasDetails: true } },
  { id: 'login-wrong-password', method: 'POST', path: '/api/auth/login', body: { username: ADMIN_USERNAME, password: 'Wrong@Password1' }, expect: { status: 401 } /* Express sends the legacy string body { error: 'Invalid username or password.' }; body parity is asserted separately */ },
  { id: 'admin-login', method: 'POST', path: '/api/auth/login', body: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD }, expect: { status: 200 }, capture: 'admin' },
  { id: 'admin-users', method: 'GET', path: '/api/auth/users', auth: 'admin', expect: { status: 200 } },
  { id: 'admin-audit-logs', method: 'GET', path: '/api/auth/audit-logs', auth: 'admin', expect: { status: 200 } },
  { id: 'patient-login', method: 'POST', path: '/api/auth/login', body: { username: PATIENT_USERNAME, password: PATIENT_PASSWORD }, expect: { status: 200 }, capture: 'patient' },
  { id: 'patient-me', method: 'GET', path: '/api/patient/me', auth: 'patient', expect: { status: 200 } },
  { id: 'patient-appointments', method: 'GET', path: '/api/patient/appointments', auth: 'patient', expect: { status: 200 } },
  { id: 'patient-doctors', method: 'GET', path: '/api/patient/doctors', auth: 'patient', expect: { status: 200 } },
  { id: 'patient-specialties', method: 'GET', path: '/api/patient/specialties', auth: 'patient', expect: { status: 200 } },
  { id: 'patient-prescriptions', method: 'GET', path: '/api/patient/prescriptions', auth: 'patient', expect: { status: 200 } },
  { id: 'patient-on-staff-route', method: 'GET', path: '/api/auth/users', auth: 'patient' },
  // Last on purpose: rotating the admin password revokes the admin token for later steps.
  { id: 'admin-change-password', method: 'POST', path: '/api/auth/change-password', auth: 'admin', body: { currentPassword: ADMIN_PASSWORD, newPassword: ADMIN_NEW_PASSWORD }, expect: { notStatus: 422 } }
];

// Creates a PATIENT user with a linked patient record. Seed data has no patient account.
async function createParityPatient(prisma) {
  const passwordHash = await bcrypt.hash(PATIENT_PASSWORD, 4);
  const user = await prisma.user.create({
    data: {
      username: PATIENT_USERNAME,
      email: PATIENT_USERNAME,
      passwordHash,
      role: 'PATIENT',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date()
    }
  });
  await prisma.patient.create({
    data: {
      userId: user.id,
      fullNameAr: 'مريض تكافؤ',
      fullNameEn: 'Parity Patient',
      gender: 'MALE',
      dateOfBirth: '1990-01-01',
      phone: '+250788400001',
      addressStateId: 1,
      emergencyContact: 'Self'
    }
  });
}

// Truncates every table and resets every sequence in the isolated schema, then runs the
// project's demo seed. Sequences matter: patient fileNumber comes from a sequence and
// would otherwise differ between the two worlds.
async function resetAndSeed(prisma) {
  const [{ schema }] = await prisma.$queryRawUnsafe('SELECT current_schema() AS schema');
  if (!/^(test|schedule_workflow)_/.test(schema)) throw new Error(`Refusing to reset non-test schema "${schema}".`);
  const tables = await prisma.$queryRawUnsafe(
    "SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'"
  );
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map(({ tablename }) => `"${tablename}"`).join(', ')} CASCADE`);
  }
  const sequences = await prisma.$queryRawUnsafe(
    'SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = current_schema()'
  );
  for (const { sequence_name: name } of sequences) {
    await prisma.$executeRawUnsafe(`ALTER SEQUENCE "${name}" RESTART`);
  }
  try {
    execFileSync(process.execPath, ['prisma/seed.js'], { cwd: backendDir, env: process.env, stdio: 'pipe' });
  } catch (error) {
    throw new Error(`prisma/seed.js failed: ${String(error.stderr || error.message).slice(0, 2000)}`);
  }
  await createParityPatient(prisma);
  // Seeded users are created within the same millisecond, so ORDER BY createdAt (used by the
  // staff list in both apps) would tie and fall back to heap order. Give every user a distinct,
  // deterministic timestamp so both worlds return the same order.
  await prisma.$executeRawUnsafe(`
    UPDATE "User" AS u SET "createdAt" = t.ts
    FROM (SELECT id, TIMESTAMP '2026-01-01 00:00:00' + ROW_NUMBER() OVER (ORDER BY username) * INTERVAL '1 second' AS ts FROM "User") AS t
    WHERE u.id = t.id`);
}

// Mirrors src/main.ts: same middleware, same global prefix, same init.
async function bootNest() {
  const { NestFactory } = await import('@nestjs/core');
  const load = (file) => import(pathToFileURL(path.join(distRoot, file)).href);
  const { AppModule } = await load('app.module.js');
  const { AppConfigService } = await load('modules/config/config.service.js');
  const { securityHeadersMiddleware, corsMiddleware } = await load('utils/edgeSecurity.js');
  const app = await NestFactory.create(AppModule, { logger: false });
  const configService = app.get(AppConfigService);
  app.use(securityHeadersMiddleware(configService.isProduction));
  app.use(corsMiddleware(configService.allowedOrigins));
  app.setGlobalPrefix('api');
  await app.init();
  return app;
}

// Each app listens on its own 127.0.0.1 port for the whole run. supertest's implicit
// listen(0) is not used: it can race with other local listeners on this machine and hand
// a request to someone else's server.
async function listenLocal(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function closeServer(server) {
  return new Promise((resolve) => (server.listening ? server.close(resolve) : resolve()));
}

function sendTo(baseUrl, { method, path: urlPath, body, auth }, tokens) {
  let req = request(baseUrl)[method.toLowerCase()](urlPath).timeout(15_000);
  const token = auth === 'admin' ? tokens.admin
    : auth === 'patient' ? tokens.patient
      : auth === 'malformed' ? 'not-a-valid-token'
        : null;
  if (token) req = req.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) req = req.send(body);
  return req;
}

// Runs the scenario in order against one target and records status, normalised body,
// and the raw body (used only for token capture, never compared).
async function runScenario(baseUrl) {
  const tokens = {};
  const results = {};
  for (const step of SCENARIO) {
    let result;
    try {
      const res = await sendTo(baseUrl, step, tokens);
      const isJson = /application\/json/.test(res.headers['content-type'] || '');
      const raw = isJson ? res.body : { nonJsonBody: res.text };
      result = { status: res.status, body: normalise(raw), raw };
    } catch (error) {
      result = { status: null, body: { transportError: error.message }, raw: null };
    }
    results[step.id] = result;
    if (step.capture && result.raw?.token) tokens[step.capture] = result.raw.token;
  }
  return results;
}

function assertExpectation(result, expect, label) {
  if (expect.status !== undefined) assert.equal(result.status, expect.status, `${label}: expected HTTP ${expect.status}`);
  if (expect.notStatus !== undefined) assert.notEqual(result.status, expect.notStatus, `${label}: must not return HTTP ${expect.notStatus}`);
  if (expect.code !== undefined) assert.equal(result.body?.error?.code, expect.code, `${label}: expected error code ${expect.code}`);
  if (expect.hasDetails) assert.ok(Array.isArray(result.body?.error?.details) && result.body.error.details.length > 0, `${label}: expected error.details`);
}

function defineParitySuite() {
  let prisma;
  let expressResults;
  let nestResults;
  let routeInventory;

  before(async () => {
    const { app: expressApp } = await import('../src/server.js');
    ({ default: prisma } = await import('../src/db.js'));
    routeInventory = parseExpressRoutes(backendDir);

    // Each world starts from the same freshly reset and reseeded state.
    await resetAndSeed(prisma);
    const expressServer = http.createServer(expressApp);
    try {
      expressResults = await runScenario(await listenLocal(expressServer));
    } finally {
      await closeServer(expressServer);
    }

    await resetAndSeed(prisma);
    const nestApp = await bootNest();
    try {
      nestResults = await runScenario(await listenLocal(nestApp.getHttpServer()));
    } finally {
      await nestApp.close();
    }
  });

  after(async () => {
    await prisma?.$disconnect();
  });

  for (const step of SCENARIO) {
    const label = `${step.method} ${step.path} [${step.id}]`;
    test(`${label}: Nest status and body match Express`, () => {
      const express = expressResults[step.id];
      const nest = nestResults[step.id];
      assert.deepStrictEqual({ status: nest.status, body: nest.body }, { status: express.status, body: express.body });
    });
    if (step.expect) {
      test(`${label}: Express meets expectation`, () => {
        assertExpectation(expressResults[step.id], step.expect, 'express');
      });
      test(`${label}: Nest meets expectation`, () => {
        assertExpectation(nestResults[step.id], step.expect, 'nest');
      });
    }
  }

  test('route parser sees every router.<method>( call in src/routes', () => {
    const parsedRouterRoutes = routeInventory.routes.filter((route) => route.file !== 'src/server.js').length;
    assert.equal(parsedRouterRoutes, routeInventory.routerCallCount);
  });

  test('route sweep: every Express route is registered in Nest (no ROUTE_NOT_FOUND)', async (t) => {
    await resetAndSeed(prisma);
    let nestApp = await bootNest();
    let baseUrl = await listenLocal(nestApp.getHttpServer());
    try {
      const login = await request(baseUrl)
        .post('/api/auth/login')
        .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
      assert.equal(login.status, 200, 'ADMIN login must succeed for the sweep');
      const adminToken = login.body.token;

      for (const [index, route] of routeInventory.routes.entries()) {
        if (index > 0 && index % CHUNK === 0) {
          await nestApp.close();
          nestApp = await bootNest();
          baseUrl = await listenLocal(nestApp.getHttpServer());
        }
        const url = concretePath(route.path);
        await t.test(`${route.method} ${route.path} (${route.file})`, async () => {
          let req = request(baseUrl)[route.method.toLowerCase()](url)
            .timeout(15_000)
            .set('Authorization', `Bearer ${adminToken}`);
          if (route.method !== 'GET' && route.method !== 'DELETE') req = req.send({});
          const res = await req;
          const result = { status: res.status, body: res.body, contentType: res.headers['content-type'] };
          assert.ok(!isRouteNotFound(result), `Nest does not register ${route.method} ${route.path} (got ${res.status} ${result.contentType || ''} ${JSON.stringify(res.body?.error?.code ?? res.body?.message ?? null)})`);
        });
      }
    } finally {
      await nestApp.close();
    }
  });
}

if (skipReason) {
  test.skip(`NestJS HTTP parity skipped: ${skipReason}`, () => {});
} else {
  defineParitySuite();
}
