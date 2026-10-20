import { runTests } from './helpers/testRunner.js';
try { process.exitCode = runTests(process.argv.slice(2)); }
catch (error) { console.error(error.message); process.exitCode = 1; }
