import { verifyStagingQaGate } from './stagingQaGate.mjs';
import { createQaRunNamespace } from './qaRunNamespace.mjs';

// This entry point is deliberately preflight-only. Patient creation/workflows
// are not enabled in this pass; the safety gate must be reviewed and deployed first.
try {
  const result = await verifyStagingQaGate();
  const runNamespace = createQaRunNamespace();
  console.log(JSON.stringify({ ...result, runNamespace, patientsCreated: 0, workflowStarted: false }));
} catch (error) {
  const code = /^[a-z0-9_]+$/.test(error?.code || '') ? error.code : 'safety_gate_failed';
  console.error(JSON.stringify({ gate: 'BLOCKED', code, patientsCreated: 0, workflowStarted: false }));
  process.exitCode = 1;
}
