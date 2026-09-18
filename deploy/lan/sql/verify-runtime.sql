SELECT current_database(), session_user, current_user, inet_server_addr();

SELECT 1 / CASE WHEN
  current_database() = :'database_name'
  AND session_user = :'runtime_login_role'
  AND current_user = :'runtime_login_role'
  AND has_database_privilege(current_user, current_database(), 'CONNECT')
  AND has_schema_privilege(current_user, :'schema_name', 'USAGE')
  AND NOT has_schema_privilege(current_user, :'schema_name', 'CREATE')
  AND has_table_privilege(current_user, format('%I.%I', :'schema_name', 'Patient'), 'SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege(current_user, format('%I.%I', :'schema_name', '_prisma_migrations'), 'SELECT')
  AND has_sequence_privilege(current_user, format('%I.%I', :'schema_name', 'patient_file_number_seq'), 'USAGE')
  AND NOT has_sequence_privilege(current_user, format('%I.%I', :'schema_name', 'patient_file_number_seq'), 'UPDATE')
  AND NOT has_sequence_privilege(current_user, format('%I.%I', :'schema_name', 'patient_file_number_seq'), 'SELECT')
  AND NOT pg_has_role(current_user, :'schema_owner_role', 'MEMBER')
  AND NOT pg_has_role(current_user, :'migration_login_role', 'MEMBER')
  AND NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname IN (:'runtime_role', :'runtime_login_role')
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication)
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = :'schema_name'
      AND relation.relkind IN ('r', 'p', 'S')
      AND pg_get_userbyid(relation.relowner) IN (:'runtime_role', :'runtime_login_role')
  )
THEN 1 ELSE 0 END AS runtime_least_privilege_verified;
