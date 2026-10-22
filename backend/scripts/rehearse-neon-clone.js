// Local-only validation of an already-restored Neon baseline and its upgrade.
// Never imports application config, loads production URLs, seeds or merges data.
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { quoteIdentifier as q } from './assess-database-migration.js';
import { REFERENCE_BOOTSTRAP_STATES } from '../src/services/referenceBootstrap.js';

const directory = (await fs.readFile('/tmp/shifa-migration-rehearsal-location', 'utf8')).trim();
if (!/^\/tmp\/shifa-migration-private-[A-Za-z0-9]+$/.test(directory)) throw new Error('Private rehearsal directory required');
const local = JSON.parse(await fs.readFile(directory + '/local.json', 'utf8'));
if (local.port !== 55487 || !/^shifa-migration-rehearsal-\d+$/.test(local.name)) throw new Error('Isolated rehearsal target required');
const key = randomBytes(32);
const url = database => {
  if (!['neon_clone', 'neon_upgrade'].includes(database)) throw new Error('Local database refused');
  const value = new URL(`postgresql://127.0.0.1:55487/${database}`);
  value.username = local.user; value.password = local.password;
  return value.href;
};

async function capture(database) {
  const client = new Client({ connectionString: url(database) });
  await client.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='20s'");
    const tables = (await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`)).rows.map(t => t.tablename);
    const snapshots = {}, counts = {}, foreignKeys = [], uniqueness = [];
    for (const table of tables) {
      const rows = (await client.query(`SELECT row_to_json(t)::text AS data FROM public.${q(table)} t ORDER BY row_to_json(t)::text`)).rows;
      snapshots[table] = createHmac('sha256', key).update(JSON.stringify(rows)).digest('hex');
      counts[table] = rows.length;
    }
    const fks = (await client.query(`SELECT x.conname AS name,c.relname AS child,p.relname AS parent, array(SELECT a.attname::text FROM unnest(x.conkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.num ORDER BY k.ord) AS child_columns,array(SELECT a.attname::text FROM unnest(x.confkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=p.oid AND a.attnum=k.num ORDER BY k.ord) AS parent_columns,x.convalidated AS validated FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class p ON p.oid=x.confrelid WHERE n.nspname='public' AND x.contype='f' ORDER BY x.conname`)).rows;
    for (const fk of fks) {
      const notNull = fk.child_columns.map(col => `c.${q(col)} IS NOT NULL`).join(' AND ');
      const equality = fk.child_columns.map((col, i) => `c.${q(col)}=p.${q(fk.parent_columns[i])}`).join(' AND ');
      const result = (await client.query(`SELECT count(*)::text AS orphans FROM public.${q(fk.child)} c WHERE ${notNull} AND NOT EXISTS (SELECT 1 FROM public.${q(fk.parent)} p WHERE ${equality})`)).rows[0];
      foreignKeys.push({ name: fk.name, validated: fk.validated, ...result });
    }
    const indexes = (await client.query(`SELECT i.indexrelid,c.relname AS table_name,ic.relname AS name,i.indisvalid AS valid,i.indnullsnotdistinct AS nulls_not_distinct,pg_get_expr(i.indpred,i.indrelid) AS predicate,array(SELECT pg_get_indexdef(i.indexrelid,k,true) FROM generate_series(1,i.indnkeyatts) k) AS keys FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class ic ON ic.oid=i.indexrelid WHERE n.nspname='public' AND i.indisunique ORDER BY ic.relname`)).rows;
    for (const index of indexes) {
      const nonNull = index.nulls_not_distinct ? 'true' : index.keys.map(expr => `(${expr}) IS NOT NULL`).join(' AND ');
      const result = (await client.query(`SELECT count(*)::text AS duplicate_groups FROM (SELECT ${index.keys.join(',')} FROM public.${q(index.table_name)} WHERE (${index.predicate || 'true'}) AND (${nonNull}) GROUP BY ${index.keys.join(',')} HAVING count(*)>1) duplicates`)).rows[0];
      uniqueness.push({ name: index.name, valid: index.valid, ...result });
    }
    const states = (await client.query('SELECT id,"labelAr","labelEn" FROM public."State" ORDER BY id')).rows;
    const columns = (await client.query(`SELECT table_name,column_name,data_type,numeric_precision,numeric_scale,datetime_precision FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`)).rows;
    const money = [];
    for (const col of columns.filter(c => c.data_type === 'numeric')) money.push({ table: col.table_name, column: col.column_name, precision: col.numeric_precision, scale: col.numeric_scale, ...(await client.query(`SELECT count(${q(col.column_name)})::text AS populated,sum(${q(col.column_name)})::text AS total,min(${q(col.column_name)})::text AS min,max(${q(col.column_name)})::text AS max FROM public.${q(col.table_name)}`)).rows[0] });
    const scalarAuditOrphans = (await client.query(`SELECT count(*)::text AS unresolved_actor_ids FROM public."TenantAuditLog" a WHERE a."userId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public."User" u WHERE u.id=a."userId")`)).rows[0];
    const sequence = (await client.query(`SELECT (SELECT last_value::text FROM public.patient_file_number_seq) AS last_value,(SELECT is_called FROM public.patient_file_number_seq) AS is_called,(SELECT max(substring("fileNumber" FROM '[0-9]+$')::bigint)::text FROM public."Patient") AS largest_patient_suffix`)).rows[0];
    await client.query('ROLLBACK');
    return { snapshots, counts, foreignKeys, uniqueness, money, scalarAuditOrphans, sequence, statesCanonical: JSON.stringify(states) === JSON.stringify(REFERENCE_BOOTSTRAP_STATES), columns };
  } finally { await client.end(); }
}

const baseline = await capture('neon_clone');
const before = await capture('neon_upgrade');
const matchesBaseline = Object.keys(baseline.snapshots).every(t => baseline.snapshots[t] === before.snapshots[t]);
if (!matchesBaseline) throw new Error('Restored baseline differs; refusing local migration');
const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url('neon_upgrade'), DIRECT_URL: url('neon_upgrade') }, encoding: 'utf8', timeout: 120000, maxBuffer: 10000000 });
await fs.writeFile(directory + '/neon-local-upgrade.log', (migration.stdout || '') + (migration.stderr || ''), { mode: 0o600 });
if (migration.status !== 0) throw new Error('Local Neon clone upgrade failed; inspect private local log');
const after = await capture('neon_upgrade');
const preserved = Object.keys(before.snapshots).filter(t => t !== '_prisma_migrations').map(table => ({ table, before: before.counts[table], after: after.counts[table], exactRowsPreserved: before.snapshots[table] === after.snapshots[table] }));
const report = {
  capturedAt: new Date().toISOString(), scope: 'Neon export restored and upgraded locally; Render source unavailable; no merge rehearsed',
  container: local.name, port: local.port, originalCloneUnchanged: true, baselineMatchesUpgradeInput: matchesBaseline,
  localMigrationExit: migration.status, baselineCounts: baseline.counts, upgradedCounts: after.counts,
  preservation: preserved, passwordHashesAuthVersionsIdentitiesAndTimestampsPreserved: ['User','Patient','UserExternalIdentity','PatientRegistration','VerificationChallenge','PendingExternalAuth'].every(t => before.snapshots[t] === after.snapshots[t]),
  canonicalStatesPreserved: baseline.statesCanonical && after.statesCanonical, foreignKeys: after.foreignKeys, uniqueness: after.uniqueness,
  money: after.money, scalarAuditOrphans: after.scalarAuditOrphans, patientFileSequence: { before: before.sequence, after: after.sequence },
  columnChanges: { added: after.columns.filter(c => !before.columns.some(b => b.table_name===c.table_name && b.column_name===c.column_name)), changed: after.columns.filter(c => before.columns.some(b => b.table_name===c.table_name && b.column_name===c.column_name && JSON.stringify(b)!==JSON.stringify(c))) },
};
report.passed = preserved.every(t => t.exactRowsPreserved) && report.canonicalStatesPreserved && report.passwordHashesAuthVersionsIdentitiesAndTimestampsPreserved && after.foreignKeys.every(f => f.orphans === '0' && f.validated) && after.uniqueness.every(i => i.duplicate_groups === '0' && i.valid);
await fs.writeFile('../docs/clinic-readiness/render-neon-assessment/local-neon-rehearsal.json', JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ passed: report.passed, tablesPreserved: preserved.length, foreignKeys: after.foreignKeys.length, uniqueIndexes: after.uniqueness.length, scalarAuditOrphans: after.scalarAuditOrphans }));
if (!report.passed) process.exitCode=1;
