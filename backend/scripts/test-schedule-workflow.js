import { spawnSync } from 'node:child_process';
const url = new URL(process.env.TEST_DATABASE_URL || '');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '5433' || url.pathname !== '/clinic_test') {
  throw new Error('Scheduling tests require clinic-test-db at localhost:5433/clinic_test.');
}
url.searchParams.set('schema', `schedule_workflow_${Date.now()}_${process.pid}`);
const env = { ...process.env, DATABASE_URL: url.href, NODE_ENV: 'test', CLINIC_TIME_ZONE: 'Africa/Khartoum', JWT_SECRET: 'schedule-workflow-isolated-test-secret' };
// Never invoke seed/reset. Migrations only create tables in a fresh test schema.
for (const [command, args] of [
  ['node', ['node_modules/prisma/build/index.js', 'migrate', 'deploy']],
  ['node', ['--test', 'test/schedule-workflow.test.js', 'test/clinic-time.test.js']]
]) {
  const result = spawnSync(command, args, { env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
