import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { PrismaClient } from '../src/generated/prisma/index.js';
import {
  REFERENCE_BOOTSTRAP_STATES,
  ReferenceBootstrapError,
  parseReferenceManifest,
  runReferenceBootstrap
} from '../src/services/referenceBootstrap.js';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(backendDir, 'prisma/migrations');
const databaseUrl = process.env.DATABASE_URL;
let adminClient;
let prisma;
let schema;

function manifest(services = []) {
  return { version: 1, services };
}

function service(overrides = {}) {
  return {
    labelAr: 'فحص مرجعي',
    labelEn: 'Reference Test Service',
    category: 'LABORATORY',
    status: 'INACTIVE',
    baseFeeSdg: null,
    ...overrides
  };
}

function environment(overrides = {}) {
  return {
    REFERENCE_BOOTSTRAP_ENABLED: 'true',
    REFERENCE_BOOTSTRAP_ENVIRONMENT: 'test',
    REFERENCE_BOOTSTRAP_EXPECTED_DATABASE: new URL(databaseUrl).pathname.slice(1),
    REFERENCE_BOOTSTRAP_DRY_RUN: 'false',
    ...overrides
  };
}

async function counts() {
  const [state, clinicalService, user, patient, doctor, drugFormulary, inventoryBatch, stockMovement, invoice, payment] = await Promise.all([
    prisma.state.count(), prisma.clinicalService.count(), prisma.user.count(), prisma.patient.count(), prisma.doctor.count(),
    prisma.drugFormulary.count(), prisma.inventoryBatch.count(), prisma.stockMovement.count(), prisma.invoice.count(), prisma.payment.count()
  ]);
  return { state, clinicalService, user, patient, doctor, drugFormulary, inventoryBatch, stockMovement, invoice, payment };
}

before(async () => {
  assert.ok(databaseUrl, 'DATABASE_URL is required');
  const parsed = new URL(databaseUrl);
  assert.ok(['localhost', '127.0.0.1'].includes(parsed.hostname));
  assert.match(parsed.pathname.toLowerCase(), /test/);
  schema = `reference_bootstrap_${process.pid}_${Date.now()}`;
  adminClient = new Client({ connectionString: parsed.toString() });
  await adminClient.connect();
  await adminClient.query(`CREATE SCHEMA "${schema}"`);
  await adminClient.query(`SET search_path TO "${schema}"`);
  const migrations = fs.readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const migration of migrations) {
    await adminClient.query(fs.readFileSync(path.join(migrationsDir, migration, 'migration.sql'), 'utf8'));
  }
  parsed.searchParams.set('schema', schema);
  prisma = new PrismaClient({ datasources: { db: { url: parsed.toString() } } });
});

beforeEach(async () => {
  await prisma.clinicalService.deleteMany();
  await prisma.state.deleteMany();
});

after(async () => {
  await prisma?.$disconnect();
  if (adminClient) {
    await adminClient.query('SET search_path TO public');
    await adminClient.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminClient.end();
  }
});

test('empty reference database receives exactly the approved 18 States', async () => {
  await runReferenceBootstrap({ prisma, manifest: manifest(), environment: environment() });
  assert.deepEqual(
    await prisma.state.findMany({ orderBy: { id: 'asc' }, select: { id: true, labelAr: true, labelEn: true } }),
    REFERENCE_BOOTSTRAP_STATES
  );
});

test('running the State bootstrap twice is idempotent', async () => {
  await runReferenceBootstrap({ prisma, manifest: manifest(), environment: environment() });
  const first = await prisma.state.findMany({ orderBy: { id: 'asc' } });
  await runReferenceBootstrap({ prisma, manifest: manifest(), environment: environment() });
  assert.deepEqual(await prisma.state.findMany({ orderBy: { id: 'asc' } }), first);
});

test('a conflicting State ID aborts every reference write', async () => {
  await prisma.state.create({ data: { id: 1, labelAr: 'متعارض', labelEn: 'Conflicting' } });
  await assert.rejects(
    runReferenceBootstrap({ prisma, manifest: manifest([service()]), environment: environment() }),
    (error) => error instanceof ReferenceBootstrapError && error.code === 'REFERENCE_STATE_CONFLICT'
  );
  assert.equal(await prisma.state.count(), 1);
  assert.equal(await prisma.clinicalService.count(), 0);
});

test('an approved manifest creates only an inactive unpriced service and is idempotent', async () => {
  const requested = service();
  await runReferenceBootstrap({ prisma, manifest: manifest([requested]), environment: environment() });
  await runReferenceBootstrap({ prisma, manifest: manifest([requested]), environment: environment() });
  const services = await prisma.clinicalService.findMany();
  assert.equal(services.length, 1);
  assert.equal(services[0].status, 'INACTIVE');
  assert.equal(services[0].baseFeeSdg, null);
  assert.equal(services[0].baseFeeUsd, null);
});

