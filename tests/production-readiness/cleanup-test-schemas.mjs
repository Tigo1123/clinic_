import { assertDestructiveStaging } from './safety-guards.mjs';
import pg from '../../backend/node_modules/pg/lib/index.js';

const value = process.env.TEST_DATABASE_URL;
assertDestructiveStaging(process.env, value, 'clinic_test');
if (!value) throw new Error('TEST_DATABASE_URL is required.');
const url = new URL(value);
if (url.hostname !== '127.0.0.1' || url.port !== '55439' || url.pathname !== '/clinic_test') {
  throw new Error('Refusing cleanup outside the guarded loopback clinic_test database.');
}

const client = new pg.Client({ connectionString: url.href });
await client.connect();
try {
  const { rows } = await client.query(
    "SELECT nspname FROM pg_namespace WHERE nspname ~ '^(test|schedule_workflow)_[a-z0-9_]+$'",
  );
  for (const { nspname } of rows) {
    if (!/^(test|schedule_workflow)_[a-z0-9_]+$/.test(nspname)) {
      throw new Error('Unexpected namespace matched the isolated cleanup query.');
    }
    await client.query(`DROP SCHEMA "${nspname}" CASCADE`);
  }
  console.log(`Removed ${rows.length} isolated test schemas.`);
} finally {
  await client.end();
}
