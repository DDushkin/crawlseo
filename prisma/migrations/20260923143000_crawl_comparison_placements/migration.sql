CREATE TABLE "CrawlComparison" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "crawlId" TEXT NOT NULL,
  "baselineCrawlId" TEXT,
  "comparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "newCount" INTEGER NOT NULL,
  "persistentCount" INTEGER NOT NULL,
  "resolvedCount" INTEGER NOT NULL,
  CONSTRAINT "CrawlComparison_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CrawlComparison_crawlId_key" ON "CrawlComparison"("crawlId");
CREATE INDEX "CrawlComparison_siteId_comparedAt_idx" ON "CrawlComparison"("siteId", "comparedAt");
ALTER TABLE "CrawlComparison" ADD CONSTRAINT "CrawlComparison_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrawlComparison" ADD CONSTRAINT "CrawlComparison_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "Crawl"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrawlComparison" ADD CONSTRAINT "CrawlComparison_baselineCrawlId_fkey" FOREIGN KEY ("baselineCrawlId") REFERENCES "Crawl"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CrawlFinding" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "comparisonId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "details" JSONB,
  CONSTRAINT "CrawlFinding_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CrawlFinding_comparisonId_fingerprint_key" ON "CrawlFinding"("comparisonId", "fingerprint");
CREATE INDEX "CrawlFinding_siteId_status_idx" ON "CrawlFinding"("siteId", "status");
ALTER TABLE "CrawlFinding" ADD CONSTRAINT "CrawlFinding_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrawlFinding" ADD CONSTRAINT "CrawlFinding_comparisonId_fkey" FOREIGN KEY ("comparisonId") REFERENCES "CrawlComparison"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Placement" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "pageId" TEXT,
  "publisher" TEXT NOT NULL,
  "articleUrl" TEXT NOT NULL,
  "targetUrl" TEXT NOT NULL,
  "anchorText" TEXT,
  "articleTitle" TEXT,
  "publishedAt" DATE,
  "costUah" DOUBLE PRECISION NOT NULL,
  "feeUah" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'PLANNED',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Placement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Placement_siteId_articleUrl_targetUrl_key" ON "Placement"("siteId", "articleUrl", "targetUrl");
CREATE INDEX "Placement_siteId_publishedAt_idx" ON "Placement"("siteId", "publishedAt");
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "SitePage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PlacementCheck" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "placementId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "observedUrl" TEXT,
  "anchorText" TEXT,
  "rel" TEXT,
  "httpStatus" INTEGER,
  "error" TEXT,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlacementCheck_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PlacementCheck_siteId_placementId_checkedAt_idx" ON "PlacementCheck"("siteId", "placementId", "checkedAt");
ALTER TABLE "PlacementCheck" ADD CONSTRAINT "PlacementCheck_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlacementCheck" ADD CONSTRAINT "PlacementCheck_placementId_fkey" FOREIGN KEY ("placementId") REFERENCES "Placement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
