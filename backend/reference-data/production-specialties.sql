-- Reviewed lookup vocabulary only. No doctors, services, medicines or prices.
-- Execute only after approval against the verified Neon public schema.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public."Specialty" IN SHARE ROW EXCLUSIVE MODE;
DO $bootstrap$
DECLARE
  expected jsonb := '[
    {"code":"surgery","nameAr":"الجراحة","nameEn":"Surgery"},
    {"code":"dentistry","nameAr":"طب الأسنان","nameEn":"Dentistry"},
    {"code":"orthopedics","nameAr":"جراحة العظام","nameEn":"Orthopedics"},
    {"code":"internal-medicine","nameAr":"الباطنية","nameEn":"Internal Medicine"},
    {"code":"neurology","nameAr":"طب الأعصاب","nameEn":"Neurology"}
  ]'::jsonb;
  item record;
BEGIN
  -- Inspect the complete vocabulary before inserting anything. Preserve every
  -- existing ID, label, active flag and timestamp; abort on conflicting labels.
  FOR item IN SELECT * FROM jsonb_to_recordset(expected)
    AS x(code text, "nameAr" text, "nameEn" text)
  LOOP
    IF EXISTS (SELECT 1 FROM public."Specialty" s WHERE s.code=item.code
      AND (s."nameAr"<>item."nameAr" OR s."nameEn"<>item."nameEn")) THEN
      RAISE EXCEPTION 'Specialty code/label conflict; no references inserted';
    END IF;
    IF EXISTS (SELECT 1 FROM public."Specialty" s WHERE s.code<>item.code AND (
      lower(regexp_replace(btrim(normalize(s."nameAr", NFKC)), '\s+', ' ', 'g')) =
        lower(regexp_replace(btrim(normalize(item."nameAr", NFKC)), '\s+', ' ', 'g')) OR
      lower(regexp_replace(btrim(normalize(s."nameEn", NFKC)), '\s+', ' ', 'g')) =
        lower(regexp_replace(btrim(normalize(item."nameEn", NFKC)), '\s+', ' ', 'g'))
    )) THEN
      RAISE EXCEPTION 'Specialty normalized-name conflict; no references inserted';
    END IF;
  END LOOP;
  INSERT INTO public."Specialty" (id,code,"nameAr","nameEn",active,"deletionProtected","createdAt","updatedAt")
  SELECT gen_random_uuid()::text,x.code,x."nameAr",x."nameEn",true,false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
  FROM jsonb_to_recordset(expected) AS x(code text,"nameAr" text,"nameEn" text)
  WHERE NOT EXISTS (SELECT 1 FROM public."Specialty" s WHERE s.code=x.code);
END
$bootstrap$;
COMMIT;
