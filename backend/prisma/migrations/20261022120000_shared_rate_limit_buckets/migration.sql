-- Shared fixed-window rate limit counters for horizontally scaled API instances.
-- Expired buckets are periodically removed by the application.
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetTime" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "RateLimitBucket_resetTime_idx" ON "RateLimitBucket"("resetTime");
