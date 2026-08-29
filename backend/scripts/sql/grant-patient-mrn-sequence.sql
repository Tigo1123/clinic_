-- The Patient file-number default calls nextval(). Table INSERT permission
-- does not grant sequence access, so each environment names its runtime role.
SELECT format(
  'GRANT USAGE ON SEQUENCE %I.%I TO %I',
  :'schema_name', 'patient_file_number_seq', :'runtime_role'
) \gexec

-- Fail closed if the runtime can update or owns the sequence.
SELECT 1 / CASE
  WHEN has_sequence_privilege(
    :'runtime_role',
    format('%I.%I', :'schema_name', 'patient_file_number_seq'),
    'USAGE'
  )
  AND NOT has_sequence_privilege(
    :'runtime_role',
    format('%I.%I', :'schema_name', 'patient_file_number_seq'),
    'UPDATE'
  )
  AND (
    SELECT pg_get_userbyid(sequence.relowner) <> :'runtime_role'
    FROM pg_class AS sequence
    JOIN pg_namespace AS namespace ON namespace.oid = sequence.relnamespace
    WHERE namespace.nspname = :'schema_name'
      AND sequence.relname = 'patient_file_number_seq'
      AND sequence.relkind = 'S'
  )
  THEN 1 ELSE 0
END AS patient_mrn_sequence_privilege_verified;
