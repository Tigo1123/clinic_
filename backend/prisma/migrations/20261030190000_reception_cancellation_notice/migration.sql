-- Cancellation is terminal under the existing appointment transition contract.
-- One semantic event per appointment/recipient, independent of request retries.
-- Notification rows and pg_notify are transactional: rollback publishes nothing.
CREATE FUNCTION clinic_appointment_notice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  key text := 'Appointment:' || NEW.id || ':' || txid_current()::text;
  doctor_ids text[] := array_remove(ARRAY[NEW."doctorId", CASE WHEN TG_OP='UPDATE' THEN OLD."doctorId" ELSE NULL END],NULL);
  kind text;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.status,NEW."doctorId",NEW."appointmentDate",NEW."appointmentTime")
    IS NOT DISTINCT FROM (OLD.status,OLD."doctorId",OLD."appointmentDate",OLD."appointmentTime") THEN RETURN NEW; END IF;

  IF TG_OP='UPDATE' AND NEW.status='CANCELLED' AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM clinic_notify('APPOINTMENT_CANCELLED','APPOINTMENT_CANCELLED:' || NEW.id,
      'Appointment',NEW.id,ARRAY['RECEPTIONIST']);
    UPDATE "Notification" SET title='Appointment cancelled',
      message='An appointment cancellation was completed. Open Reception to review the updated schedule.'
      WHERE "eventKey"='APPOINTMENT_CANCELLED:' || NEW.id AND type='APPOINTMENT_CANCELLED';
    -- Preserve the existing Admin/assigned-doctor update rule, without sending
    -- Reception both a generic update and a cancellation for the same commit.
    PERFORM clinic_notify('APPOINTMENT_CHANGED',key,'Appointment',NEW.id,ARRAY['ADMIN'],doctor_ids);
    RETURN NEW;
  END IF;

  kind := CASE WHEN TG_OP='INSERT' THEN 'APPOINTMENT_BOOKED'
    WHEN NEW.status='CHECKED_IN' THEN 'PATIENT_READY' ELSE 'APPOINTMENT_CHANGED' END;
  PERFORM clinic_notify(kind,key,'Appointment',NEW.id,ARRAY['ADMIN','RECEPTIONIST'],doctor_ids);
  RETURN NEW;
END;
$$;

DROP TRIGGER clinic_workflow_notice ON "Appointment";
CREATE TRIGGER clinic_workflow_notice AFTER INSERT OR UPDATE ON "Appointment"
  FOR EACH ROW EXECUTE FUNCTION clinic_appointment_notice();
