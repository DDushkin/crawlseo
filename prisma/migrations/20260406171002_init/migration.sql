-- CreateEnum
CREATE TYPE "CrawlStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "IssueType" AS ENUM ('BROKEN_LINK', 'REDIRECT', 'MISSING_TITLE', 'MISSING_DESCRIPTION', 'DUPLICATE_TITLE', 'DUPLICATE_DESCRIPTION', 'MISSING_H1', 'MULTIPLE_H1', 'MISSING_ALT', 'MISSING_CANONICAL', 'MISSING_ROBOTS', 'MISSING_SITEMAP', 'MISSING_SCHEMA', 'SLOW_PAGE', 'MIXED_CONTENT', 'LARGE_PAGE');

-- CreateEnum
CREATE TYPE "IssueSeverity" AS ENUM ('CRITICAL', 'WARNING', 'INFO');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('TRAFFIC_DROP', 'POSITION_CHANGE', 'NEW_404', 'VITALS_DEGRADED', 'CRAWL_ISSUES');

-- CreateEnum
CREATE TYPE "AlertChannel" AS ENUM ('EMAIL', 'TELEGRAM', 'WEBHOOK', 'SLACK');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "image" TEXT,
    "googleTokens" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "gscProperty" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Keyword" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "page" TEXT,
    "device" TEXT,
    "country" TEXT,

    CONSTRAINT "Keyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Crawl" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "status" "CrawlStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "pagesFound" INTEGER NOT NULL DEFAULT 0,
    "issuesFound" INTEGER NOT NULL DEFAULT 0,
    "healthScore" INTEGER,

    CONSTRAINT "Crawl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlIssue" (
    "id" TEXT NOT NULL,
    "crawlId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" "IssueType" NOT NULL,
    "severity" "IssueSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "details" JSONB,

    CONSTRAINT "CrawlIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VitalsReport" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device" TEXT NOT NULL,
    "lcp" DOUBLE PRECISION,
    "fid" DOUBLE PRECISION,
    "cls" DOUBLE PRECISION,
    "inp" DOUBLE PRECISION,
    "perfScore" INTEGER,
    "speedIndex" DOUBLE PRECISION,
    "ttfb" DOUBLE PRECISION,

    CONSTRAINT "VitalsReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "type" "AlertType" NOT NULL,
    "channel" "AlertChannel" NOT NULL,
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastFired" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "Site_userId_domain_key" ON "Site"("userId", "domain");

-- CreateIndex
CREATE INDEX "Keyword_siteId_date_idx" ON "Keyword"("siteId", "date");

-- CreateIndex
CREATE INDEX "Keyword_siteId_query_date_idx" ON "Keyword"("siteId", "query", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Keyword_siteId_query_date_key" ON "Keyword"("siteId", "query", "date");

-- CreateIndex
CREATE INDEX "Page_siteId_date_idx" ON "Page"("siteId", "date");

-- CreateIndex
CREATE INDEX "Page_siteId_url_date_idx" ON "Page"("siteId", "url", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Page_siteId_url_date_key" ON "Page"("siteId", "url", "date");

-- CreateIndex
CREATE INDEX "Crawl_siteId_startedAt_idx" ON "Crawl"("siteId", "startedAt");

-- CreateIndex
CREATE INDEX "CrawlIssue_crawlId_type_idx" ON "CrawlIssue"("crawlId", "type");

-- CreateIndex
CREATE INDEX "VitalsReport_siteId_date_idx" ON "VitalsReport"("siteId", "date");

-- CreateIndex
CREATE INDEX "VitalsReport_siteId_url_date_idx" ON "VitalsReport"("siteId", "url", "date");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Keyword" ADD CONSTRAINT "Keyword_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Crawl" ADD CONSTRAINT "Crawl_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlIssue" ADD CONSTRAINT "CrawlIssue_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "Crawl"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VitalsReport" ADD CONSTRAINT "VitalsReport_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
