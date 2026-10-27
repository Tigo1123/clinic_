-- Run with the migration identity, explicit reviewed psql variables, and the
-- same schema/runtime login used by the application. No ownership or DDL grants.
SELECT format('GRANT SELECT, INSERT, UPDATE ON TABLE %I.%I TO %I', :'schema_name', 'Notification', :'runtime_role') \gexec
SELECT format('GRANT SELECT, INSERT, UPDATE ON TABLE %I.%I TO %I', :'schema_name', 'StockNotificationState', :'runtime_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION %I.clinic_notify(text,text,text,text,text[],text[]) TO %I', :'schema_name', :'runtime_role') \gexec
