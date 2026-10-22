import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const backendDir = fileURLToPath(new URL('../../', import.meta.url));
const inside = (root, candidate) => { const relative = path.relative(root, candidate); return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative); };

export function discoverTests(root = path.join(backendDir, 'test')) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        if (entry.name.endsWith('.test.js') || fs.statSync(target).isDirectory()) throw new Error('Test discovery refuses symbolic links: ' + path.relative(root, target));
      } else if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith('.test.js')) files.push(target);
    }
  }
  visit(root);
  if (!files.length) throw new Error('Test discovery found no **/*.test.js files in the test directory.');
  return files;
}

export function selectTests(requested, { base = backendDir, root = path.join(base, 'test') } = {}) {
  const discovered = discoverTests(root);
  if (!requested.length) return discovered;
  const canonicalRoot = fs.realpathSync(root);
  return [...new Set(requested.map((file) => {
    const target = path.resolve(base, file);
    if (!inside(root, target) || !target.endsWith('.test.js') || !fs.existsSync(target) || !fs.statSync(target).isFile() || !inside(canonicalRoot, fs.realpathSync(target)) || !discovered.includes(target)) {
      throw new Error('Invalid focused test path: expected an existing .test.js file inside test/.');
    }
    return target;
  }))].sort();
}

export function isolatedDatabaseUrl(value, schema) {
  let url;
  try { url = new URL(value); } catch { throw new Error('TEST_DATABASE_URL is required and must be a PostgreSQL URL for clinic-test-db.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '5433' || url.pathname !== '/clinic_test') {
    throw new Error('Test database refused: use clinic-test-db at localhost:5433/clinic_test.');
  }
  if (!/^(test|schedule_workflow)_[a-z0-9_]+$/.test(schema)) throw new Error('Invalid isolated test schema.');
  // Ignore inherited search_path/options; pg and Prisma must both use this schema.
  url.search = '';
  url.searchParams.set('schema', schema);
  url.searchParams.set('options', `-c search_path=${schema}`);
  return url.href;
}

export function runStep(args, { env, cwd = backendDir, spawn = spawnSync, output = process.stdout } = {}) {
  const result = spawn(process.execPath, args, { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
  output.write(result.stdout || ''); output.write(result.stderr || '');
  if (result.error || result.signal || result.status !== 0) {
    const error = new Error(`Command failed: ${args[0]} (${result.error?.code || result.signal || result.status || 'no exit status'}).`);
    error.exitCode = result.status || 1;
    throw error;
  }
  return result;
}

export function tapCounts(text) {
  return Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key => {
    const match = [...text.matchAll(new RegExp(`^# ${key} (\\d+)$`, 'gm'))].at(-1);
    return [key, match ? Number(match[1]) : 0];
  }));
}

export function runTests(requested = [], { environment = process.env, spawn = spawnSync, output = process.stdout, seedFixtures = true } = {}) {
  const files = selectTests(requested);
  // Validate target before any setup command (including Prisma generation).
  isolatedDatabaseUrl(environment.TEST_DATABASE_URL, 'test_validation');
  const runId = `${Date.now()}_${process.pid}`;
  const reportPath = environment.TEST_REPORT_PATH || path.join(os.tmpdir(), `clinic-backend-tests-${runId}.json`);
  const report = { discovered: discoverTests().map(f => path.relative(backendDir, f)), selected: files.map(f => path.relative(backendDir, f)), files: [], setupFailure: null };
  const persist = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  output.write(`Discovered ${report.discovered.length} test files; selected ${files.length}. Report: ${reportPath}\n`);
  const baseEnv = { ...environment, NODE_ENV: 'test', DEPLOYMENT_ENV: 'test', CLINIC_TIME_ZONE: 'Africa/Khartoum', JWT_SECRET: 'test-jwt-secret-at-least-thirty-two-characters', MEDICAL_ENCRYPTION_KEY: 'test-medical-key-separate-at-least-thirty-two', MFA_ENCRYPTION_KEY: 'test-mfa-key-separate-at-least-thirty-two-characters', CORS_ALLOWED_ORIGINS: 'http://localhost:5173', NOTIFICATIONS_DISABLED: 'true', VERIFICATION_PROVIDER: 'development', PHONE_VERIFICATION_PROVIDER: 'development', PHONE_DEFAULT_COUNTRY: 'RW' };
  // All children, including seed scripts and socket server forks, inherit this URL pair.
  const environmentFor = schema => { const url = isolatedDatabaseUrl(environment.TEST_DATABASE_URL, schema); return { ...baseEnv, DATABASE_URL: url, DIRECT_URL: url, SOCKET_REVOCATION_DATABASE_URL: url, TEST_DATABASE_URL: url }; };
  let exitCode = 0;
  try {
    runStep(['node_modules/prisma/build/index.js', 'generate'], { env: environmentFor(`test_${runId}_generate`), spawn, output });
    for (const [index, file] of files.entries()) {
      const relative = path.relative(backendDir, file);
      const selfContained = relative === 'test/schedule-workflow.test.js';
      const schema = `${selfContained ? 'schedule_workflow' : 'test'}_${runId}_${index}`;
      const env = environmentFor(schema);
      const entry = { file: relative, schema, seeded: seedFixtures && !selfContained, status: 'setup' };
      report.files.push(entry); persist();
      output.write(`[test-file] START ${relative} schema=${schema}\n`);
      // Sequential setup, a fresh schema for every file. No reset or shared-data cleanup.
      runStep(['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env, spawn, output });
      if (entry.seeded) runStep(['prisma/seed.js'], { env, spawn, output });
      const capture = { text: '', write(chunk) { this.text += chunk; output.write(chunk); } };
      try {
        runStep(['--test', '--test-concurrency=1', '--test-reporter=tap', relative], { env, spawn, output: capture });
        entry.status = 'passed';
      } catch (error) { entry.status = 'failed'; entry.exitCode = error.exitCode || 1; exitCode = entry.exitCode; }
      entry.counts = tapCounts(capture.text);
      if (!entry.counts.tests) { entry.status = 'failed'; exitCode = 1; entry.error = 'No test results reported.'; }
      output.write(`[test-file] ${entry.status.toUpperCase()} ${relative}\n`); persist();
    }
  } catch (error) { report.setupFailure = error.message; exitCode = error.exitCode || 1; }
  report.totals = report.files.reduce((totals, f) => { for (const [key, count] of Object.entries(f.counts || {})) totals[key] = (totals[key] || 0) + count; return totals; }, {});
  report.completedFiles = report.files.filter(f => f.status === 'passed' || f.status === 'failed').length;
  report.exitCode = exitCode; persist();
  output.write(`File coverage: ${report.completedFiles}/${files.length}; ${JSON.stringify(report.totals)}\n`);
  if (report.setupFailure) output.write(`Setup failed: ${report.setupFailure}\n`);
  return exitCode;
}
