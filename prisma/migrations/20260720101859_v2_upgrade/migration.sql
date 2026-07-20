-- AlterTable
ALTER TABLE "Crawl" ADD COLUMN     "maxPages" INTEGER NOT NULL DEFAULT 200;

-- CreateTable
CREATE TABLE "SavedKeyword" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedKeyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankSnapshot" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "page" TEXT,
    "date" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RankSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditPage" (
    "id" TEXT NOT NULL,
    "crawlId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "redirectUrl" TEXT,
    "title" TEXT,
    "description" TEXT,
    "canonical" TEXT,
    "robotsMeta" TEXT,
    "h1Count" INTEGER NOT NULL DEFAULT 0,
    "h1s" JSONB,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "imagesMissingAlt" INTEGER NOT NULL DEFAULT 0,
    "internalLinks" INTEGER NOT NULL DEFAULT 0,
    "externalLinks" INTEGER NOT NULL DEFAULT 0,
    "hasSchema" BOOLEAN NOT NULL DEFAULT false,
    "hreflangTags" JSONB,
    "contentScore" INTEGER NOT NULL DEFAULT 0,
    "contentHash" TEXT,
    "responseTimeMs" INTEGER NOT NULL DEFAULT 0,
    "byteSize" INTEGER NOT NULL DEFAULT 0,
    "indexable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AuditPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLink" (
    "id" TEXT NOT NULL,
    "crawlId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "anchorText" TEXT,
    "isInternal" BOOLEAN NOT NULL DEFAULT true,
    "isNofollow" BOOLEAN NOT NULL DEFAULT false,
    "statusCode" INTEGER,

    CONSTRAINT "AuditLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedKeyword_siteId_idx" ON "SavedKeyword"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedKeyword_siteId_query_key" ON "SavedKeyword"("siteId", "query");

-- CreateIndex
CREATE INDEX "RankSnapshot_siteId_date_idx" ON "RankSnapshot"("siteId", "date");

-- CreateIndex
CREATE INDEX "RankSnapshot_siteId_query_date_idx" ON "RankSnapshot"("siteId", "query", "date");

-- CreateIndex
CREATE UNIQUE INDEX "RankSnapshot_siteId_query_date_key" ON "RankSnapshot"("siteId", "query", "date");

-- CreateIndex
CREATE INDEX "AuditPage_crawlId_idx" ON "AuditPage"("crawlId");

-- CreateIndex
CREATE INDEX "AuditPage_crawlId_url_idx" ON "AuditPage"("crawlId", "url");

-- CreateIndex
CREATE INDEX "AuditLink_crawlId_idx" ON "AuditLink"("crawlId");

-- CreateIndex
CREATE INDEX "AuditLink_crawlId_sourceUrl_idx" ON "AuditLink"("crawlId", "sourceUrl");

-- AddForeignKey
ALTER TABLE "SavedKeyword" ADD CONSTRAINT "SavedKeyword_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankSnapshot" ADD CONSTRAINT "RankSnapshot_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditPage" ADD CONSTRAINT "AuditPage_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "Crawl"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLink" ADD CONSTRAINT "AuditLink_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "Crawl"("id") ON DELETE CASCADE ON UPDATE CASCADE;
