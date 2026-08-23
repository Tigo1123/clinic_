CREATE OR REPLACE FUNCTION notify_user_auth_version_changed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify(
    'clinic_auth_revocation_v1',
    json_build_object(
      'type', 'AUTH_VERSION_CHANGED',
      'userId', NEW."id",
      'authVersion', NEW."authVersion"
    )::text
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_auth_version_changed_notify
AFTER UPDATE OF "authVersion" ON "User"
FOR EACH ROW
WHEN (OLD."authVersion" IS DISTINCT FROM NEW."authVersion")
EXECUTE FUNCTION notify_user_auth_version_changed();
