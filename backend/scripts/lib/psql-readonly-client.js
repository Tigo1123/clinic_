// A libpq transport for the assessment when node-postgres cannot establish TLS.
// Only session controls and SELECT/SHOW from the fixed assessment are accepted.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export class PsqlReadOnlyClient {
  constructor({ connectionString }) { this.url = new URL(connectionString); this.buffer = ''; }
  async connect() {
    const u = this.url;
    if (u.searchParams.get('options') !== '-c default_transaction_read_only=on') throw new Error('Read-only startup required');
    this.child = spawn('psql', ['-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-P', 'pager=off'], {
      env: { ...process.env, PGHOST: u.hostname, PGPORT: u.port || '5432', PGDATABASE: decodeURIComponent(u.pathname.slice(1)), PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGSSLMODE: u.searchParams.get('sslmode') || 'verify-full', PGSSLROOTCERT: 'system', PGCONNECT_TIMEOUT: '10', PGOPTIONS: '-c default_transaction_read_only=on', PGAPPNAME: 'shifa_read_only_migration_assessment' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => { this.buffer += chunk; this.consume(); });
    // Driver/server messages can contain identifying details. Never forward them.
    this.child.stderr.on('data', () => {});
    this.child.on('error', () => this.fail('PSQL_START_FAILED'));
    this.child.on('exit', code => { this.closed = true; this.fail(code === 0 ? 'PSQL_CLOSED' : 'PSQL_CONNECTION_OR_QUERY_FAILED'); });
    await this.exchange('');
  }
  fail(code) { if (this.pending) { const pending = this.pending; this.pending = null; clearTimeout(pending.timer); pending.reject(Object.assign(new Error('Read-only psql transport failed'), { code })); } }
  consume() {
    if (!this.pending) return;
    const end = this.buffer.indexOf(this.pending.marker + '\n');
    if (end < 0) return;
    const output = this.buffer.slice(0, end).trim();
    this.buffer = this.buffer.slice(end + this.pending.marker.length + 1);
    const pending = this.pending; this.pending = null; clearTimeout(pending.timer); pending.resolve(output);
  }
  exchange(sql) {
    if (this.pending || this.closed) return Promise.reject(Object.assign(new Error('Read-only transport unavailable'), { code: 'PSQL_UNAVAILABLE' }));
    return new Promise((resolve, reject) => {
      const marker = 'shifa_' + randomUUID().replaceAll('-', '');
      const timer = setTimeout(() => { this.fail('PSQL_TIMEOUT'); this.child.kill(); }, 120000);
      this.pending = { marker, resolve, reject, timer };
      this.child.stdin.write(`${sql}\n\\echo ${marker}\n`);
    });
  }
  async query(sql, params = []) {
    for (let index = params.length; index > 0; index--) {
      const literal = params[index - 1] === null ? 'NULL' : "'" + String(params[index - 1]).replaceAll("'", "''") + "'";
      sql = sql.replace(new RegExp('\\$' + index + '(?![0-9])', 'g'), () => literal);
    }
    if (sql === 'SHOW transaction_read_only') sql = "SELECT current_setting('transaction_read_only') AS transaction_read_only";
    if (/^SELECT\s/i.test(sql)) {
      const text = await this.exchange(`SELECT coalesce(json_agg(row_to_json(shifa_rows)), '[]'::json) FROM (${sql}) shifa_rows;`);
      return { rows: JSON.parse(text) };
    }
    if (!/^BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY$|^ROLLBACK$|^SET LOCAL (statement_timeout|lock_timeout) = '\d+s'$|^SET LOCAL TIME ZONE 'UTC'$/.test(sql)) throw Object.assign(new Error('Unsupported read-only assessment statement'), { code: 'PSQL_STATEMENT_REFUSED' });
    await this.exchange(sql + ';');
    return { rows: [] };
  }
  async end() { if (this.child && !this.closed) { this.child.stdin.end('\\q\n'); this.child.kill(); } }
}
