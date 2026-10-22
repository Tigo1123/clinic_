// Isolated audit suite without invoking the general/demo seed.
import { spawnSync } from 'node:child_process';
import { runTests } from '../test/helpers/testRunner.js';

const files = [
  'admin-configuration', 'admin-configuration-migration', 'money', 'admin-doctor-management', 'admin-scheduling', 'audit-atomicity',
  'clinical-audit', 'clinic-readiness', 'clinic-readiness-migration',
  'integration', 'medicine-management', 'reference-bootstrap',
  'scheduling', 'seed-security', 'state-reference-contract', 'test-runner',
].map(name => `test/${name}.test.js`);

try {
  process.exitCode = runTests(files, {
    seedFixtures: false,
    spawn(command, args, options) {
      const childArgs = [...args];
      if (childArgs[0] === '--test' && childArgs.at(-1) === 'test/seed-security.test.js') {
        // This one test executes prisma/seed.js. Keep the guard tests, but do
        // not execute a general seed as part of the readiness audit.
        childArgs.splice(1, 0, '--test-skip-pattern=ordinary seed opening balances');
      }
      const result = spawnSync(command, childArgs, options);
      if (result.status === 0 && args[0] === 'node_modules/prisma/build/index.js' && args[1] === 'migrate') {
        const fixtures = spawnSync(command, ['test/helpers/operationalFixtures.js'], options);
        if (fixtures.status !== 0) return fixtures;
      }
      return result;
    },
  });
} catch {
  console.error('Readiness tests refused or failed. Use only the dedicated local test database.');
  process.exitCode = 1;
}
