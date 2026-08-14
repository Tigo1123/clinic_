import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
