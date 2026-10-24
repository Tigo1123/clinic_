// Only the explicit Neon policy permits provider-managed CREATEDB/CREATEROLE.
// Hostname/provider correspondence is checked at startup by validateEnvironment.
export function productionDatabaseIdentityReady(identity, { databaseProvider, runtimeDatabaseRole }) {
  if (!['neon', 'self-managed'].includes(databaseProvider)) return false;
  if (!identity || identity.database !== 'neondb' || identity.schema !== 'public'
      || identity.role !== runtimeDatabaseRole || identity.superuser !== false
      || identity.limiter_table_access !== true) return false;
  return databaseProvider === 'neon'
    || (identity.can_create_roles === false && identity.can_create_databases === false);
}
