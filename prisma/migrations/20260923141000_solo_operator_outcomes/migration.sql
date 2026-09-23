CREATE TABLE "SeoChange" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "actionId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "changedAt" DATE NOT NULL,
  "metricScope" TEXT NOT NULL,
  "metricKey" TEXT,
  "baselineStart" DATE NOT NULL,
  "baselineEnd" DATE NOT NULL,
  "afterStart" DATE NOT NULL,
  "afterEnd" DATE NOT NULL,
  "baselineClicks" INTEGER,
  "baselineImpressions" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeoChange_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeoOutcome" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "actionId" TEXT NOT NULL,
  "changeId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "afterClicks" INTEGER,
  "afterImpressions" INTEGER,
  "clickDelta" INTEGER,
  "clickChangePct" DOUBLE PRECISION,
  "impressionDelta" INTEGER,
  "qualification" TEXT NOT NULL,
  "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeoOutcome_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SeoChange_siteId_changedAt_idx" ON "SeoChange"("siteId", "changedAt");
CREATE INDEX "SeoChange_siteId_afterEnd_idx" ON "SeoChange"("siteId", "afterEnd");
CREATE UNIQUE INDEX "SeoOutcome_changeId_key" ON "SeoOutcome"("changeId");
CREATE INDEX "SeoOutcome_siteId_evaluatedAt_idx" ON "SeoOutcome"("siteId", "evaluatedAt");
ALTER TABLE "SeoChange" ADD CONSTRAINT "SeoChange_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeoChange" ADD CONSTRAINT "SeoChange_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "SeoAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeoOutcome" ADD CONSTRAINT "SeoOutcome_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeoOutcome" ADD CONSTRAINT "SeoOutcome_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "SeoAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeoOutcome" ADD CONSTRAINT "SeoOutcome_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "SeoChange"("id") ON DELETE CASCADE ON UPDATE CASCADE;
