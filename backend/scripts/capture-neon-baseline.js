// Creates private aggregate hashes from the local restore of the Neon export.
// No row values are retained or printed.
import fs from 'node:fs/promises';
import { Client } from 'pg';
import { quoteIdentifier as q } from './assess-database-migration.js';

const directory=(await fs.readFile('/tmp/shifa-migration-rehearsal-location','utf8')).trim();
if(!/^\/tmp\/shifa-migration-private-[A-Za-z0-9]+$/.test(directory)) throw Error('Private snapshot directory required');
const local=JSON.parse(await fs.readFile(directory+'/local.json','utf8'));
if(local.port!==55487||!/^shifa-migration-rehearsal-\d+$/.test(local.name)) throw Error('Local Neon restore required');
const url=new URL('postgresql://127.0.0.1:55487/neon_clone');url.username=local.user;url.password=local.password;
const db=new Client({connectionString:url.href});await db.connect();
try {
  await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await db.query("SET LOCAL TIME ZONE 'UTC'");
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows;
  const result={capturedAt:new Date().toISOString(),source:'local restore of read-only Neon export',tables:{}};
  for(const {tablename} of tables) result.tables[tablename]=(await db.query(`SELECT count(*)::text AS count,md5(coalesce(string_agg(row_to_json(t)::text,chr(10) ORDER BY row_to_json(t)::text),'')) AS digest FROM public.${q(tablename)} t`)).rows[0];
  await db.query('ROLLBACK');
  await fs.writeFile(directory+'/neon-baseline-digests.json',JSON.stringify(result)+'\n',{mode:0o600});
  console.log(JSON.stringify({tables:tables.length,retainedRows:0,privateMode:'0600'}));
} finally { await db.end(); }
