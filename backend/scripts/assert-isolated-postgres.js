export function assertIsolatedPostgres({ purpose, requiredDatabaseFragment, requiredSchemaPrefix }) {
  if (process.env.NODE_ENV === 'production') throw new Error(`${purpose} refused in production.`);
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error(`${purpose} refused: DATABASE_URL is required.`);
  const url = new URL(rawUrl);
  const databaseName = url.pathname.slice(1).toLowerCase();
  const schema = url.searchParams.get('schema') || '';
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || !databaseName.includes(requiredDatabaseFragment) || !schema.startsWith(requiredSchemaPrefix) || !/^[a-zA-Z0-9_]+$/.test(schema)) {
    throw new Error(`${purpose} refused: use a localhost PostgreSQL database named for ${requiredDatabaseFragment} with an explicit ${requiredSchemaPrefix}* schema.`);
  }
  return { schema };
}
