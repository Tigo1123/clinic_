SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', :'database_name') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'database_name', :'schema_owner_role') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'database_name', :'migration_login_role') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'database_name', :'runtime_role') \gexec

SELECT format('ALTER SCHEMA %I OWNER TO %I', :'schema_name', :'schema_owner_role') \gexec
SELECT format('REVOKE CREATE ON SCHEMA %I FROM PUBLIC', :'schema_name') \gexec
SELECT format('REVOKE CREATE ON SCHEMA %I FROM %I', :'schema_name', :'runtime_role') \gexec
SELECT format('GRANT USAGE ON SCHEMA %I TO %I', :'schema_name', :'runtime_role') \gexec

SELECT format('ALTER ROLE %I IN DATABASE %I SET ROLE TO %L', :'migration_login_role', :'database_name', :'schema_owner_role') \gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
  :'schema_owner_role', :'schema_name', :'runtime_role'
) \gexec
