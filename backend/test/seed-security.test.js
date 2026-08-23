import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

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
