-- AlterTable
ALTER TABLE "Site" ADD COLUMN "gscSearchType" TEXT NOT NULL DEFAULT 'web',
ADD COLUMN "gscDataVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "lastGscSyncAt" TIMESTAMP(3),
ADD COLUMN "gscLegacyProperty" TEXT;

-- Preserve attribution for existing legacy data before properties can change.
UPDATE "Site" SET "gscLegacyProperty" = "gscProperty";

-- CreateEnum
CREATE TYPE "GscSyncTrigger" AS ENUM ('INITIAL', 'MANUAL', 'SCHEDULED', 'CLI');

-- CreateEnum
CREATE TYPE "GscSyncStatus" AS ENUM ('RUNNING', 'COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED');

-- CreateTable
CREATE TABLE "GscSyncRun" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "property" TEXT NOT NULL,
    "trigger" "GscSyncTrigger" NOT NULL,
    "status" "GscSyncStatus" NOT NULL DEFAULT 'RUNNING',
    "searchType" TEXT NOT NULL DEFAULT 'web',
    "requestedStart" DATE NOT NULL,
    "requestedEnd" DATE NOT NULL,
    "effectiveStart" DATE,
    "effectiveEnd" DATE,
    "dataState" TEXT NOT NULL DEFAULT 'final',
    "reportCounts" JSONB,
    "reportStates" JSONB,
    "reconciliation" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GscSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GscDailyTotal" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "property" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "searchType" TEXT NOT NULL DEFAULT 'web',
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,
    "syncRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GscDailyTotal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GscQueryDaily" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "property" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "searchType" TEXT NOT NULL DEFAULT 'web',
    "query" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,
    "syncRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GscQueryDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GscPageDaily" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "property" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "searchType" TEXT NOT NULL DEFAULT 'web',
    "url" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,
    "syncRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GscPageDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GscQueryPageDaily" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "property" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "searchType" TEXT NOT NULL DEFAULT 'web',
    "query" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,
    "syncRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GscQueryPageDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GscDeviceDaily" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "property" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "searchType" TEXT NOT NULL DEFAULT 'web',
    "device" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,
    "syncRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GscDeviceDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GscCountryDaily" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "property" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "searchType" TEXT NOT NULL DEFAULT 'web',
    "country" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,
    "syncRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GscCountryDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GscSyncLease" (
    "siteId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GscSyncLease_pkey" PRIMARY KEY ("siteId")
);

-- CreateIndex
CREATE INDEX "GscSyncRun_siteId_property_startedAt_idx" ON "GscSyncRun"("siteId", "property", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GscDailyTotal_siteId_property_searchType_date_key" ON "GscDailyTotal"("siteId", "property", "searchType", "date");

-- CreateIndex
CREATE INDEX "GscDailyTotal_siteId_property_date_idx" ON "GscDailyTotal"("siteId", "property", "date");

-- CreateIndex
CREATE UNIQUE INDEX "GscQueryDaily_siteId_property_searchType_date_query_key" ON "GscQueryDaily"("siteId", "property", "searchType", "date", "query");

-- CreateIndex
CREATE INDEX "GscQueryDaily_siteId_property_date_idx" ON "GscQueryDaily"("siteId", "property", "date");

-- CreateIndex
CREATE INDEX "GscQueryDaily_siteId_property_query_date_idx" ON "GscQueryDaily"("siteId", "property", "query", "date");

-- CreateIndex
CREATE UNIQUE INDEX "GscPageDaily_siteId_property_searchType_date_url_key" ON "GscPageDaily"("siteId", "property", "searchType", "date", "url");

-- CreateIndex
CREATE INDEX "GscPageDaily_siteId_property_date_idx" ON "GscPageDaily"("siteId", "property", "date");

-- CreateIndex
CREATE INDEX "GscPageDaily_siteId_property_url_date_idx" ON "GscPageDaily"("siteId", "property", "url", "date");

-- CreateIndex
CREATE UNIQUE INDEX "GscQueryPageDaily_siteId_property_searchType_date_query_url_key" ON "GscQueryPageDaily"("siteId", "property", "searchType", "date", "query", "url");

-- CreateIndex
CREATE INDEX "GscQueryPageDaily_siteId_property_query_date_idx" ON "GscQueryPageDaily"("siteId", "property", "query", "date");

-- CreateIndex
CREATE INDEX "GscQueryPageDaily_siteId_property_url_date_idx" ON "GscQueryPageDaily"("siteId", "property", "url", "date");

-- CreateIndex
CREATE UNIQUE INDEX "GscDeviceDaily_siteId_property_searchType_date_device_key" ON "GscDeviceDaily"("siteId", "property", "searchType", "date", "device");

-- CreateIndex
CREATE INDEX "GscDeviceDaily_siteId_property_date_idx" ON "GscDeviceDaily"("siteId", "property", "date");

-- CreateIndex
CREATE UNIQUE INDEX "GscCountryDaily_siteId_property_searchType_date_country_key" ON "GscCountryDaily"("siteId", "property", "searchType", "date", "country");

-- CreateIndex
CREATE INDEX "GscCountryDaily_siteId_property_date_idx" ON "GscCountryDaily"("siteId", "property", "date");

-- AddForeignKey
ALTER TABLE "GscSyncRun" ADD CONSTRAINT "GscSyncRun_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GscDailyTotal" ADD CONSTRAINT "GscDailyTotal_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GscDailyTotal" ADD CONSTRAINT "GscDailyTotal_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "GscSyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GscQueryDaily" ADD CONSTRAINT "GscQueryDaily_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GscQueryDaily" ADD CONSTRAINT "GscQueryDaily_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "GscSyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GscPageDaily" ADD CONSTRAINT "GscPageDaily_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GscPageDaily" ADD CONSTRAINT "GscPageDaily_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "GscSyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GscQueryPageDaily" ADD CONSTRAINT "GscQueryPageDaily_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GscQueryPageDaily" ADD CONSTRAINT "GscQueryPageDaily_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "GscSyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GscDeviceDaily" ADD CONSTRAINT "GscDeviceDaily_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GscDeviceDaily" ADD CONSTRAINT "GscDeviceDaily_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "GscSyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GscCountryDaily" ADD CONSTRAINT "GscCountryDaily_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GscCountryDaily" ADD CONSTRAINT "GscCountryDaily_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "GscSyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GscSyncLease" ADD CONSTRAINT "GscSyncLease_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
