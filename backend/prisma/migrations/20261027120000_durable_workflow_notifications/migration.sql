ALTER TABLE "Notification" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "entityType" TEXT, ADD COLUMN "entityId" TEXT, ADD COLUMN "eventKey" TEXT;
-- Prisma DateTime uses timestamp without time zone. Keep new instants in UTC
-- even when the database session's TimeZone is not UTC. Do not rewrite history.
ALTER TABLE "Notification" ALTER COLUMN "createdAt" SET DEFAULT timezone('UTC'::text, CURRENT_TIMESTAMP);
CREATE INDEX "Notification_userId_createdAt_id_idx" ON "Notification"("userId", "createdAt", "id");
CREATE UNIQUE INDEX "Notification_userId_eventKey_key" ON "Notification"("userId", "eventKey");
CREATE TABLE "StockNotificationState" ("drugId" TEXT PRIMARY KEY, "state" TEXT NOT NULL DEFAULT 'UNKNOWN', "revision" INTEGER NOT NULL DEFAULT 0);

-- These are ordinary SECURITY INVOKER functions: no privilege escalation.
-- Notices are part of the source transaction, like existing audit records.
CREATE FUNCTION clinic_notify(kind text, event_key text, entity_type text, entity_id text,
  roles text[], doctor_ids text[] DEFAULT '{}') RETURNS void LANGUAGE sql AS $$
  INSERT INTO "Notification" (id,"userId",title,message,type,"entityType","entityId","eventKey")
  SELECT gen_random_uuid()::text, recipients.id, 'Operational update',
    'Open the relevant workspace to review this update.', kind, entity_type, entity_id, event_key
  FROM (
    SELECT id FROM "User" WHERE status='ACTIVE' AND role=ANY(roles)
    UNION
    SELECT u.id FROM "User" u JOIN "Doctor" d ON d."userId"=u.id
      WHERE u.status='ACTIVE' AND u.role='DOCTOR' AND d.id=ANY(doctor_ids)
  ) recipients ON CONFLICT ("userId","eventKey") DO NOTHING;
$$;

CREATE FUNCTION clinic_notification_committed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW."isRead" IS DISTINCT FROM OLD."isRead" THEN
    -- PostgreSQL delivers NOTIFY only after commit; rollback emits nothing.
    PERFORM pg_notify('clinic_notifications_v1', json_build_object('id',NEW.id,
      'change',CASE WHEN TG_OP='INSERT' THEN 'created' ELSE 'read' END)::text);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER clinic_notification_committed AFTER INSERT OR UPDATE ON "Notification"
  FOR EACH ROW EXECUTE FUNCTION clinic_notification_committed();

CREATE FUNCTION clinic_workflow_notice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  n jsonb := to_jsonb(NEW); o jsonb := CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  key text := TG_TABLE_NAME || ':' || (n->>'id') || ':' || txid_current()::text;
  doctor_ids text[] := '{}'; kind text; entity_type text := TG_TABLE_NAME; entity_id text := n->>'id'; roles text[] := '{}';
