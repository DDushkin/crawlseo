CREATE TABLE "DataForSeoSettings" (
    "siteId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'SANDBOX',
    "locationCode" INTEGER NOT NULL DEFAULT 2840,
    "languageCode" TEXT NOT NULL DEFAULT 'en',
    "spentUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reservedUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DataForSeoSettings_pkey" PRIMARY KEY ("siteId")
);

CREATE TABLE "DataForSeoRun" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "activeKey" TEXT,
    "status" TEXT NOT NULL,
    "estimatedUsd" DOUBLE PRECISION NOT NULL,
    "chargedUsd" DOUBLE PRECISION,
    "taskId" TEXT,
    "response" JSONB,
    "error" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DataForSeoRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DataForSeoRun_activeKey_key" ON "DataForSeoRun"("activeKey");
CREATE INDEX "DataForSeoRun_siteId_cacheKey_status_expiresAt_idx" ON "DataForSeoRun"("siteId", "cacheKey", "status", "expiresAt");
CREATE INDEX "DataForSeoRun_siteId_createdAt_idx" ON "DataForSeoRun"("siteId", "createdAt");

ALTER TABLE "DataForSeoSettings" ADD CONSTRAINT "DataForSeoSettings_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DataForSeoRun" ADD CONSTRAINT "DataForSeoRun_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