test('existing service lifecycle values are never reset', async () => {
  const requested = service();
  const existing = await prisma.clinicalService.create({ data: {
    labelAr: requested.labelAr, labelEn: requested.labelEn, category: requested.category,
    status: 'ACTIVE', baseFeeSdg: 1250, baseFeeUsd: 1
  } });
  await runReferenceBootstrap({ prisma, manifest: manifest([requested]), environment: environment() });
  const after = await prisma.clinicalService.findUnique({ where: { id: existing.id } });
  assert.equal(after.status, 'ACTIVE');
  assert.equal(Number(after.baseFeeSdg), 1250);
});

test('ambiguous or conflicting service labels fail closed and roll back States', async () => {
  const requested = service();
  await prisma.clinicalService.create({ data: {
    labelAr: requested.labelAr, labelEn: 'Different English', category: 'LABORATORY', status: 'INACTIVE'
  } });
  await prisma.clinicalService.create({ data: {
    labelAr: 'مختلف', labelEn: requested.labelEn, category: 'LABORATORY', status: 'INACTIVE'
  } });
  await assert.rejects(
    runReferenceBootstrap({ prisma, manifest: manifest([requested]), environment: environment() }),
    (error) => error instanceof ReferenceBootstrapError && error.code === 'REFERENCE_SERVICE_CONFLICT'
  );
  assert.equal(await prisma.state.count(), 0);
});

test('invalid category and any manifest price are rejected', () => {
  assert.throws(() => parseReferenceManifest(manifest([service({ category: 'OTHER' })])), /category/);
  assert.throws(() => parseReferenceManifest(manifest([service({ baseFeeSdg: -1 })])), /baseFeeSdg/);
  assert.throws(() => parseReferenceManifest(manifest([service({ baseFeeSdg: 100 })])), /baseFeeSdg/);
  assert.throws(() => parseReferenceManifest(manifest([
    service(),
    service({ labelEn: 'Another English Label', category: 'CONSULTATION' })
  ])), (error) => error.code === 'REFERENCE_SERVICE_MANIFEST_DUPLICATE');
});

test('dry run reports missing rows and performs zero writes', async () => {
  const result = await runReferenceBootstrap({
    prisma,
    manifest: manifest([service()]),
    environment: environment({ REFERENCE_BOOTSTRAP_DRY_RUN: 'true' })
  });
  assert.equal(result.mode, 'DRY RUN');
  assert.equal(result.report.states.missing.length, 18);
  assert.equal(result.report.services.missing.length, 1);
  assert.equal((await counts()).state, 0);
  assert.equal((await counts()).clinicalService, 0);
});

test('database mismatch performs zero writes', async () => {
  await assert.rejects(
    runReferenceBootstrap({
      prisma,
      manifest: manifest([service()]),
      environment: environment({ REFERENCE_BOOTSTRAP_EXPECTED_DATABASE: 'wrong_test_database' })
    }),
    (error) => error instanceof ReferenceBootstrapError && error.code === 'REFERENCE_BOOTSTRAP_DATABASE_MISMATCH'
  );
  assert.equal((await counts()).state, 0);
});

test('disabled and unconfirmed production execution are refused before database access', async () => {
  const refusingPrisma = new Proxy({}, { get() { throw new Error('Database access must not occur'); } });
  await assert.rejects(
    runReferenceBootstrap({ prisma: refusingPrisma, manifest: manifest(), environment: environment({ REFERENCE_BOOTSTRAP_ENABLED: '' }) }),
    (error) => error.code === 'REFERENCE_BOOTSTRAP_DISABLED'
  );
  await assert.rejects(
    runReferenceBootstrap({ prisma: refusingPrisma, manifest: manifest(), environment: environment({ REFERENCE_BOOTSTRAP_ENVIRONMENT: 'production' }) }),
    (error) => error.code === 'REFERENCE_BOOTSTRAP_PRODUCTION_REFUSED'
  );
});

test('bootstrap creates no operational or identity rows', async () => {
  await runReferenceBootstrap({ prisma, manifest: manifest([service()]), environment: environment() });
  const result = await counts();
  assert.deepEqual({
    user: result.user, patient: result.patient, doctor: result.doctor,
    drugFormulary: result.drugFormulary, inventoryBatch: result.inventoryBatch,
    stockMovement: result.stockMovement, invoice: result.invoice, payment: result.payment
  }, {
    user: 0, patient: 0, doctor: 0, drugFormulary: 0, inventoryBatch: 0,
    stockMovement: 0, invoice: 0, payment: 0
  });
});
