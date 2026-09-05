SELECT current_database(), session_user, current_user, inet_server_addr();
SELECT 1 / CASE WHEN
  session_user = :'backup_login_role'
  AND current_user = :'backup_login_role'
  AND has_schema_privilege(current_user, :'schema_name', 'USAGE')
  AND NOT has_schema_privilege(current_user, :'schema_name', 'CREATE')
  AND has_table_privilege(current_user, format('%I.%I', :'schema_name', '_prisma_migrations'), 'SELECT')
  AND NOT has_table_privilege(current_user, format('%I.%I', :'schema_name', '_prisma_migrations'), 'INSERT,UPDATE,DELETE')
  AND NOT pg_has_role(current_user, :'schema_owner_role', 'MEMBER')
  AND NOT pg_has_role(current_user, :'migration_login_role', 'MEMBER')
  AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN (:'backup_role', :'backup_login_role')
    AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication))
  AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=:'schema_name' AND c.relkind IN ('r','p','S','v','m')
      AND (NOT has_table_privilege(current_user, c.oid, 'SELECT')
        OR (c.relkind IN ('r','p') AND has_table_privilege(current_user, c.oid, 'INSERT,UPDATE,DELETE'))
        OR pg_get_userbyid(c.relowner) IN (:'backup_role', :'backup_login_role')))
THEN 1 ELSE 0 END AS backup_least_privilege_verified;
