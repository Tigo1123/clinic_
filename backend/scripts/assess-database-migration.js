// Remote assessment only: no application imports, migration, seed or write path.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { repositoryInventory } from './audit-clinic-readiness.js';

export const quoteIdentifier = value => '"' + String(value).replaceAll('"', '""') + '"';
export function assessmentConnection(connectionString) {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('PostgreSQL URL required');
  const schema = url.searchParams.get('schema') || 'public';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) throw new Error('Unsafe schema');
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    // Remote URLs without sslmode must still use verified TLS.
    if (!url.searchParams.has('sslmode') || url.searchParams.get('sslmode') === 'require') url.searchParams.set('sslmode', 'verify-full');
    if (url.searchParams.get('sslmode') === 'disable') throw new Error('Remote TLS required');
  }
  // Enforce read-only from connection startup, as well as in the transaction.
  url.searchParams.set('options', '-c default_transaction_read_only=on');
  const fingerprint = createHash('sha256').update(`${url.hostname}/${url.pathname}/${schema}`).digest('hex').slice(0, 16);
  return { schema, fingerprint, connectionString: url.href };
}

export async function assessDatabase(connectionString, { clientFactory = config => new Client(config) } = {}) {
  const connection = assessmentConnection(connectionString);
  const client = clientFactory({ connectionString: connection.connectionString, connectionTimeoutMillis: 15000, query_timeout: 15000, application_name: 'shifa_read_only_migration_assessment' });
  const report = { capturedAt: new Date().toISOString(), fingerprint: connection.fingerprint, schema: connection.schema, status: 'connecting', readOnly: false, tables: [], errors: [] };
  const q = quoteIdentifier;
  let stage = 'connect';
  try {
    await client.connect();
    stage = 'begin_read_only';
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    if ((await client.query('SHOW transaction_read_only')).rows[0]?.transaction_read_only !== 'on') throw Object.assign(new Error('Read-only mode required'), { code: 'READ_ONLY_REQUIRED' });
    report.readOnly = true;
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query("SET LOCAL lock_timeout = '3s'");
    stage = 'inventory';
    report.identity = (await client.query(`SELECT current_database() AS database, current_schema() AS default_schema, current_setting('server_version') AS server_version, current_setting('TimeZone') AS timezone, pg_is_in_recovery() AS replica, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS role_superuser, (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS role_bypass_rls`)).rows[0];
    report.schemas = (await client.query(`SELECT nspname AS name FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' ORDER BY nspname`)).rows;
    report.columns = (await client.query(`SELECT table_name, column_name, ordinal_position, data_type, udt_name, is_nullable, column_default, numeric_precision, numeric_scale, datetime_precision FROM information_schema.columns WHERE table_schema=$1 ORDER BY table_name, ordinal_position`, [connection.schema])).rows;
    report.constraints = (await client.query(`SELECT c.relname AS table_name, x.conname AS name, x.contype AS type, x.convalidated AS validated, pg_get_constraintdef(x.oid, true) AS definition FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname, x.conname`, [connection.schema])).rows;
    report.indexes = (await client.query(`SELECT c.relname AS table_name, i.relname AS name, x.indisunique AS unique, x.indisprimary AS primary, x.indisvalid AS valid, pg_get_indexdef(x.indexrelid) AS definition FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname,i.relname`, [connection.schema])).rows;
    report.enums = (await client.query(`SELECT n.nspname AS schema, t.typname AS name, e.enumlabel AS label, e.enumsortorder AS position FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 ORDER BY t.typname,e.enumsortorder`, [connection.schema])).rows;
    report.triggers = (await client.query(`SELECT c.relname AS table_name,t.tgname AS name,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`, [connection.schema])).rows;
    report.functions = (await client.query(`SELECT p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,md5(pg_get_functiondef(p.oid)) AS definition_hash,p.prosecdef AS security_definer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.prokind IN ('f','p') ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)`, [connection.schema])).rows;
    report.sequences = (await client.query(`SELECT sequencename AS name,data_type::text,start_value::text,min_value::text,max_value::text,increment_by::text,cycle,cache_size::text FROM pg_sequences WHERE schemaname=$1 ORDER BY sequencename`, [connection.schema])).rows;
    report.policies = (await client.query(`SELECT tablename,policyname,permissive,roles::text,cmd,md5(coalesce(qual,'')) AS qualification_hash,md5(coalesce(with_check,'')) AS check_hash FROM pg_policies WHERE schemaname=$1 ORDER BY tablename,policyname`, [connection.schema])).rows;
    const tables = (await client.query(`SELECT c.relname AS name,c.relrowsecurity AS row_security,c.relforcerowsecurity AS forced_row_security,has_table_privilege(c.oid,'SELECT') AS can_select FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN ('r','p') ORDER BY c.relname`, [connection.schema])).rows;
    for (const table of tables) {
      const entry = { ...table, count: null, dates: {}, statuses: {}, primaryKeyFormats: [] };
      report.tables.push(entry);
      if (!table.can_select || table.row_security) { entry.limitation = 'Counts may be restricted by privileges/RLS; no unrestricted inventory claim'; if (!table.can_select) continue; }
      const qualified = `${q(connection.schema)}.${q(table.name)}`;
      entry.count = (await client.query(`SELECT count(*)::text AS count FROM ${qualified}`)).rows[0].count;
      const columns = report.columns.filter(c => c.table_name === table.name);
      for (const col of columns.filter(c => /^(createdAt|updatedAt|visitDate|orderDate|prescriptionDate|appointmentDate|invoiceDate|paidAt|releasedToPatientAt|started_at|finished_at)$/.test(c.column_name) && /timestamp|date/.test(c.data_type))) {
        entry.dates[col.column_name] = (await client.query(`SELECT min(${q(col.column_name)})::text AS min,max(${q(col.column_name)})::text AS max FROM ${qualified}`)).rows[0];
      }
      if (table.name !== '_prisma_migrations') {
        for (const col of columns.filter(c => /^(status|role|paymentMethod|refundMethod|category|reviewStatus|dispensingStatus)$/.test(c.column_name))) {
          entry.statuses[col.column_name] = (await client.query(`SELECT ${q(col.column_name)}::text AS value,count(*)::text AS count FROM ${qualified} GROUP BY ${q(col.column_name)} ORDER BY count(*) DESC LIMIT 50`)).rows;
        }
        const pk = (await client.query(`SELECT a.attname AS name FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(num,ord) ON true JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.num WHERE n.nspname=$1 AND t.relname=$2 AND i.indisprimary ORDER BY k.ord`, [connection.schema, table.name])).rows;
        for (const col of pk) entry.primaryKeyFormats.push({ column: col.name, ...(await client.query(`SELECT count(*) FILTER (WHERE ${q(col.name)}::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')::text AS uuid,count(*) FILTER (WHERE ${q(col.name)}::text ~ '^[0-9]+$')::text AS integer,min(length(${q(col.name)}::text)) AS min_length,max(length(${q(col.name)}::text)) AS max_length FROM ${qualified}`)).rows[0] });
      }
    }
    if (tables.some(t => t.name === '_prisma_migrations' && t.can_select)) {
      report.migrationHistory = (await client.query(`SELECT migration_name,checksum,started_at,finished_at,rolled_back_at,applied_steps_count FROM ${q(connection.schema)}."_prisma_migrations" ORDER BY started_at`)).rows;
      const repository = await repositoryInventory();
      const applied = report.migrationHistory.filter(m => m.finished_at && !m.rolled_back_at);
      report.migrationDrift = {
        pending: repository.migrations.filter(m => !applied.some(a => a.migration_name === m.name)).map(m => m.name),
        unknown: applied.filter(a => !repository.migrations.some(m => m.name === a.migration_name)).map(a => a.migration_name),
        checksumMismatches: applied.filter(a => repository.migrations.some(m => m.name === a.migration_name && m.checksum !== a.checksum)).map(a => a.migration_name),
        failed: report.migrationHistory.filter(a => !a.finished_at && !a.rolled_back_at).map(a => a.migration_name),
      };
    }
    report.status = 'complete';
  } catch (error) {
    // Never serialize a driver error/message/stack: these may include credentials.
    report.status = report.readOnly ? 'incomplete' : 'connection_failed';
    const reasons = [
      [/unsupported startup parameter/i, 'unsupported_startup_parameter'],
      [/password authentication failed/i, 'authentication_failed'],
      [/certificate/i, 'certificate_verification_failed'],
      [/terminated unexpectedly/i, 'connection_terminated'],
      [/timeout|timed out/i, 'timeout'],
      [/SSL.*required|no encryption/i, 'tls_required'],
      [/endpoint.*disabled|suspended/i, 'endpoint_unavailable'],
    ];
    report.errors.push({ stage, code: /^[A-Z0-9_]{2,60}$/.test(error.code || '') ? error.code : 'ASSESSMENT_FAILED', reason: reasons.find(([pattern]) => pattern.test(error.message || ''))?.[1] || 'unclassified' });
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.CLINIC_ASSESS_DATABASE_URL || !process.env.CLINIC_ASSESS_OUTPUT) {
    console.error('Explicit CLINIC_ASSESS_DATABASE_URL and CLINIC_ASSESS_OUTPUT required.');
    process.exitCode = 1;
  } else {
    try {
      const report = await assessDatabase(process.env.CLINIC_ASSESS_DATABASE_URL);
      await fs.writeFile(process.env.CLINIC_ASSESS_OUTPUT, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
      console.log(JSON.stringify({ status: report.status, readOnly: report.readOnly, tableCount: report.tables.length, errors: report.errors }));
      if (report.status !== 'complete') process.exitCode = 1;
    } catch { console.error('Assessment refused; no database write attempted.'); process.exitCode = 1; }
  }
}
