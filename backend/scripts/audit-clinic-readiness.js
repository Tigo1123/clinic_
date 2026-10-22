import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Client } from 'pg';

const root = new URL('../', import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
const identifier = value => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error('Invalid audit schema identifier.');
  return `"${value}"`;
};

export async function repositoryInventory() {
  const schema = await fs.readFile(new URL('prisma/schema.prisma', root), 'utf8');
  const blocks = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)];
  const names = new Set(blocks.map(match => match[1]));
  const models = blocks.map(([, name, body]) => ({
    name,
    fields: body.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('//')),
    relationships: [...body.matchAll(/^[ \t]*(\w+)[ \t]+(\w+)(\[\]|\?)?[ \t]*([^\n]*)$/gm)]
      .filter(match => names.has(match[2]))
      .map(([, field, target, cardinality, annotation]) => ({ field, target, cardinality: cardinality === '[]' ? 'many' : cardinality === '?' ? 'optional' : 'required', annotation: annotation.trim() })),
  }));
  const directory = new URL('prisma/migrations/', root);
  const migrations = [];
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const sql = await fs.readFile(new URL(`${entry.name}/migration.sql`, directory), 'utf8');
    migrations.push({ name: entry.name, checksum: hash(sql) });
  }
  return { schemaChecksum: hash(schema), modelCount: models.length, models, migrations };
}

// Explicit URL only. Never falls back to DATABASE_URL or imports application startup.
// Results contain schema metadata and aggregate counts, never application rows.
export async function inspectDatabase({ connectionString, inventory, clientFactory = config => new Client(config) }) {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('PostgreSQL audit URL required.');
  const schema = url.searchParams.get('schema') || 'public';
  identifier(schema);
  const client = clientFactory({ connectionString, connectionTimeoutMillis: 15000, query_timeout: 15000 });
  try {
    await client.connect();
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '10s'");
    const readOnly = (await client.query('SHOW transaction_read_only')).rows[0]?.transaction_read_only;
    if (readOnly !== 'on') throw new Error('Audit requires a read-only transaction.');
    const tables = (await client.query('SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = $1', [schema])).rows.map(row => row.tablename);
    const counts = {};
    for (const model of inventory.models) {
      counts[model.name] = tables.includes(model.name)
        ? (await client.query(`SELECT count(*)::text AS count FROM ${identifier(schema)}.${identifier(model.name)}`)).rows[0].count
        : null;
    }
    const history = tables.includes('_prisma_migrations')
      ? (await client.query(`SELECT migration_name, checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM ${identifier(schema)}."_prisma_migrations" ORDER BY started_at`)).rows
      : [];
    return {
      readOnly: true,
      target: { neon: url.hostname.endsWith('.neon.tech'), local: ['localhost', '127.0.0.1'].includes(url.hostname), fingerprint: hash(`${url.hostname}/${url.pathname}/${schema}`).slice(0, 16), schema },
      counts,
      migrations: {
        applied: history.filter(row => row.finished && !row.rolled_back).map(row => row.migration_name),
        failed: history.filter(row => !row.finished && !row.rolled_back).map(row => row.migration_name),
        pending: inventory.migrations.filter(m => !history.some(row => row.migration_name === m.name && row.finished && !row.rolled_back)).map(m => m.name),
        checksumMismatches: history.filter(row => row.finished && !row.rolled_back && inventory.migrations.some(m => m.name === row.migration_name && m.checksum !== row.checksum)).map(row => row.migration_name),
        unknownApplied: history.filter(row => row.finished && !row.rolled_back && !inventory.migrations.some(m => m.name === row.migration_name)).map(row => row.migration_name),
      },
    };
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const inventory = await repositoryInventory();
    if (process.argv.includes('--schema-only')) console.log(JSON.stringify(inventory, null, 2));
    else {
      if (!process.env.CLINIC_AUDIT_DATABASE_URL) throw new Error('Explicit CLINIC_AUDIT_DATABASE_URL required.');
      console.log(JSON.stringify(await inspectDatabase({ connectionString: process.env.CLINIC_AUDIT_DATABASE_URL, inventory }), null, 2));
    }
  } catch {
    console.error('Read-only clinic audit failed. No recovery or database writes were attempted.');
    process.exitCode = 1;
  }
}
