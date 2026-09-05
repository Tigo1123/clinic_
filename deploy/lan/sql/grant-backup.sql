SELECT format('GRANT USAGE ON SCHEMA %I TO %I', :'schema_name', :'backup_role') \gexec
SELECT format(
  'GRANT SELECT ON TABLE %I.%I TO %I', n.nspname, c.relname, :'backup_role'
)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = :'schema_name' AND c.relkind IN ('r', 'p', 'v', 'm')
ORDER BY c.relname \gexec
SELECT format(
  'GRANT SELECT ON SEQUENCE %I.%I TO %I', n.nspname, c.relname, :'backup_role'
)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = :'schema_name' AND c.relkind = 'S'
ORDER BY c.relname \gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT ON TABLES TO %I',
  current_user, :'schema_name', :'backup_role'
) \gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT ON SEQUENCES TO %I',
  current_user, :'schema_name', :'backup_role'
) \gexec
