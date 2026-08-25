-- Medicine-management phase 1 deliberately keeps InventoryBatch.expiryDate
-- as TEXT. Runtime validation now proves real ISO calendar dates; converting
-- populated production data to PostgreSQL DATE is deferred to a dedicated
-- migration with an explicit operational rollback plan.

ALTER TABLE "DrugFormulary"
  ADD COLUMN "brandName" TEXT,
  ADD COLUMN "identityKey" TEXT;

ALTER TABLE "InventoryBatch"
  ADD COLUMN "normalizedBatchNumber" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "DrugFormulary"
    WHERE btrim("labelEn") = ''
       OR btrim("genericName") = ''
       OR btrim("strength") = ''
       OR btrim("dosageForm") = ''
       OR "labelEn" ~ '[[:cntrl:]]'
       OR "genericName" ~ '[[:cntrl:]]'
       OR "strength" ~ '[[:cntrl:]]'
       OR "dosageForm" ~ '[[:cntrl:]]'
  ) THEN
    RAISE EXCEPTION 'Medicine identity backfill refused: blank or control-character legacy identity component detected.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "InventoryBatch"
    WHERE btrim("batchNumber") = ''
       OR "batchNumber" ~ '[[:cntrl:]]'
       OR "qtyOnHand" < 0
       OR "minReorderLevel" < 0
  ) THEN
    RAISE EXCEPTION 'Inventory batch backfill refused: invalid legacy batch data detected.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "InventoryBatch"
    WHERE NOT ("expiryDate" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
       OR CASE
            WHEN "expiryDate" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            THEN to_char(to_date("expiryDate", 'YYYY-MM-DD'), 'YYYY-MM-DD') <> "expiryDate"
            ELSE FALSE
          END
  ) THEN
    RAISE EXCEPTION 'Inventory batch backfill refused: invalid legacy expiry date detected.';
  END IF;
END $$;

UPDATE "DrugFormulary"
SET "brandName" = regexp_replace(btrim("labelEn"), ' +', ' ', 'g');

UPDATE "DrugFormulary"
SET "identityKey" =
  octet_length(translate(regexp_replace(btrim("brandName"), ' +', ' ', 'g'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))::text || ':' || translate(regexp_replace(btrim("brandName"), ' +', ' ', 'g'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') ||
  octet_length(translate(regexp_replace(btrim("genericName"), ' +', ' ', 'g'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))::text || ':' || translate(regexp_replace(btrim("genericName"), ' +', ' ', 'g'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') ||
  octet_length(translate(regexp_replace(btrim("strength"), ' +', ' ', 'g'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))::text || ':' || translate(regexp_replace(btrim("strength"), ' +', ' ', 'g'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') ||
  octet_length(translate(regexp_replace(btrim("dosageForm"), ' +', ' ', 'g'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))::text || ':' || translate(regexp_replace(btrim("dosageForm"), ' +', ' ', 'g'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');

UPDATE "InventoryBatch"
SET "normalizedBatchNumber" = translate(regexp_replace(btrim("batchNumber"), ' +', ' ', 'g'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');

DO $$
BEGIN
  IF EXISTS (
    SELECT "identityKey"
    FROM "DrugFormulary"
    GROUP BY "identityKey"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Medicine identity backfill refused: canonical legacy medicine collision detected.';
  END IF;

  IF EXISTS (
    SELECT "drugId", "normalizedBatchNumber", "expiryDate"
    FROM "InventoryBatch"
    GROUP BY "drugId", "normalizedBatchNumber", "expiryDate"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Inventory batch backfill refused: canonical legacy batch collision detected.';
  END IF;
END $$;

ALTER TABLE "DrugFormulary"
  ALTER COLUMN "brandName" SET NOT NULL,
  ALTER COLUMN "identityKey" SET NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'INACTIVE';

ALTER TABLE "InventoryBatch"
  ALTER COLUMN "normalizedBatchNumber" SET NOT NULL;

CREATE UNIQUE INDEX "DrugFormulary_identityKey_key"
  ON "DrugFormulary"("identityKey");

CREATE UNIQUE INDEX "InventoryBatch_drugId_normalizedBatchNumber_expiryDate_key"
  ON "InventoryBatch"("drugId", "normalizedBatchNumber", "expiryDate");

CREATE TABLE "StockMovement" (
  "id" TEXT NOT NULL,
  "drugId" TEXT NOT NULL,
  "inventoryBatchId" TEXT NOT NULL,
  "movementType" TEXT NOT NULL,
  "quantityDelta" INTEGER NOT NULL,
  "resultingBalance" INTEGER NOT NULL,
  "actorUserId" TEXT,
  "referenceType" TEXT,
  "referenceId" TEXT,
  "reason" TEXT,
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StockMovement_movementType_check"
    CHECK ("movementType" IN ('OPENING_BALANCE', 'RECEIPT', 'DISPENSE')),
  CONSTRAINT "StockMovement_quantityDelta_check"
    CHECK (
      ("movementType" IN ('OPENING_BALANCE', 'RECEIPT') AND "quantityDelta" > 0)
      OR ("movementType" = 'DISPENSE' AND "quantityDelta" < 0)
    ),
  CONSTRAINT "StockMovement_resultingBalance_check"
    CHECK ("resultingBalance" >= 0),
  CONSTRAINT "StockMovement_actor_required_check"
    CHECK ("movementType" = 'OPENING_BALANCE' OR "actorUserId" IS NOT NULL)
);

CREATE UNIQUE INDEX "StockMovement_idempotencyKey_key"
  ON "StockMovement"("idempotencyKey");
CREATE INDEX "StockMovement_drugId_createdAt_idx"
  ON "StockMovement"("drugId", "createdAt");
CREATE INDEX "StockMovement_inventoryBatchId_createdAt_idx"
  ON "StockMovement"("inventoryBatchId", "createdAt");
CREATE INDEX "StockMovement_actorUserId_createdAt_idx"
  ON "StockMovement"("actorUserId", "createdAt");

CREATE FUNCTION prevent_stock_movement_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'StockMovement is an immutable ledger.';
END;
$$;

CREATE TRIGGER stock_movement_immutable
BEFORE UPDATE OR DELETE ON "StockMovement"
FOR EACH ROW EXECUTE FUNCTION prevent_stock_movement_mutation();

ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_drugId_fkey"
  FOREIGN KEY ("drugId") REFERENCES "DrugFormulary"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_inventoryBatchId_fkey"
  FOREIGN KEY ("inventoryBatchId") REFERENCES "InventoryBatch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "StockMovement" (
  "id", "drugId", "inventoryBatchId", "movementType",
  "quantityDelta", "resultingBalance", "actorUserId",
  "referenceType", "referenceId", "reason", "idempotencyKey"
)
SELECT
  'migration-opening-' || batch."id",
  batch."drugId",
  batch."id",
  'OPENING_BALANCE',
  batch."qtyOnHand",
  batch."qtyOnHand",
  NULL,
  'MIGRATION_OPENING_BALANCE',
  batch."id",
  'Opening balance imported from legacy inventory.',
  'migration:opening-balance:' || batch."id"
FROM "InventoryBatch" AS batch
WHERE batch."qtyOnHand" > 0;
