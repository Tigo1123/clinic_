SELECT format(
  'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO %I',
  namespace.nspname, relation.relname, :'runtime_role'
)
FROM pg_class AS relation
JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = :'schema_name'
  AND relation.relkind IN ('r', 'p')
  AND relation.relname <> '_prisma_migrations'
ORDER BY relation.relname
\gexec

SELECT format(
  'REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I FROM %I',
  :'schema_name', '_prisma_migrations', :'runtime_role'
)
WHERE to_regclass(format('%I.%I', :'schema_name', '_prisma_migrations')) IS NOT NULL
\gexec
