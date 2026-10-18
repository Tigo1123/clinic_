// Keep the focused entry point on the same discovery, isolation and failure path.
import { runTests } from '../test/helpers/testRunner.js';
try { process.exitCode = runTests(['test/schedule-workflow.test.js', 'test/clinic-time.test.js'], { seedFixtures: false }); }
catch (error) { console.error(error.message); process.exitCode = 1; }