BEGIN
  CASE TG_TABLE_NAME
  WHEN 'Patient' THEN
    IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
    kind := 'PATIENT_REGISTERED'; roles := ARRAY['ADMIN','RECEPTIONIST'];
  WHEN 'Appointment' THEN
    IF TG_OP='UPDATE' AND (n->>'status',n->>'doctorId',n->>'appointmentDate',n->>'appointmentTime')
      IS NOT DISTINCT FROM (o->>'status',o->>'doctorId',o->>'appointmentDate',o->>'appointmentTime') THEN RETURN NEW; END IF;
    kind := CASE WHEN TG_OP='INSERT' THEN 'APPOINTMENT_BOOKED' WHEN n->>'status'='CHECKED_IN' THEN 'PATIENT_READY' ELSE 'APPOINTMENT_CHANGED' END;
    roles := ARRAY['ADMIN','RECEPTIONIST']; doctor_ids := array_remove(ARRAY[n->>'doctorId',o->>'doctorId'],NULL);
  WHEN 'Prescription' THEN
    IF TG_OP='INSERT' AND n->>'status' <> 'ACTIVE' THEN RETURN NEW; END IF;
    IF TG_OP='UPDATE' AND n->>'status' IS NOT DISTINCT FROM o->>'status' THEN RETURN NEW; END IF;
    kind := CASE WHEN TG_OP='INSERT' THEN 'PRESCRIPTION_READY' ELSE 'PRESCRIPTION_UPDATED' END;
    roles := ARRAY['PHARMACIST'];
    IF TG_OP='UPDATE' THEN doctor_ids := ARRAY[n->>'doctorId']; END IF;
  WHEN 'PrescribedDrug' THEN
    IF TG_OP='INSERT' THEN
      IF n->>'pharmacyReviewStatus'<>'PENDING_REVIEW' THEN RETURN NEW; END IF;
      kind := 'MEDICATION_REVIEW_REQUIRED'; key := 'RX_REVIEW:' || (n->>'prescriptionId');
    ELSE
      IF n->>'pharmacyReviewStatus' IS NOT DISTINCT FROM o->>'pharmacyReviewStatus' THEN RETURN NEW; END IF;
      kind := 'PRESCRIPTION_UPDATED';
      SELECT ARRAY["doctorId"] INTO doctor_ids FROM "Prescription" WHERE id=n->>'prescriptionId';
    END IF;
    roles := ARRAY['PHARMACIST']; entity_type := 'Prescription'; entity_id := n->>'prescriptionId';
  WHEN 'LabOrder' THEN
    doctor_ids := ARRAY[n->>'doctorId'];
    IF TG_OP='UPDATE' AND n->>'releasedToPatientAt' IS DISTINCT FROM o->>'releasedToPatientAt' AND n->>'releasedToPatientAt' IS NOT NULL THEN kind := 'LAB_RESULTS_RELEASED';
    ELSIF TG_OP='UPDATE' AND n->>'status' IS NOT DISTINCT FROM o->>'status' THEN RETURN NEW;
    ELSIF n->>'status'='COMPLETED' THEN kind := 'LAB_RESULTS_COMPLETED';
    ELSIF n->>'status'='PAID' THEN kind := 'LAB_ORDER_PAID'; roles := ARRAY['LAB_TECH']; doctor_ids := '{}';
    ELSIF n->>'status'='SAMPLE_COLLECTED' THEN kind := 'LAB_RESULT_ENTRY_REQUIRED'; roles := ARRAY['LAB_TECH']; doctor_ids := '{}';
    ELSIF n->>'status'='PENDING_BILLING' THEN kind := 'LAB_BILLING_REQUIRED'; roles := ARRAY['ADMIN','RECEPTIONIST']; doctor_ids := '{}';
    ELSE RETURN NEW; END IF;
  WHEN 'LabOrderItem' THEN
    IF TG_OP='UPDATE' AND n->>'labReviewStatus' IS DISTINCT FROM o->>'labReviewStatus' THEN
      SELECT ARRAY["doctorId"] INTO doctor_ids FROM "LabOrder" WHERE id=n->>'labOrderId';
      kind := 'LAB_REVIEW_UPDATED'; roles := ARRAY['LAB_TECH','RECEPTIONIST']; entity_type := 'LabOrder'; entity_id := n->>'labOrderId';
    ELSIF
      TG_OP='INSERT' AND n->>'labReviewStatus'='PENDING_REVIEW' THEN
      kind := 'LAB_REVIEW_REQUIRED'; roles := ARRAY['LAB_TECH']; entity_type := 'LabOrder'; entity_id := n->>'labOrderId'; key := 'LAB_REVIEW:' || entity_id;
    ELSE RETURN NEW; END IF;
  WHEN 'DrugFormulary' THEN
    IF TG_OP='INSERT' THEN
      IF n->>'unitPriceSdg' IS NOT NULL AND n->>'status'='ACTIVE' THEN RETURN NEW; END IF;
      kind := 'MEDICINE_PRICING_REQUIRED'; roles := ARRAY['ADMIN'];
    ELSE
      IF (n-'updatedAt') IS NOT DISTINCT FROM (o-'updatedAt') THEN RETURN NEW; END IF;
      kind := 'MEDICINE_UPDATED'; roles := ARRAY['PHARMACIST'];
    END IF;
  WHEN 'ClinicalService' THEN
    IF TG_OP='INSERT' AND (n->>'baseFeeSdg' IS NULL OR n->>'status'='INACTIVE') THEN kind := 'SERVICE_PRICING_REQUIRED'; roles := ARRAY['ADMIN'];
    ELSIF TG_OP='UPDATE' AND (n-'updatedAt') IS DISTINCT FROM (o-'updatedAt') THEN kind := 'SERVICE_CATALOG_UPDATED'; roles := ARRAY['LAB_TECH','RECEPTIONIST'];
    ELSE RETURN NEW; END IF;
  WHEN 'Invoice' THEN
    IF TG_OP='INSERT' AND n->>'invoiceType' IN ('CONSULTATION','GENERAL') AND n->>'paymentStatus'<>'PAID' THEN
      kind := 'PAYMENT_REQUIRED'; roles := ARRAY['ADMIN','RECEPTIONIST'];
    ELSIF TG_OP='UPDATE' AND n->>'paymentStatus' IS DISTINCT FROM o->>'paymentStatus' THEN
      kind := 'PAYMENT_UPDATED';
      roles := CASE WHEN n->>'invoiceType'='PHARMACY' THEN ARRAY['PHARMACIST'] ELSE ARRAY['ADMIN','RECEPTIONIST'] END;
    ELSE RETURN NEW; END IF;
  WHEN 'InsuranceClaim' THEN
    IF TG_OP='UPDATE' AND n->>'claimStatus' IS NOT DISTINCT FROM o->>'claimStatus' THEN RETURN NEW; END IF;
    kind := 'INSURANCE_ACTION'; roles := ARRAY['ADMIN','RECEPTIONIST'];
  WHEN 'DoctorSchedule', 'DoctorScheduleException' THEN
    IF TG_OP='UPDATE' AND n IS NOT DISTINCT FROM o THEN RETURN NEW; END IF;
    kind := 'SCHEDULE_CHANGED'; roles := ARRAY['ADMIN','RECEPTIONIST']; doctor_ids := ARRAY[n->>'doctorId'];
  WHEN 'Doctor' THEN
    -- Creating an unused profile is not a schedule change. In particular,
    -- do not create recipient history that prevents its existing safe deletion.
    IF TG_OP<>'UPDATE' THEN RETURN NEW; END IF;
    IF TG_OP='UPDATE' AND n->>'consultationFee' IS DISTINCT FROM o->>'consultationFee' THEN
      PERFORM clinic_notify('SERVICE_CATALOG_UPDATED',key||':FEE',entity_type,entity_id,ARRAY['RECEPTIONIST']);
    END IF;
    IF (n->>'weeklySchedule',n->>'status') IS NOT DISTINCT FROM (o->>'weeklySchedule',o->>'status') THEN RETURN NEW; END IF;
    kind := 'SCHEDULE_CHANGED'; roles := ARRAY['ADMIN','RECEPTIONIST']; doctor_ids := ARRAY[n->>'id'];
  WHEN 'TenantAuditLog' THEN
    IF n->>'action' NOT IN ('USER_CREATION','STAFF_PASSWORD_RESET_BY_ADMIN','USER_SESSIONS_REVOKED_BY_ADMIN','USER_STATUS_CHANGE','MFA_ENABLED','MFA_DISABLED') THEN RETURN NEW; END IF;
    kind := 'STAFF_SECURITY_CHANGED'; roles := ARRAY['ADMIN'];
    -- Audit details are intentionally never copied or parsed into a notice.
  ELSE RETURN NEW;
  END CASE;
  PERFORM clinic_notify(kind,key,entity_type,entity_id,roles,coalesce(doctor_ids,'{}'));
  RETURN NEW;
END;
$$;

DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['Patient','Appointment','Prescription','PrescribedDrug','LabOrder','LabOrderItem','DrugFormulary','ClinicalService','Invoice','InsuranceClaim','DoctorSchedule','DoctorScheduleException','Doctor','TenantAuditLog'] LOOP
    EXECUTE format('CREATE TRIGGER clinic_workflow_notice AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION clinic_workflow_notice()',name);
  END LOOP;
END $$;

-- Minor inventory changes invalidate authorized views without creating a noisy
-- durable notice per batch. The bounded stock/expiry service creates alerts.
CREATE FUNCTION clinic_inventory_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('clinic_inventory_v1',NEW."drugId");
  RETURN NEW;
END;
$$;
CREATE TRIGGER clinic_inventory_changed AFTER INSERT OR UPDATE ON "InventoryBatch"
  FOR EACH ROW EXECUTE FUNCTION clinic_inventory_changed();
