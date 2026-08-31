SELECT current_database(), session_user, current_user, inet_server_addr();
SELECT 1 / CASE
  WHEN session_user = :'migration_login_role'
   AND current_user = :'schema_owner_role'
  THEN 1 ELSE 0
END AS migration_identity_verified;
