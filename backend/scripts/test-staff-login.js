// Same guarded per-file schemas and operational fixtures as the readiness suite.
import { spawnSync } from 'node:child_process';
import { runTests } from '../test/helpers/testRunner.js';
try {
 process.exitCode = runTests([
  'test/staff-login-flow.test.js', 'test/mfa.test.js',
  'test/mfa-management.test.js', 'test/integration.test.js'
 ], {
  seedFixtures: false,
  spawn(command,args,options) {
   const result=spawnSync(command,args,options);
   if(result.status===0&&args[0]==='node_modules/prisma/build/index.js'&&args[1]==='migrate') {
    const fixture=spawnSync(command,['test/helpers/operationalFixtures.js'],options);
    if(fixture.status!==0)return fixture;
   }
   return result;
  }
 });
} catch { console.error('Staff login tests refused or failed. Use only the dedicated local test database.'); process.exitCode=1; }
