// Hard stop unless the live direct Neon database still matches the approved packet and private reviewed snapshot.
// Returns counts and match flags only. Never emits table contents, credentials, or raw driver errors.
import fs from 'node:fs/promises';
import dotenv from 'dotenv';
import { Client } from 'pg';
import { assessDatabase, assessmentConnection, quoteIdentifier as q } from './assess-database-migration.js';
import { PsqlReadOnlyClient } from './lib/psql-readonly-client.js';
import { repositoryInventory } from './audit-clinic-readiness.js';

const release = JSON.parse(await fs.readFile('../docs/clinic-readiness/neon-production-release/release-manifest.json','utf8'));
const approved = JSON.parse(await fs.readFile('../docs/clinic-readiness/neon-production-release/preflight.json','utf8'));
const baseline = JSON.parse(await fs.readFile('../docs/clinic-readiness/render-neon-assessment/neon-inventory.json','utf8'));
const privateDir=(await fs.readFile('/tmp/shifa-migration-rehearsal-location','utf8')).trim();
if(!/^\/tmp\/shifa-migration-private-[A-Za-z0-9]+$/.test(privateDir)) throw Error('Private reviewed snapshot missing');
const snapshot=JSON.parse(await fs.readFile(privateDir+'/neon-baseline-digests.json','utf8'));
const env=dotenv.parse(await fs.readFile('.env'));
const configured=new URL(env.DATABASE_URL);
if(!configured.hostname.endsWith('.neon.tech')) throw Error('Configured Neon target mismatch');
const direct=new URL(configured); direct.hostname=direct.hostname.replace('-pooler.','.');
const connection=assessmentConnection(direct.href);
if(connection.fingerprint!==release.directFingerprint) throw Error('Direct target fingerprint changed');
const live=await assessDatabase(connection.connectionString,{clientFactory:config=>new PsqlReadOnlyClient(config)});
if(live.status!=='complete'||live.identity.database!=='neondb'||live.schema!=='public') throw Error('Live read-only inventory incomplete or target changed');
const repository=await repositoryInventory();
const names=repository.migrations.filter(m=>live.migrationHistory.some(x=>x.migration_name===m.name&&x.finished_at&&!x.rolled_back_at)).map(m=>m.name);
const history=live.migrationHistory.filter(m=>m.finished_at&&!m.rolled_back_at).map(m=>[m.migration_name,m.checksum]);
const approvedHistory=approved.migrationHistory.filter(m=>m.finished_at&&!m.rolled_back_at).map(m=>[m.migration_name,m.checksum]);
// Compare the direct endpoint inventory against the just-approved pooler snapshot.
const categories=['columns','constraints','indexes','enums','triggers','functions','sequences','policies'];
const meta={};
for(const field of categories){const normalize=rows=>rows.map(x=>JSON.stringify(x)).sort();meta[field]=JSON.stringify(normalize(live[field]))===JSON.stringify(normalize(approved[field]));}
meta.tables=JSON.stringify(live.tables.map(t=>[t.name,t.row_security,t.forced_row_security]).sort())===JSON.stringify(approved.tables.map(t=>[t.name,t.row_security,t.forced_row_security]).sort());
const sameCounts=JSON.stringify(live.tables.map(t=>[t.name,t.count]).sort())===JSON.stringify(approved.tables.map(t=>[t.name,t.count]).sort());
const expectedRows=JSON.parse(await fs.readFile(privateDir+'/local.json','utf8'));
const localUrl=new URL('postgresql://127.0.0.1:55487/neon_clone');localUrl.username=expectedRows.user;localUrl.password=expectedRows.password;
const local=new Client({connectionString:localUrl.href});await local.connect();
const remote=new PsqlReadOnlyClient({connectionString:connection.connectionString});await remote.connect();
const digestRows=async(client, tables)=>{
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  await client.query("SET LOCAL statement_timeout = '10s'");
  const output={};
  for(const table of tables){
    const sql=`SELECT count(*)::text AS count,md5(coalesce(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text),'')) AS digest FROM public.${q(table)} t`;
    output[table]=(await client.query(sql)).rows[0];
  }
  await client.query('ROLLBACK');return output;
};
const originalTables=approved.tables.filter(t=>t.name!=='_prisma_migrations').map(t=>t.name).sort();
let remoteDigest,localDigest;
try { [remoteDigest,localDigest]=await Promise.all([digestRows(remote,originalTables),digestRows(local,originalTables)]); }
finally { await Promise.allSettled([remote.end(),local.end()]); }
const dataMatches=originalTables.every(t=>remoteDigest[t].count===localDigest[t].count&&remoteDigest[t].digest===localDigest[t].digest&&remoteDigest[t].count===snapshot.tables[t]?.count&&remoteDigest[t].digest===snapshot.tables[t]?.digest);
const states=live.tables.find(t=>t.name==='State')?.count==='18';
const noReferences=live.tables.find(t=>t.name==='Specialty')?.count==='0'&&live.tables.find(t=>t.name==='PaymentMethod')===undefined;
const report={capturedAt:new Date().toISOString(),targetFingerprint:connection.fingerprint,database:live.identity.database,schema:live.schema,readOnly:true,status:'checked',migrationHistoryMatches:JSON.stringify(history)===JSON.stringify(approvedHistory),unknownMigrations:live.migrationDrift.unknown,failedMigrations:live.migrationDrift.failed,checksumMismatches:live.migrationDrift.checksumMismatches,pendingMigrations:live.migrationDrift.pending,expectedPending:release.reviewedPending,appliedMigrationCount:names.length,schemaComparisons:meta,rowCountsMatchApprovedSnapshot:sameCounts,originalTableRowHashesMatchPrivateReviewedExport:dataMatches,originalTablesChecked:originalTables.length,statesRemainCanonicalCount:states,specialtiesAndPaymentMethodsStillAbsent:noReferences,allChecksPass:false};
report.allChecksPass=report.migrationHistoryMatches&&!report.unknownMigrations.length&&!report.failedMigrations.length&&!report.checksumMismatches.length&&JSON.stringify(report.pendingMigrations)===JSON.stringify(report.expectedPending)&&Object.values(meta).every(Boolean)&&sameCounts&&dataMatches&&states&&noReferences;
await fs.writeFile('../docs/clinic-readiness/neon-production-release/immediate-predeploy-check.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
if(!report.allChecksPass)process.exitCode=2;
