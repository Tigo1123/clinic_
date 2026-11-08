import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import pg from 'pg';
import { runPatientQa } from './qaPatientWorkflows.mjs';
import { qaMarkdown } from './qaReport.mjs';

export async function runQaCli({ outputDirectory = fileURLToPath(new URL('../../docs/full-system-qa/', import.meta.url)),
  log = value => console.log(value), ...options } = {}) {
  const report = await runPatientQa(options);
  await mkdir(outputDirectory, { recursive: true });
  const stem = report.runNamespace || `preflight-${Date.now()}`;
  await writeFile(join(outputDirectory, `${stem}.json`), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await writeFile(join(outputDirectory, `${stem}.md`), qaMarkdown(report), { flag: 'wx', mode: 0o600 });
  log(JSON.stringify({ gate: report.gate, result: report.result, runNamespace: report.runNamespace,
    patientsCreated: report.patientsCreated, patientsVerified: report.patientsVerified, workflowStarted: report.workflowStarted }));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const mode = process.env.QA_LOCAL_EXECUTION === 'true' ? 'local' : 'staging';
    const databaseProbe = mode === 'local' ? async () => {
      const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2_000, statement_timeout: 2_000 });
      try {
        await client.connect();
        return (await client.query(`SELECT current_database() AS database, current_schema() AS schema,
          current_user AS role, (SELECT count(*)::int FROM public."Patient") AS "patientCount"`)).rows[0];
      } finally { await client.end().catch(() => {}); }
    } : undefined;
    const report = await runQaCli({ signal: controller.signal, mode, databaseProbe });
    process.exitCode = ['FAILED', 'BLOCKED'].includes(report.result) ? 1 : 0;
  } catch {
    // Never print arbitrary exception messages, response bodies, or env values.
    console.error(JSON.stringify({ result: 'FAILED', reason: 'report_write_failed' }));
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}
