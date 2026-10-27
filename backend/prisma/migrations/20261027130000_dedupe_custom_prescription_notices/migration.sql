-- A prescription containing free-text medication already emits one
-- MEDICATION_REVIEW_REQUIRED notice from PrescribedDrug. Defer the generic
-- prescription notice until commit so we can inspect the complete transaction
-- and avoid a second notice to the same Pharmacy recipients.
DROP TRIGGER clinic_workflow_notice ON "Prescription";

CREATE TRIGGER clinic_workflow_notice
  AFTER UPDATE ON "Prescription"
  FOR EACH ROW EXECUTE FUNCTION clinic_workflow_notice();

CREATE FUNCTION clinic_prescription_insert_notice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Prescription" WHERE id=NEW.id AND status='ACTIVE') THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM "PrescribedDrug" WHERE "prescriptionId"=NEW.id AND "pharmacyReviewStatus"='PENDING_REVIEW') THEN
    RETURN NEW;
  END IF;
  PERFORM clinic_notify('PRESCRIPTION_READY',
    'Prescription:' || NEW.id || ':' || txid_current()::text,
    'Prescription', NEW.id, ARRAY['PHARMACIST']);
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER clinic_workflow_notice_insert
  AFTER INSERT ON "Prescription"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION clinic_prescription_insert_notice();
