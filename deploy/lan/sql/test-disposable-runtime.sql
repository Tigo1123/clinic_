\set ON_ERROR_STOP on
\if :{?expected_database}
\else
  \echo 'expected_database is required for the disposable runtime test.'
  \quit 3
\endif
\if :{?expected_runtime_login}
\else
  \echo 'expected_runtime_login is required for the disposable runtime test.'
  \quit 3
\endif

-- This non-mutating guard must succeed before the destructive test block.
SELECT 1 / CASE
  WHEN current_database() = :'expected_database'
   AND current_database() ~ '^clinic_lan_phase1a4_test_[A-Za-z0-9_]+$'
   AND session_user = :'expected_runtime_login'
   AND current_user = :'expected_runtime_login'
  THEN 1 ELSE 0
END AS disposable_database_identity_verified;

DO $test$
DECLARE
  first_patient_id text;
  second_patient_id text;
  first_file_number text;
  second_file_number text;
  blocked boolean;
BEGIN
  INSERT INTO "State" (id, "labelAr", "labelEn")
  VALUES (18, 'Disposable local test state', 'Disposable local test state');

  INSERT INTO "Patient" (
    id, "fullNameAr", "fullNameEn", gender, "dateOfBirth", phone,
    "addressStateId", "emergencyContact"
  ) VALUES (
    gen_random_uuid()::text, 'Disposable Patient One', 'Disposable Patient One',
    'FEMALE', '1990-01-01', '+249900000001', 18, 'Self'
  ) RETURNING id, "fileNumber" INTO first_patient_id, first_file_number;

  INSERT INTO "Patient" (
    id, "fullNameAr", "fullNameEn", gender, "dateOfBirth", phone,
    "addressStateId", "emergencyContact"
  ) VALUES (
    gen_random_uuid()::text, 'Disposable Patient Two', 'Disposable Patient Two',
    'MALE', '1991-01-01', '+249900000002', 18, 'Self'
  ) RETURNING id, "fileNumber" INTO second_patient_id, second_file_number;

  IF first_file_number !~ '^SHF-[0-9]{6}$'
     OR second_file_number !~ '^SHF-[0-9]{6}$'
     OR first_file_number = second_file_number THEN
    RAISE EXCEPTION 'MRN generation verification failed';
  END IF;

  UPDATE "Patient" SET "addressDetails" = 'runtime update allowed'
  WHERE id = first_patient_id;

  blocked := false;
  BEGIN
    UPDATE "Patient" SET "fileNumber" = 'SHF-999999' WHERE id = first_patient_id;
  EXCEPTION WHEN OTHERS THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'MRN immutability was not enforced'; END IF;

  blocked := false;
  BEGIN PERFORM setval('patient_file_number_seq', 999999, true);
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'runtime setval was not denied'; END IF;

  blocked := false;
  BEGIN EXECUTE 'CREATE TABLE runtime_forbidden_create (id integer)';
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'runtime CREATE TABLE was not denied'; END IF;

  blocked := false;
  BEGIN EXECUTE 'ALTER TABLE "Patient" ADD COLUMN runtime_forbidden_alter integer';
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'runtime ALTER TABLE was not denied'; END IF;

  blocked := false;
  BEGIN EXECUTE 'DROP TABLE "Patient"';
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'runtime DROP TABLE was not denied'; END IF;

  DELETE FROM "Patient" WHERE id IN (first_patient_id, second_patient_id);
  DELETE FROM "State" WHERE id = 18;
END
$test$;
