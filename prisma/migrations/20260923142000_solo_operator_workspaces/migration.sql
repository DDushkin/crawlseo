CREATE TABLE "KeywordTarget" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "pageId" TEXT,
  "query" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'PRIMARY',
  "intent" TEXT,
  "country" TEXT NOT NULL DEFAULT 'UA',
  "language" TEXT NOT NULL DEFAULT 'uk',
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KeywordTarget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentBrief" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "targetId" TEXT,
  "pageId" TEXT,
  "title" TEXT NOT NULL,
  "content" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentBrief_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KeywordTarget_siteId_query_country_language_key" ON "KeywordTarget"("siteId", "query", "country", "language");
CREATE INDEX "KeywordTarget_siteId_pageId_idx" ON "KeywordTarget"("siteId", "pageId");
CREATE INDEX "ContentBrief_siteId_status_createdAt_idx" ON "ContentBrief"("siteId", "status", "createdAt");
CREATE INDEX "ContentBrief_siteId_targetId_idx" ON "ContentBrief"("siteId", "targetId");
ALTER TABLE "KeywordTarget" ADD CONSTRAINT "KeywordTarget_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KeywordTarget" ADD CONSTRAINT "KeywordTarget_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "SitePage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContentBrief" ADD CONSTRAINT "ContentBrief_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentBrief" ADD CONSTRAINT "ContentBrief_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "KeywordTarget"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContentBrief" ADD CONSTRAINT "ContentBrief_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "SitePage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
