# CrawlSEO V2 — Full Implementation Plan

> Based on RESEARCH.md comparison with OpenSEO
> Date: 2026-07-20

---

## Phase 1: Database Schema Upgrade

### New Models

1. **AuditPage** — Per-page crawl data storage
   - `id`, `crawlId`, `url`, `statusCode`, `redirectUrl`
   - `title`, `description`, `canonical`, `robotsMeta`
   - `h1Count`, `h1s` (JSON), `wordCount`
   - `imageCount`, `imagesMissingAlt`, `imageDetails` (JSON)
   - `internalLinks`, `externalLinks`
   - `hasSchema`, `hreflangTags` (JSON)
   - `contentScore` (0-100), `contentHash` (SHA-256)
   - `responseTimeMs`, `byteSize`
   - `indexable` (Boolean)

2. **AuditLink** — Link graph edges
   - `id`, `crawlId`, `sourceUrl`, `targetUrl`
   - `anchorText`, `isInternal`, `isNofollow`
   - `statusCode`

3. **SavedKeyword** — User-saved keywords for tracking
   - `id`, `siteId`, `query`, `notes`, `createdAt`

4. **RankSnapshot** — Historical rank tracking
   - `id`, `siteId`, `query`, `position`, `clicks`, `impressions`, `page`, `date`
   - Distinct from Keyword (which is raw GSC data) — this is aggregated daily snapshots for tracking trends

### Schema Changes
- Add `maxPages` field to `Crawl` model (configurable crawl depth)
- Add `currentPhase` enum to `Crawl` (PENDING, CRAWLING, ANALYZING, COMPLETED, FAILED)

---

## Phase 2: Crawler Upgrade

### Background Job Architecture
- Replace in-request crawl with a streaming/background approach
- POST `/api/sites/[siteId]/crawl` creates the Crawl record and spawns the job
- GET `/api/sites/[siteId]/crawl/[crawlId]/status` polls progress
- Crawler runs in a separate async context with no request timeout dependency

### Concurrency
- Batch fetch 15 URLs in parallel using `Promise.allSettled`
- Respect per-domain rate limiting (100ms delay between batch starts)
- BFS with priority queue (link-discovered first, then sitemap URLs)

### Scale: 1000+ pages
- Default 200 pages, max 2000
- Configurable via `maxPages` parameter on POST

### New Features
- **robots-parser** library for proper robots.txt compliance
- **SHA-256 content hashing** for duplicate page detection
- **AuditPage storage** — full page metadata persisted per crawl
- **AuditLink storage** — complete internal link graph
- **Remediation guidance** — `howToFix` text per issue type

---

## Phase 3: MCP Server

### Architecture
- stdio transport via `@modelcontextprotocol/sdk`
- Entry point: `mcp/server.ts`
- Standalone Node.js process, communicates via stdin/stdout

### Tools (10)
1. `list_sites` — List all user sites with metrics summary
2. `get_site_overview` — Site KPIs, health score, latest crawl/vitals
3. `get_keywords` — Top keywords with position, clicks, impressions
4. `get_pages` — Top pages with metrics
5. `get_traffic` — Daily traffic time series
6. `run_crawl` — Start a site crawl
7. `get_crawl_status` — Poll crawl progress
8. `get_crawl_issues` — Prioritized issues with remediation
9. `get_vitals` — Core Web Vitals reports
10. `get_opportunities` — SEO opportunities feed

### Output Format
- Structured text tables for LLM consumption
- Formatters that produce compact, token-efficient output

---

## Phase 4: GSC Improvements

### Server-side Filters
- Add `dimensionFilterGroups` support to `fetchSearchAnalytics`
- Filter operators: equals, notEquals, contains, notContains
- New API parameter: `filters` array on sync/query endpoints

### Data Lag Indicator
- Show "Data available through ~2-3 days ago" in UI
- Calculate actual latest data date from stored records

### Rank Tracking
- Daily snapshots via `RankSnapshot` model
- Historical comparison view (7d, 28d, 90d position changes)
- Track saved keywords specifically

---

## Phase 5: UI Redesign

### Layout: Collapsible Sidebar
- Replace dual sidebar (icon rail + nav panel) with single collapsible sidebar
- Sidebar states: expanded (240px) / collapsed (icons only, 64px)
- Toggle button to collapse/expand
- Mobile: hamburger drawer
- Project/site selector at top of sidebar
- User card + theme toggle at bottom

### Sidebar Navigation (with Lucide icons)
- **General**: Dashboard, Sites
- **Workspace** (when site selected): Overview, Keywords, Saved Keywords, Pages, Crawl/Audit, Vitals, Opportunities, Alerts, Settings
- **Properties**: Quick site switcher list

### New Pages
1. **Dashboard** — Portfolio overview + 4-step onboarding checklist
2. **Saved Keywords** — `/sites/[siteId]/saved-keywords`
3. **Settings** — `/sites/[siteId]/settings`
4. **Rank Tracking** — integrated into Keywords page with history tab

### Onboarding Checklist (4 steps)
1. Add a site (GSC property)
2. Connect Google Search Console
3. Run first data sync
4. Run first crawl

### CSV Export
- Export buttons on Keywords, Pages, Opportunities tables
- Uses existing `/api/sites/[siteId]/export` endpoint

### Data Lag Indicator
- Badge/tooltip showing "GSC data delayed ~2-3 days" on relevant pages

---

## File Changes Summary

### New Files
- `prisma/migrations/[timestamp]_v2_upgrade/migration.sql`
- `lib/crawler/engine-v2.ts` (upgraded crawler)
- `lib/crawler/remediation.ts` (how-to-fix guidance)
- `mcp/server.ts` (MCP server entry)
- `mcp/tools/*.ts` (MCP tool handlers)
- `mcp/formatters.ts` (LLM output formatters)
- `app/(dashboard)/sites/[siteId]/saved-keywords/page.tsx`
- `app/(dashboard)/sites/[siteId]/settings/page.tsx`
- `app/api/sites/[siteId]/saved-keywords/route.ts`
- `app/api/sites/[siteId]/crawl/[crawlId]/status/route.ts`
- `components/dashboard/onboarding-checklist.tsx`

### Modified Files
- `prisma/schema.prisma` — new models
- `package.json` — new dependencies
- `components/layout/app-shell.tsx` — collapsible sidebar
- `components/layout/sidebar-nav.tsx` — icons, collapsible
- `lib/google/gsc-client.ts` — dimensionFilterGroups
- `app/(dashboard)/dashboard/page.tsx` — onboarding
- All site subpages — CSV export buttons, data lag indicator
