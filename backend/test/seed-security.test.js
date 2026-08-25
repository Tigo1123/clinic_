import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import prisma from '../src/db.js';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runSeed(extraEnv = {}) {
  return spawnSync(process.execPath, ['scripts/seed-staging.js'], {
    cwd: backendDir,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8'
  });
}

test('staging seed refuses to run without explicit opt-in', () => {
  const result = runSeed({ ALLOW_STAGING_SEED: '', DEPLOYMENT_ENV: 'staging' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Staging seed refused/);
});

test('staging seed refuses to run outside the staging deployment environment', () => {
  const result = runSeed({ ALLOW_STAGING_SEED: 'true', DEPLOYMENT_ENV: 'production' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DEPLOYMENT_ENV must be staging/);
});

test('credential replacement scripts atomically increment the access-token generation', () => {
  const adminReset = readFileSync(path.join(backendDir, 'scripts/reset-admin-password.js'), 'utf8');
  const qaSeed = readFileSync(path.join(backendDir, 'scripts/seed-qa.js'), 'utf8');
  assert.match(adminReset, /data:\s*\{[\s\S]*passwordHash,[\s\S]*lastPasswordChange:[\s\S]*authVersion:\s*\{\s*increment:\s*1\s*\}/);
  assert.match(qaSeed, /update:\s*\{\s*passwordHash,\s*authVersion:\s*\{\s*increment:\s*1\s*\}/);
});

test('ordinary seed does not overwrite clinic-configured catalogue prices', () => {
  const seed = readFileSync(path.join(backendDir, 'prisma/seed.js'), 'utf8');
  const serviceLoop = seed.slice(seed.indexOf('for (const svc of services)'), seed.indexOf('// 7. Seed Drug Formulary'));
  assert.match(serviceLoop, /if \(!existing\)[\s\S]*clinicalService\.create/);
  assert.doesNotMatch(serviceLoop, /clinicalService\.update/);
});

test('ordinary seed opening balances are ledger-consistent and idempotent', async () => {
  const before = await prisma.stockMovement.findMany({
    where: { referenceType: 'SEED_OPENING_BALANCE' },
    include: { inventoryBatch: true }
  });
  assert.ok(before.length > 0);
  for (const movement of before) {
    assert.equal(movement.movementType, 'OPENING_BALANCE');
    assert.equal(movement.actorUserId, null);
    assert.equal(movement.quantityDelta, movement.inventoryBatch.qtyOnHand);
    assert.equal(movement.resultingBalance, movement.inventoryBatch.qtyOnHand);
    assert.equal(movement.drugId, movement.inventoryBatch.drugId);
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = spawnSync(process.execPath, ['prisma/seed.js'], {
      cwd: backendDir,
      env: process.env,
      encoding: 'utf8'
    });
    assert.equal(result.status, 0);
  }

  const after = await prisma.stockMovement.findMany({
    where: { referenceType: 'SEED_OPENING_BALANCE' }
  });
  assert.equal(after.length, before.length);
  assert.equal(new Set(after.map((movement) => movement.inventoryBatchId)).size, after.length);
});

test('QA GENERAL billing resolves an active configured service and sends no client money', () => {
  const workflow = readFileSync(path.join(backendDir, 'scripts/qa-workflow.js'), 'utf8');
  const selection = workflow.slice(
    workflow.indexOf('const generalService ='),
    workflow.indexOf('const disposableStaff =')
  );
  const generalRequest = workflow.slice(
    workflow.indexOf("const invoice = await request('/api/billing/invoice'"),
    workflow.indexOf('const invoiceId =')
  );

  assert.match(selection, /status:\s*'ACTIVE'/);
  assert.match(selection, /baseFeeSdg:\s*\{\s*gt:\s*0,\s*lte:\s*1_000_000_000\s*\}/);
  assert.match(generalRequest, /serviceId:\s*generalService\.id/);
  assert.match(generalRequest, /quantity:\s*1/);
  assert.doesNotMatch(generalRequest, /\b(?:description|qty|price|unitPrice|unitPriceSdg|unitPriceUsd|subtotal|total|amount)\b\s*:/);
  assert.doesNotMatch(workflow, /serviceId:\s*service\.id/);
});
