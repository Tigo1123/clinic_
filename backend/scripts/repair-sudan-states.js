import { pathToFileURL } from 'node:url';
import { runReferenceBootstrap } from '../src/services/referenceBootstrap.js';

// This is the reviewed staging host already pinned by first-admin provisioning.
// No environment variable or CLI flag can turn this into a production repair.
export const SUDAN_REPAIR_STAGING_HOST = 'ep-muddy-unit-b4hvj7be.c-6.us-east-2.aws.neon.tech';
export function stagingStateRepairConfiguration(environment, args = []) {
  if (args.some(arg => !['--check', '--apply'].includes(arg)) || args.includes('--check') && args.includes('--apply')) throw new Error('Use --check or --apply.');
  const connection = environment.DIRECT_URL || environment.DATABASE_URL;
  if (!connection) throw new Error('A staging DIRECT_URL or DATABASE_URL must already be configured in the operator environment.');
  let url;
  try { url = new URL(connection); } catch { throw new Error('The configured database URL is invalid.'); }
  const directHost = url.hostname.replace('-pooler.', '.');
  const allowed = new Set(['schema', 'sslmode', 'sslaccept', 'sslcert', 'sslrootcert', 'sslidentity', 'sslpassword', 'connection_limit', 'pool_timeout', 'connect_timeout', 'socket_timeout', 'statement_cache_size', 'pgbouncer', 'channel_binding', 'application_name']);
  if ([...url.searchParams.keys()].some(key => !allowed.has(key)) || !['', '5432'].includes(url.port)) throw new Error('Connection target overrides or unknown connection settings are not permitted.');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || directHost !== SUDAN_REPAIR_STAGING_HOST || url.pathname !== '/neondb') throw new Error('Refused: this command only accepts the reviewed staging database.');
  if (['schema', 'sslmode', 'options', 'sslaccept'].some(key => url.searchParams.getAll(key).length > 1)) throw new Error('Repeated connection settings are not permitted.');
  if ((url.searchParams.get('schema') || 'public') !== 'public' || url.searchParams.get('options')) throw new Error('Only the public schema without search-path overrides is permitted.');
  if (url.searchParams.has('sslaccept') && url.searchParams.get('sslaccept') !== 'strict') throw new Error('Certificate verification must not be disabled.');
  // Enforce verified TLS even when the injected runtime URL uses sslmode=require.
  url.searchParams.set('sslmode', 'verify-full');
  url.searchParams.set('schema', 'public');
  return { url: url.href, apply: args.includes('--apply') };
}
export async function repairSudanStates(client, apply = false, environment = process.env) {
  stagingStateRepairConfiguration(environment, apply ? ['--apply'] : ['--check']);
  return runReferenceBootstrap({ prisma: client, manifest: { version: 1, services: [] }, environment: {
    REFERENCE_BOOTSTRAP_ENABLED: 'true', REFERENCE_BOOTSTRAP_ENVIRONMENT: 'staging',
    REFERENCE_BOOTSTRAP_EXPECTED_DATABASE: 'neondb', REFERENCE_BOOTSTRAP_DRY_RUN: apply ? 'false' : 'true'
  } });
}
async function main() {
  let client;
  try {
    const options = stagingStateRepairConfiguration(process.env, process.argv.slice(2));
    // Import Prisma only after target validation: its generated module can load .env.
    const { PrismaClient } = await import('../src/generated/prisma/index.js');
    client = new PrismaClient({ datasources: { db: { url: options.url } } });
    const result = await repairSudanStates(client, options.apply);
    const states = result.report.states;
    console.log(JSON.stringify({ mode: result.mode, expected: states.expected, existing: states.existing.map(row => row.id), missing: states.missing, conflicts: states.conflicting }, null, 2));
    if (states.conflicting.length) throw new Error('State conflicts require operator review. No rows were changed.');
  } catch (error) {
    if (error?.report?.states) console.log(JSON.stringify({ missing: error.report.states.missing, conflicts: error.report.states.conflicting }, null, 2));
    // Neither a connection URL nor a raw database error may enter console output.
    console.error(error?.name === 'ReferenceBootstrapError' || error?.constructor === Error ? error.message : 'State repair failed safely. Check database connectivity and permissions.');
    process.exitCode = 1;
  } finally { await client?.$disconnect(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
