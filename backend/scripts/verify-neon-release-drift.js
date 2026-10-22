// Creates a clean LOCAL baseline from only the remotely verified applied SQL.
// Reads Neon only; the sole remote client enforces read-only startup/transaction.
import fs from 'node:fs/promises';
import { Client } from 'pg';
import dotenv from 'dotenv';
import { assessDatabase } from './assess-database-migration.js';
import { PsqlReadOnlyClient } from './lib/psql-readonly-client.js';
import { repositoryInventory } from './audit-clinic-readiness.js';

const directory = (await fs.readFile('/tmp/shifa-migration-rehearsal-location','utf8')).trim();
if (!/^\/tmp\/shifa-migration-private-[A-Za-z0-9]+$/.test(directory)) throw Error('Private local directory required');
const local = JSON.parse(await fs.readFile(directory+'/local.json','utf8'));
if (local.port !== 55487 || !/^shifa-migration-rehearsal-\d+$/.test(local.name)) throw Error('Isolated local target required');
const target = dotenv.parse(await fs.readFile('.env')).DATABASE_URL;
if (!new URL(target).hostname.endsWith('.neon.tech')) throw Error('Configured Neon target required');
const remote = await assessDatabase(target,{clientFactory:config=>new PsqlReadOnlyClient(config)});
await fs.writeFile('../docs/clinic-readiness/neon-production-release/preflight.json',JSON.stringify(remote,null,2)+'\n');
if (remote.status!=='complete' || remote.migrationDrift.unknown.length || remote.migrationDrift.failed.length || remote.migrationDrift.checksumMismatches.length) throw Error('Remote inventory incomplete or migration drift detected');
const repository = await repositoryInventory();
const approvedPending = ['20261022100000_patient_workflow_query_indexes','20261022110000_admin_catalog_configuration'];
if (JSON.stringify(remote.migrationDrift.pending)!==JSON.stringify(approvedPending)) throw Error('Unexpected pending migration set');
const url = new URL('postgresql://127.0.0.1:55487/neon_clone'); url.username=local.user;url.password=local.password;
const admin = new Client({connectionString:url.href}); await admin.connect();
const database = 'neon_expected_'+Date.now(); await admin.query(`CREATE DATABASE "${database}"`); await admin.end(); url.pathname='/'+database;
const expected = new Client({connectionString:url.href}); await expected.connect();
try {
  for (const migration of repository.migrations.filter(m=>remote.migrationHistory.some(a=>a.migration_name===m.name && a.finished_at && !a.rolled_back_at))) {
    await expected.query(await fs.readFile(`prisma/migrations/${migration.name}/migration.sql`,'utf8'));
  }
} finally { await expected.end(); }
const localReport = await assessDatabase(url.href);
if(localReport.status!=='complete') throw Error('Local baseline inventory failed');
const comparisons = {};
for(const field of ['columns','constraints','indexes','enums','triggers','functions','sequences','policies']) {
  const actual=remote[field].filter(row=>row.table_name!=='_prisma_migrations');
  const baseline=localReport[field].filter(row=>row.table_name!=='_prisma_migrations');
  const normalize=rows=>rows.map(row=>JSON.stringify(row)).sort();
  const a=normalize(actual),b=normalize(baseline);
  comparisons[field]={matches:JSON.stringify(a)===JSON.stringify(b),actualCount:a.length,expectedCount:b.length,actualOnly:a.filter(row=>!b.includes(row)).map(row=>JSON.parse(row)),expectedOnly:b.filter(row=>!a.includes(row)).map(row=>JSON.parse(row))};
}
const tableSignature=r=>r.tables.filter(t=>t.name!=='_prisma_migrations').map(({name,row_security,forced_row_security})=>({name,row_security,forced_row_security}));
comparisons.tables={matches:JSON.stringify(tableSignature(remote))===JSON.stringify(tableSignature(localReport)),actualCount:tableSignature(remote).length,expectedCount:tableSignature(localReport).length};
const report={capturedAt:new Date().toISOString(),targetFingerprint:remote.fingerprint,database:remote.identity.database,schema:remote.schema,readOnly:true,expectedAppliedMigrations:repository.migrations.length-approvedPending.length,pending:approvedPending,migrationDrift:remote.migrationDrift,comparisons,noAssessedSchemaDrift:Object.values(comparisons).every(c=>c.matches),scope:'public tables/columns/defaults/nullability/Decimal/timestamp precision, constraints, indexes, enums, triggers, function definition hashes/security, sequence definitions, RLS flags and policies. Ownership, grants, provider extensions and database settings are not schema-equivalence claims.'};
await fs.writeFile('../docs/clinic-readiness/neon-production-release/drift-verification.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({noAssessedSchemaDrift:report.noAssessedSchemaDrift,comparisons:Object.fromEntries(Object.entries(comparisons).map(([k,v])=>[k,{matches:v.matches,actualCount:v.actualCount,expectedCount:v.expectedCount}]))}));
if(!report.noAssessedSchemaDrift)process.exitCode=1;
