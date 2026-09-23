-- Additive action and canonical-page tables. Existing GSC and legacy Page data are preserved.
CREATE TABLE "SitePage" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "pageType" TEXT,
  "state" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SitePage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeoAction" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "pageId" TEXT,
  "fingerprint" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "pageUrl" TEXT,
  "query" TEXT,
  "title" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "recommendation" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "expectedClicks" DOUBLE PRECISION,
  "confidence" TEXT NOT NULL,
  "effort" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "priority" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NEW',
  "owner" TEXT,
  "dueAt" TIMESTAMP(3),
  "notes" TEXT,
  "checklist" JSONB,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dismissedUntil" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SeoAction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SitePage_siteId_url_key" ON "SitePage"("siteId", "url");
CREATE INDEX "SitePage_siteId_state_idx" ON "SitePage"("siteId", "state");
CREATE UNIQUE INDEX "SeoAction_siteId_fingerprint_key" ON "SeoAction"("siteId", "fingerprint");
CREATE INDEX "SeoAction_siteId_status_priority_idx" ON "SeoAction"("siteId", "status", "priority");
CREATE INDEX "SeoAction_siteId_pageUrl_idx" ON "SeoAction"("siteId", "pageUrl");
ALTER TABLE "SitePage" ADD CONSTRAINT "SitePage_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeoAction" ADD CONSTRAINT "SeoAction_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeoAction" ADD CONSTRAINT "SeoAction_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "SitePage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
