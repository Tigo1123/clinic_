import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { discoverTests, selectTests, isolatedDatabaseUrl, runStep, runTests, tapCounts } from './helpers/testRunner.js';
const sink = { write() {} };
function fixture(run) {
 const base = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-runner-'));
 fs.mkdirSync(path.join(base, 'test', 'nested'), { recursive: true });
 try { return run(base); } finally { fs.rmSync(base, { recursive: true, force: true }); }
}
function file(base, name, contents = '') { fs.writeFileSync(path.join(base, name), contents); }

test('discovery is recursive, deterministic, and includes every .test.js but not helpers', () => fixture(base => {
 file(base, 'test/z.test.js'); file(base, 'test/nested/a.test.js'); file(base, 'test/helper.js');
 assert.deepEqual(discoverTests(path.join(base, 'test')).map(f => path.relative(base, f)), ['test/nested/a.test.js', 'test/z.test.js']);
}));
test('empty discovery fails clearly', () => fixture(base => assert.throws(() => discoverTests(path.join(base, 'test')), /no.*test\.js/)));
test('focused files exist inside test, accept nested paths, and deduplicate', () => fixture(base => {
 file(base, 'test/nested/a.test.js'); file(base, 'outside.test.js'); file(base, 'test/helper.js');
 assert.equal(selectTests(['./test/nested/a.test.js', 'test/nested/a.test.js'], { base }).length, 1);
 for (const requested of ['test/missing.test.js', 'test/helper.js', '../outside.test.js', 'test/../outside.test.js', 'test/nested', '--help', path.join(base, 'outside.test.js')]) {
  assert.throws(() => selectTests([requested], { base }), /Invalid focused/);
 }
}));
test('discovery and focused paths refuse symlink escapes', () => fixture(base => {
 file(base, 'test/valid.test.js'); file(base, 'outside.test.js');
 fs.symlinkSync(path.join(base, 'outside.test.js'), path.join(base, 'test/escape.test.js'));
 assert.throws(() => discoverTests(path.join(base, 'test')), /symbolic links/);
 assert.throws(() => selectTests(['test/escape.test.js'], { base }), /symbolic links/);
}));
test('database target is restricted and pg/Prisma use the same isolated search path', () => {
 const url = new URL(isolatedDatabaseUrl('postgresql://localhost:5433/clinic_test?schema=public&options=unsafe', 'test_fixture'));
 assert.equal(url.searchParams.get('schema'), 'test_fixture');
 assert.equal(url.searchParams.get('options'), '-c search_path=test_fixture');
 for (const target of ['postgresql://localhost:5433/clinic_dev', 'postgresql://postgres:5432/clinic', 'postgresql://localhost:15433/clinic_test', 'postgresql://localhost:5432/clinic_test', 'https://localhost:5433/clinic_test', 'invalid']) {
  assert.throws(() => isolatedDatabaseUrl(target, 'test_fixture'), /clinic-test-db/);
 }
 assert.throws(() => isolatedDatabaseUrl('postgresql://localhost:5433/clinic_test', 'public'), /schema/);
 const explicitLocalPort = new URL(isolatedDatabaseUrl('postgresql://127.0.0.1:55439/clinic_test', 'test_fixture', '55439'));
 assert.equal(explicitLocalPort.port, '55439');
 assert.throws(() => isolatedDatabaseUrl('postgresql://remote.example:55439/clinic_test', 'test_fixture', '55439'), /clinic-test-db/);
 assert.throws(() => isolatedDatabaseUrl('postgresql://localhost:55439/clinic', 'test_fixture', '55439'), /clinic-test-db/);
 assert.throws(() => isolatedDatabaseUrl('postgresql://localhost:55439/clinic_test', 'test_fixture', '5433'), /clinic-test-db/);
});
test('real child failures, signals, and spawn errors propagate', () => {
 assert.throws(() => runStep(['-e', 'process.exit(7)'], { output: sink }), e => e.exitCode === 7);
 assert.throws(() => runStep([], { output: sink, spawn: () => ({ status: null, signal: 'SIGTERM' }) }), /SIGTERM/);
 assert.throws(() => runStep([], { output: sink, spawn: () => ({ status: null, error: { code: 'ENOENT' } }) }), /ENOENT/);
});
function simulate(base, spawn) {
 const reportPath = path.join(base, 'report.json');
 const code = runTests(['test/access-token.test.js', 'test/async-router.test.js'], { environment: { TEST_DATABASE_URL: 'postgresql://localhost:5433/clinic_test', DIRECT_URL: 'postgresql://unintended.example/production', TEST_REPORT_PATH: reportPath }, spawn, output: sink });
 return { code, report: JSON.parse(fs.readFileSync(reportPath, 'utf8')) };
}
test('generation and seed failure stop setup and return nonzero', () => fixture(base => {
 let calls = 0;
 const generation = simulate(base, () => { calls++; return { status: 9 }; });
 assert.equal(generation.code, 9); assert.equal(calls, 1); assert.equal(generation.report.completedFiles, 0);
 calls = 0;
 const seed = simulate(base, (_command, args) => { calls++; return { status: args[0] === 'prisma/seed.js' ? 8 : 0 }; });
 assert.equal(seed.code, 8); assert.equal(calls, 3); assert.equal(seed.report.completedFiles, 0);
}));
test('test failure remains nonzero while every selected file runs sequentially in separate schemas', () => fixture(base => {
 const tests = []; const steps = [];
 const result = simulate(base, (_command, args, { env }) => {
  steps.push(args[0]);
  assert.equal(env.DATABASE_URL, env.SOCKET_REVOCATION_DATABASE_URL);
  assert.equal(env.DIRECT_URL, env.DATABASE_URL, 'Prisma migrations must never inherit a different direct database target');
  if (args[0] !== '--test') return { status: 0 };
  assert.ok(args.includes('--test-concurrency=1'));
  tests.push({ file: args.at(-1), schema: new URL(env.DATABASE_URL).searchParams.get('schema') });
  return { status: tests.length === 1 ? 3 : 0, stdout: `# tests 1\n# pass ${tests.length === 1 ? 0 : 1}\n# fail ${tests.length === 1 ? 1 : 0}\n# skipped 0\n` };
 });
 assert.equal(result.code, 3); assert.equal(result.report.completedFiles, 2);
 assert.equal(result.report.totals.fail, 1); assert.equal(result.report.totals.pass, 1);
 assert.notEqual(tests[0].schema, tests[1].schema);
 assert.deepEqual(steps, ['node_modules/prisma/build/index.js', 'node_modules/prisma/build/index.js', 'prisma/seed.js', '--test', 'node_modules/prisma/build/index.js', 'prisma/seed.js', '--test']);
}));
test('TAP counts preserve skips and cancellation separately', () => {
 assert.deepEqual(tapCounts('# tests 5\n# pass 2\n# fail 1\n# cancelled 1\n# skipped 1\n# todo 0\n'), { tests: 5, pass: 2, fail: 1, cancelled: 1, skipped: 1, todo: 0 });
});
test('test schemas are cleaned only when explicitly enabled and cleanup remains confined to generated schema names', () => fixture(base => {
 const reportPath = path.join(base, 'cleanup-report.json');
 const commands = [];
 const result = runTests(['test/access-token.test.js'], {
  environment: {
   TEST_DATABASE_URL: 'postgresql://localhost:5433/clinic_test',
   TEST_CLEANUP_SCHEMAS: 'true',
   TEST_REPORT_PATH: reportPath
  },
  spawn: (_command, args) => {
   commands.push(args);
   if (args[0] === '--test') return { status: 0, stdout: '# tests 1\n# pass 1\n# fail 0\n# skipped 0\n' };
   return { status: 0 };
  },
  output: sink
 });
 const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
 assert.equal(result, 0);
 assert.equal(report.files[0].schemaCleaned, true);
 assert.match(commands.at(-1).at(-1), /DROP SCHEMA IF EXISTS/);
 assert.match(commands.at(-1).at(-1), /schedule_workflow/);
}));
