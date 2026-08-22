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
