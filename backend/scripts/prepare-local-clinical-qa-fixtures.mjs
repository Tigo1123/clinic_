import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import pg from 'pg';
import { LOCAL_SEED_STAFF } from './localSeedStaffCredentials.mjs';
import { localClinicalFixtureInternals, safeClinicalFixtureReport, validateLocalClinicalEnvironment } from './localClinicalQaFixtures.mjs';

const { Client } = pg;
const backendRoot = fileURLToPath(new URL('../', import.meta.url));
const reportDirectory = fileURLToPath(new URL('../../docs/full-system-qa/local-clinical-fixtures/', import.meta.url));

async function probeDatabase(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000, statement_timeout: 2_000 });
  try {
    await client.connect();
    const result = await client.query('SELECT current_database() AS database, current_schema() AS schema, current_user AS role');
    return result.rows[0];
  } finally {
    await client.end().catch(() => {});
  }
}

export async function prepareLocalClinicalFixtures({ env = process.env, fetchImpl = fetch, databaseProbe = () => probeDatabase(env.DATABASE_URL) } = {}) {
  try {
    validateLocalClinicalEnvironment(env);
    return await localClinicalFixtureInternals.run({ env, fetchImpl, databaseProbe, staffCredentials: LOCAL_SEED_STAFF });
  } catch (error) {
    const reason = error?.reason === 'database_identity_mismatch' ? 'database_identity_mismatch' : 'unsafe_local_configuration';
    return safeClinicalFixtureReport(null, { workflowResult: 'BLOCKED', reason });
  }
}

async function main() {
  const report = await prepareLocalClinicalFixtures();
  await mkdir(reportDirectory, { recursive: true, mode: 0o700 });
  const reportPath = join(reportDirectory, `${report.namespace || 'blocked-local-clinical-fixtures'}.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(report));
  if (report.workflowResult !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Deliberately suppress any error text that could contain credentials or URLs.
    console.error(JSON.stringify({ workflowResult: 'FAILED', reason: 'workflow_api_failed' }));
    process.exitCode = 1;
  });
}
