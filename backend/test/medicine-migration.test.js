import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { buildMedicineIdentityKey, normalizeBatchNumber } from '../src/utils/medicineManagement.js';

const migrationsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../prisma/migrations');
const phaseMigrationName = '20260825090000_medicine_management_phase1';
const databaseUrl = process.env.DATABASE_URL;

async function legacySchema(run) {
  const parsed = new URL(databaseUrl);
  assert.ok(['localhost', '127.0.0.1'].includes(parsed.hostname));
  assert.match(parsed.pathname.toLowerCase(), /test/);
  const schema = `medicine_migration_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const client = new Client({ connectionString: parsed.toString() });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    const oldMigrations = fs.readdirSync(migrationsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name < phaseMigrationName)
      .map((entry) => entry.name)
      .sort();
    for (const migration of oldMigrations) {
      await client.query(fs.readFileSync(path.join(migrationsRoot, migration, 'migration.sql'), 'utf8'));
    }
    const phaseSql = fs.readFileSync(path.join(migrationsRoot, phaseMigrationName, 'migration.sql'), 'utf8');
    await run(client, phaseSql);
  } finally {
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    await client.end();
  }
}

test('medicine phase migration deterministically backfills legacy product, batch, and opening movement', {
  skip: !databaseUrl
}, async () => {
  await legacySchema(async (client, phaseSql) => {
    await client.query(`
      INSERT INTO "DrugFormulary" ("id", "labelAr", "labelEn", "genericName", "strength", "dosageForm", "unitPriceSdg", "status")
      VALUES ('legacy-drug', 'دواء قديم', ' Legacy   Brand ', ' Generic  Name ', ' 500  MG ', ' Tablet ', NULL, 'ACTIVE')
    `);
    await client.query(`
      INSERT INTO "InventoryBatch" ("id", "drugId", "batchNumber", "expiryDate", "qtyOnHand", "minReorderLevel", "ledgerVersion")
      VALUES ('legacy-batch', 'legacy-drug', ' Lot   A-1 ', '2028-02-29', 25, 4, 0)
    `);
    await client.query(phaseSql);
    const drug = (await client.query('SELECT * FROM "DrugFormulary" WHERE "id" = $1', ['legacy-drug'])).rows[0];
    assert.equal(drug.brandName, 'Legacy Brand');
    assert.equal(drug.identityKey, buildMedicineIdentityKey({
      brandName: 'Legacy Brand', genericName: 'Generic Name', strength: '500 MG', dosageForm: 'Tablet'
    }));
    assert.equal(drug.status, 'ACTIVE');
    const activeLegacy = await client.query(`
      INSERT INTO "DrugFormulary" ("id", "brandName", "labelAr", "labelEn", "genericName", "strength", "dosageForm", "identityKey", "status")
      VALUES ('post-migration-default', 'New Brand', 'دواء', 'New Drug', 'New Generic', '1 mg', 'Tablet', '9:new brand11:new generic4:1 mg6:tablet', DEFAULT)
      RETURNING "status"
    `);
    assert.equal(activeLegacy.rows[0].status, 'INACTIVE');
    const batch = (await client.query('SELECT * FROM "InventoryBatch" WHERE "id" = $1', ['legacy-batch'])).rows[0];
    assert.equal(batch.normalizedBatchNumber, normalizeBatchNumber('Lot A-1'));
    const movement = (await client.query('SELECT * FROM "StockMovement" WHERE "inventoryBatchId" = $1', ['legacy-batch'])).rows[0];
    assert.equal(movement.movementType, 'OPENING_BALANCE');
    assert.equal(movement.quantityDelta, 25);
    assert.equal(movement.resultingBalance, 25);
    assert.equal(movement.actorUserId, null);
    await assert.rejects(
      client.query(`
        INSERT INTO "StockMovement" (
          "id", "drugId", "inventoryBatchId", "movementType",
          "quantityDelta", "resultingBalance", "actorUserId"
        ) VALUES ('actorless-dispense', 'legacy-drug', 'legacy-batch', 'DISPENSE', -1, 24, NULL)
      `),
      /StockMovement_actor_required_check/
    );
    await assert.rejects(
      client.query('UPDATE "StockMovement" SET "resultingBalance" = 24 WHERE "id" = $1', [movement.id]),
      /immutable ledger/
    );
  });
});

test('medicine phase migration refuses canonical legacy medicine collisions', { skip: !databaseUrl }, async () => {
  await legacySchema(async (client, phaseSql) => {
    await client.query(`
      INSERT INTO "DrugFormulary" ("id", "labelAr", "labelEn", "genericName", "strength", "dosageForm", "status") VALUES
      ('collision-a', 'أ', ' Brand  One ', 'Generic', '10 mg', 'Tablet', 'INACTIVE'),
      ('collision-b', 'ب', 'brand one', ' generic ', '10  MG', ' tablet ', 'INACTIVE')
    `);
    await assert.rejects(client.query(phaseSql), /canonical legacy medicine collision detected/);
  });
});

test('medicine phase migration refuses canonical legacy batch collisions', { skip: !databaseUrl }, async () => {
  await legacySchema(async (client, phaseSql) => {
    await client.query(`
      INSERT INTO "DrugFormulary" ("id", "labelAr", "labelEn", "genericName", "strength", "dosageForm", "status")
      VALUES ('batch-drug', 'دواء', 'Batch Brand', 'Generic', '10 mg', 'Tablet', 'INACTIVE')
    `);
    await client.query(`
      INSERT INTO "InventoryBatch" ("id", "drugId", "batchNumber", "expiryDate", "qtyOnHand", "minReorderLevel", "ledgerVersion") VALUES
      ('batch-a', 'batch-drug', ' Lot  A-1 ', '2030-01-01', 5, 1, 0),
      ('batch-b', 'batch-drug', 'lot a-1', '2030-01-01', 5, 1, 0)
    `);
    await assert.rejects(client.query(phaseSql), /canonical legacy batch collision detected/);
  });
});
