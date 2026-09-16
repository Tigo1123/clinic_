-- Earlier versions did not retain every specialty assignment. Preserve all
-- pre-existing rows rather than assert that an unlinked specialty was never used.
ALTER TABLE "Specialty" ADD COLUMN "deletionProtected" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Specialty" SET "deletionProtected" = true;

-- Never silently unlink a doctor when deleting a specialty.
ALTER TABLE "Doctor" DROP CONSTRAINT "Doctor_specialtyId_fkey";
ALTER TABLE "Doctor" ADD CONSTRAINT "Doctor_specialtyId_fkey"
  FOREIGN KEY ("specialtyId") REFERENCES "Specialty"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Track use across every writer (API, seed, import), including legacy names.
-- Updating the parent row also serializes assignment against DELETE's row lock.
CREATE FUNCTION protect_used_specialty() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Specialty" SET "deletionProtected" = true
  WHERE "id" = NEW."specialtyId"
     OR (NEW."specialtyId" IS NULL AND
        (lower("nameEn") = lower(NEW."specialtyEn") OR "nameAr" = NEW."specialtyAr"));
  RETURN NEW;
END;
$$;

CREATE TRIGGER doctor_protect_used_specialty
BEFORE INSERT OR UPDATE OF "specialtyId", "specialtyEn", "specialtyAr" ON "Doctor"
FOR EACH ROW EXECUTE FUNCTION protect_used_specialty();

-- A newly entered specialty may match an older doctor's text-only specialty.
-- Remember that link before a rename can hide it, and never clear protection.
CREATE FUNCTION retain_specialty_protection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."deletionProtected" THEN
    NEW."deletionProtected" := true;
  END IF;
  IF NOT NEW."deletionProtected" AND EXISTS (
    SELECT 1 FROM "Doctor" WHERE "specialtyId" = NEW."id"
      OR ("specialtyId" IS NULL AND
         (lower("specialtyEn") = lower(NEW."nameEn") OR "specialtyAr" = NEW."nameAr"))
  ) THEN
    NEW."deletionProtected" := true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER specialty_retain_protection
BEFORE INSERT OR UPDATE ON "Specialty"
FOR EACH ROW EXECUTE FUNCTION retain_specialty_protection();
