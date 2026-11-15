-- Keep the existing medicine pricing-required behavior, but describe catalog
-- updates by the safe field category that changed. No medicine values are
-- copied into notification payloads.
CREATE FUNCTION clinic_drugformulary_notice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  n jsonb := to_jsonb(NEW);
  o jsonb := CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  key text := 'DrugFormulary:' || (n->>'id') || ':' || txid_current()::text;
  kind text;
BEGIN
  IF TG_OP='INSERT' THEN
    IF n->>'unitPriceSdg' IS NOT NULL AND n->>'status'='ACTIVE' THEN RETURN NEW; END IF;
    PERFORM clinic_notify('MEDICINE_PRICING_REQUIRED',key,'DrugFormulary',n->>'id',ARRAY['ADMIN']);
    RETURN NEW;
  END IF;

  IF (n-'updatedAt') IS NOT DISTINCT FROM (o-'updatedAt') THEN RETURN NEW; END IF;
  IF n->>'unitPriceSdg' IS DISTINCT FROM o->>'unitPriceSdg'
    AND n->>'status' IS DISTINCT FROM o->>'status' THEN
    kind := 'MEDICINE_PRICE_AND_STATUS_UPDATED';
  ELSIF n->>'unitPriceSdg' IS DISTINCT FROM o->>'unitPriceSdg' THEN
    kind := 'MEDICINE_PRICE_UPDATED';
  ELSIF n->>'status' IS DISTINCT FROM o->>'status' THEN
    kind := 'MEDICINE_STATUS_UPDATED';
  ELSE
    kind := 'MEDICINE_UPDATED';
  END IF;
  PERFORM clinic_notify(kind,key,'DrugFormulary',n->>'id',ARRAY['PHARMACIST']);
  RETURN NEW;
END;
$$;

DROP TRIGGER clinic_workflow_notice ON "DrugFormulary";
CREATE TRIGGER clinic_workflow_notice
  AFTER INSERT OR UPDATE ON "DrugFormulary"
  FOR EACH ROW EXECUTE FUNCTION clinic_drugformulary_notice();
