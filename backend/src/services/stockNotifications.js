import prisma from '../db.js';
import { Prisma } from '../generated/prisma/index.js';
import { getClinicNow } from '../utils/clinicTime.js';
import { logger } from '../utils/logger.js';

// Reuse the stock screen's rules: usable stock excludes expired batches;
// any unexpired batch at its reorder level is low; near expiry is 90 days.
export async function scanStockNotifications(client = prisma, instant = new Date()) {
  const today = getClinicNow(instant).toISODate();
  const near = getClinicNow(instant).plus({ days: 90 }).toISODate();
  let cursor;
  for (;;) {
    const drugs = await client.drugFormulary.findMany({
      where: { inventoryBatches: { some: {} } }, select: { id: true },
      orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    });
    if (!drugs.length) return;
    await client.$transaction(async tx => {
      // Serializes scanners on multiple API nodes without elevated privileges.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('clinic-stock-notices')) IS NULL AS locked`;
      await tx.$executeRaw(Prisma.sql`
        WITH summary AS (
          SELECT "drugId", CASE
            WHEN COALESCE(SUM("qtyOnHand") FILTER (WHERE "expiryDate" >= ${today}),0)=0 THEN 'OUT'
            WHEN BOOL_OR("expiryDate" >= ${today} AND "qtyOnHand" <= "minReorderLevel") THEN 'LOW'
            ELSE 'HEALTHY' END AS state
          FROM "InventoryBatch" WHERE "drugId" IN (${Prisma.join(drugs.map(d => d.id))}) GROUP BY "drugId"
        ), states AS (
          INSERT INTO "StockNotificationState" ("drugId",state,revision)
          SELECT "drugId",state,0 FROM summary
          ON CONFLICT ("drugId") DO UPDATE SET state=EXCLUDED.state,
            revision="StockNotificationState".revision + CASE WHEN "StockNotificationState".state<>EXCLUDED.state THEN 1 ELSE 0 END
          RETURNING "drugId",state,revision
        )
        SELECT clinic_notify(CASE WHEN state='OUT' THEN 'STOCK_OUT' ELSE 'STOCK_LOW' END,
          'STOCK:'||"drugId"||':'||revision||':'||state,'DrugFormulary',"drugId",
          CASE WHEN state='OUT' THEN ARRAY['PHARMACIST','ADMIN'] ELSE ARRAY['PHARMACIST'] END)
        FROM states WHERE state<>'HEALTHY'
      `);
      await tx.$executeRaw(Prisma.sql`
        SELECT clinic_notify(CASE WHEN "expiryDate" < ${today} THEN 'BATCH_EXPIRED' ELSE 'BATCH_NEAR_EXPIRY' END,
          'BATCH:'||id||':'||"expiryDate"||':'||CASE WHEN "expiryDate" < ${today} THEN 'EXPIRED' ELSE 'NEAR' END,
          'InventoryBatch',id,ARRAY['PHARMACIST'])
        FROM "InventoryBatch" WHERE "drugId" IN (${Prisma.join(drugs.map(d => d.id))})
          AND "qtyOnHand">0 AND "expiryDate"<=${near}
      `);
    });
    cursor = drugs.at(-1).id;
    if (drugs.length < 100) return;
  }
}

export function createStockNotificationJob({ scan = scanStockNotifications, intervalMs = 3600000 } = {}) {
  let timer; let running = null; let dirty = false; let stopped = true;
  const request = () => {
    if (stopped) return Promise.resolve();
    dirty = true;
    if (!running) running = (async () => {
      while (dirty && !stopped) { dirty = false; await scan(); }
    })().catch(error => logger.error('notification.stock_scan_failed', { error }))
      .finally(() => { running = null; });
    return running;
  };
  return {
    request,
    start() { if (!stopped) return; stopped = false; timer = setInterval(request, intervalMs); timer.unref?.(); request(); },
    async stop() { stopped = true; clearInterval(timer); await running; }
  };
}
