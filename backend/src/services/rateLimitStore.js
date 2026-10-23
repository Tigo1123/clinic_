import prisma from '../db.js';
import { logger } from '../utils/logger.js';

// One cleanup attempt/minute per worker; one warning/five minutes on failure.
export function createBucketCleanup({ execute = () => prisma.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "resetTime" <= NOW()`, warn = () => logger.warn('rate_limit.cleanup_failed', { retryAfterSeconds: 60 }), now = Date.now } = {}) {
  let lastCleanupAt = -Infinity;
  let lastWarningAt = -Infinity;
  let cleanupPromise = null;
  return function removeExpiredBuckets() {
    if (cleanupPromise || now() - lastCleanupAt < 60_000) return;
    lastCleanupAt = now();
    cleanupPromise = Promise.resolve().then(execute).catch(() => {
      if (now() - lastWarningAt >= 300_000) { lastWarningAt = now(); warn(); }
    }).finally(() => { cleanupPromise = null; });
  };
}
const removeExpiredBuckets = createBucketCleanup();

/** express-rate-limit store shared by all API instances using the same PostgreSQL database. */
export class PrismaRateLimitStore {
  constructor({ windowMs, prefix = 'default' }) {
    this.windowMs = windowMs;
    this.prefix = prefix;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async increment(key) {
    removeExpiredBuckets();
    const bucketKey = `${this.prefix}:${key}`;
    const rows = await prisma.$queryRaw`
      INSERT INTO "RateLimitBucket" ("key", "count", "resetTime")
      VALUES (${bucketKey}, 1, NOW() + (${this.windowMs} * INTERVAL '1 millisecond'))
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimitBucket"."resetTime" <= NOW() THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
        "resetTime" = CASE WHEN "RateLimitBucket"."resetTime" <= NOW()
          THEN NOW() + (${this.windowMs} * INTERVAL '1 millisecond')
          ELSE "RateLimitBucket"."resetTime" END
      RETURNING "count", "resetTime"
    `;
    return { totalHits: Number(rows[0].count), resetTime: rows[0].resetTime };
  }

  async decrement(key) {
    await prisma.$executeRaw`UPDATE "RateLimitBucket" SET "count" = GREATEST(0, "count" - 1) WHERE "key" = ${`${this.prefix}:${key}`}`;
  }

  async resetKey(key) {
    await prisma.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" = ${`${this.prefix}:${key}`}`;
  }

  async resetAll() {
    await prisma.$executeRaw`DELETE FROM "RateLimitBucket" WHERE left("key", length(${this.prefix}) + 1) = ${`${this.prefix}:`}`;
  }
}

export function rateLimitStore(prefix, windowMs) {
  const mode = process.env.RATE_LIMIT_STORE || (process.env.NODE_ENV === 'production' ? 'postgres' : 'memory');
  if (mode === 'postgres') return new PrismaRateLimitStore({ prefix, windowMs });
  if (mode === 'memory' && process.env.NODE_ENV !== 'production') return undefined;
  throw new Error('RATE_LIMIT_STORE must be postgres in production; local memory stores are allowed only outside production.');
}
