ALTER TABLE "Site" ADD COLUMN "ga4PropertyId" TEXT;
ALTER TABLE "Site" ADD COLUMN "lastGa4SyncAt" TIMESTAMP(3);

CREATE TABLE "AiVisibilityRun" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "activeKey" TEXT,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "mode" TEXT NOT NULL,
  "platform" TEXT NOT NULL DEFAULT 'CHATGPT_WEB',
  "locationCode" INTEGER NOT NULL,
  "languageCode" TEXT NOT NULL,
  "promptCount" INTEGER NOT NULL,
  "promptSnapshots" JSONB NOT NULL,
  "chargedUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "leaseUntil" TIMESTAMP(3),
  "error" TEXT,
  CONSTRAINT "AiVisibilityRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiVisibilityRun_siteId_startedAt_idx" ON "AiVisibilityRun"("siteId", "startedAt");
CREATE UNIQUE INDEX "AiVisibilityRun_activeKey_key" ON "AiVisibilityRun"("activeKey");
CREATE INDEX "AiVisibilityRun_status_leaseUntil_idx" ON "AiVisibilityRun"("status", "leaseUntil");
ALTER TABLE "AiVisibilityRun" ADD CONSTRAINT "AiVisibilityRun_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AiVisibilityResult" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "promptId" TEXT,
  "promptFingerprint" TEXT NOT NULL,
  "questionSnapshot" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "siteCited" BOOLEAN NOT NULL,
  "sources" JSONB NOT NULL,
  "model" TEXT,
  "observedAt" TIMESTAMP(3),
  "cached" BOOLEAN NOT NULL DEFAULT false,
  "error" TEXT,
  CONSTRAINT "AiVisibilityResult_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiVisibilityResult_runId_promptFingerprint_key" ON "AiVisibilityResult"("runId", "promptFingerprint");
CREATE INDEX "AiVisibilityResult_siteId_promptId_idx" ON "AiVisibilityResult"("siteId", "promptId");
ALTER TABLE "AiVisibilityResult" ADD CONSTRAINT "AiVisibilityResult_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiVisibilityResult" ADD CONSTRAINT "AiVisibilityResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AiVisibilityRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiVisibilityResult" ADD CONSTRAINT "AiVisibilityResult_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "AiPrompt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "GscAiImport" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "property" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileHash" TEXT NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "firstDate" DATE NOT NULL,
  "lastDate" DATE NOT NULL,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GscAiImport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GscAiImport_siteId_fileHash_key" ON "GscAiImport"("siteId", "fileHash");
CREATE INDEX "GscAiImport_siteId_importedAt_idx" ON "GscAiImport"("siteId", "importedAt");
ALTER TABLE "GscAiImport" ADD CONSTRAINT "GscAiImport_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "GscAiDaily" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "property" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "impressions" INTEGER NOT NULL,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GscAiDaily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GscAiDaily_siteId_property_date_key" ON "GscAiDaily"("siteId", "property", "date");
CREATE INDEX "GscAiDaily_siteId_date_idx" ON "GscAiDaily"("siteId", "date");
ALTER TABLE "GscAiDaily" ADD CONSTRAINT "GscAiDaily_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AiReferralDaily" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "source" TEXT NOT NULL,
  "sessions" INTEGER NOT NULL,
  "keyEvents" DOUBLE PRECISION NOT NULL,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiReferralDaily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiReferralDaily_siteId_date_source_key" ON "AiReferralDaily"("siteId", "date", "source");
CREATE INDEX "AiReferralDaily_siteId_date_idx" ON "AiReferralDaily"("siteId", "date");
ALTER TABLE "AiReferralDaily" ADD CONSTRAINT "AiReferralDaily_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Ga4OrganicDaily" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "sessions" INTEGER NOT NULL,
  "keyEvents" DOUBLE PRECISION NOT NULL,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Ga4OrganicDaily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Ga4OrganicDaily_siteId_date_key" ON "Ga4OrganicDaily"("siteId", "date");
CREATE INDEX "Ga4OrganicDaily_siteId_date_idx" ON "Ga4OrganicDaily"("siteId", "date");
ALTER TABLE "Ga4OrganicDaily" ADD CONSTRAINT "Ga4OrganicDaily_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
