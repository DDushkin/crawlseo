# Solo SEO Operator Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn CrawlSEO into a site-scoped operating workflow that explains changes, recommends work, records execution, and measures outcomes, including AI visibility and placement spend.

**Architecture:** Preserve the GSC V2 truth layer and `Site` tenancy. Add durable page, target, action, change, outcome, brief, placement, prompt, and AI observation records. Provider adapters normalize evidence before recommendation logic. Keep paid calls opt-in and separate observed first-party metrics from third-party samples.

**Tech Stack:** Next.js App Router, TypeScript, Prisma/PostgreSQL, React, node:test, DataForSEO and Google APIs.

**Spec:** `docs/superpowers/specs/2026-09-14-solo-seo-operator-design.md`.

## Global Constraints

- Preserve `Site` as the tenancy boundary and verify ownership on every API call.
- Keep GSC property totals separate from query/page aggregates; never relabel estimates as actual clicks.
- A page load and an unconfirmed action never send a paid provider request.
- Sandbox data is synthetic and never becomes a real action or visibility trend.
- A failed import or crawl never replaces the last good evidence.
- New schema is additive; existing GSC and user-owned docs remain untouched.

## Review Focus

- Cross-site IDs in nested routes must return 404 without revealing the foreign record; Tasks 1–7 each test this.
- Duplicate detection must refresh one stable action, not create another; Task 1 tests this.
- A completed action must retain its baseline and use an equivalent comparison period; Task 2 tests this.
- Missing, partial, stale, and zero evidence must produce different UI states; Tasks 2, 4, and 6 test this.
- Live DataForSEO batches cannot exceed site budget, and cancelled previews cannot charge; Tasks 5 and 6 test this.

---

### Task 1: Durable page identities and action engine

**Files:** `prisma/schema.prisma`, new migration, `lib/operator/actions.ts`, `app/api/sites/[siteId]/actions/route.ts`, `app/api/sites/[siteId]/actions/[actionId]/route.ts`, `tests/operator-actions.test.ts`.

**Interfaces:** `upsertDetectedAction(siteId, finding)` stores one `SeoAction` per stable fingerprint. Site-scoped GET/PATCH routes expose actions and status transitions. `SitePage` represents canonical URL separately from GSC daily rows.

- [ ] Write focused tests for stable fingerprints, repeat detection, priority ordering, status transitions, and foreign-site rejection. Run `node --import tsx --test tests/operator-actions.test.ts`; confirm failure because the interfaces do not exist.
- [ ] Add additive schema and migration, implement pure prioritization plus transactional upsert, then authenticated read/update routes.
- [ ] Re-run focused tests and `node --import tsx --test tests/*.test.ts`; commit the task.

### Task 2: Changes and measured outcomes

**Files:** `prisma/schema.prisma`, new migration, `lib/operator/outcomes.ts`, `app/api/sites/[siteId]/actions/[actionId]/complete/route.ts`, `tests/operator-outcomes.test.ts`.

**Interfaces:** `completeAction(siteId, actionId, change)` records `SeoChange` with GSC baseline. `evaluateCompletedActions(siteId, asOf)` writes `SeoOutcome` with an equivalent post-change range and evidence qualification.

- [ ] Write tests for baseline preservation, insufficient finalized GSC coverage, equal-length comparison windows, idempotent evaluation, and tenant isolation. Run focused tests red.
- [ ] Implement additive models and services using `GscDailyTotal` for property trends and `GscPageDaily` for page-specific outcomes. Never claim causation.
- [ ] Re-run focused and full tests; commit the task.

### Task 3: Page and keyword workspaces with evidence-backed briefs

**Files:** `prisma/schema.prisma`, migration, `lib/operator/pages.ts`, `lib/operator/briefs.ts`, `app/api/sites/[siteId]/page-inventory/route.ts`, `app/api/sites/[siteId]/keyword-targets/route.ts`, `app/api/sites/[siteId]/briefs/route.ts`, page components under `app/(dashboard)/sites/[siteId]/`, `tests/operator-workspace.test.ts`.

**Interfaces:** `KeywordTarget` links a query to a `SitePage` after user confirmation. `ContentBrief` snapshots first-party metrics and cited external evidence; its action is optimize, consolidate, create, or reject.

- [ ] Write tests for domain-safe canonicalization, explicit target confirmation, duplicate mapping, brief provenance, and missing SERP evidence. Run focused tests red.
- [ ] Implement site-scoped inventory, target map, brief editor, and route handlers without automatically publishing site changes.
- [ ] Re-run focused/full tests and typecheck; commit the task.

### Task 4: Technical comparison and placement ledger

**Files:** `prisma/schema.prisma`, migration, `lib/operator/crawl-diff.ts`, `lib/operator/placements.ts`, `app/api/sites/[siteId]/placements/route.ts`, dedicated crawl/placement pages, `tests/operator-crawl-placements.test.ts`.

**Interfaces:** Completed crawls only create new/persistent/resolved findings. `Placement` stores publisher URL, target URL, UAH cost, live-link checks, and page outcome; DataForSEO non-observation never means the link is absent.

- [ ] Write tests for incomplete-crawl baseline protection, finding classification, exact-URL placement matching, fee accounting, and tenant isolation. Run focused tests red.
- [ ] Implement immutable comparison and placement records; reuse confirmed provider calls and independently verify article links.
- [ ] Re-run focused/full tests and typecheck; commit the task.

### Task 5: Separate research workspaces and prompt panel

**Files:** `prisma/schema.prisma`, migration, `lib/operator/ai-prompts.ts`, `app/api/sites/[siteId]/ai-prompts/route.ts`, separate competitor, placement, and AI routes/pages, `components/layout/sidebar-nav.tsx`, `tests/operator-research-pages.test.ts`.

**Interfaces:** Existing `DataForSeoRun` history stays readable but each workflow gets its own page/history. `AiPrompt` is a fixed site-scoped customer-intent question with market/language and active state.

- [ ] Write tests for per-workflow history, prompt deduplication, user edits, sandbox exclusion, and legacy-route redirects. Run focused tests red.
- [ ] Implement dedicated workspaces and prompt management; retain cost preview/confirmation for all provider operations.
- [ ] Re-run focused/full tests and typecheck; commit the task.

### Task 6: Measured AI visibility and GA4 outcomes

**Files:** `prisma/schema.prisma`, migration, `lib/operator/ai-visibility.ts`, `lib/google/ga4-client.ts`, GSC AI export parser/import route, GA4 connection/sync routes, AI visibility page, `tests/operator-ai-visibility.test.ts`.

**Interfaces:** Store `AiVisibilityRun`/`AiVisibilityResult`, `GscAiDaily`, and `AiReferralDaily` separately. Display actual Google AI impressions, GA4 sessions/key events, and fixed-panel ChatGPT citation counts as distinct series with source, locale, prompt count, sample time, and coverage.

- [ ] Write tests for source separation, repeat-panel denominator, cited versus merely retrieved URLs, import property/date validation, GA4 referrer classification, and no paid call on GET. Run focused tests red.
- [ ] Implement validated official GSC export import (rather than undocumented endpoints), opt-in GA4 readonly OAuth, and manually confirmed DataForSEO panel runs with persistent results.
- [ ] Re-run focused/full tests, typecheck, and inspect real GSC export format before claiming live import compatibility; commit the task.

### Task 7: Today view, weekly report, and release verification

**Files:** `lib/operator/weekly-report.ts`, site overview page/components, `app/api/sites/[siteId]/weekly-report/route.ts`, `tests/operator-weekly.test.ts`, deployment documentation.

**Interfaces:** Today shows data health, top three actions, work awaiting measurement, and confirmed outcomes. Weekly report includes first-party traffic, actions and outcomes, technical changes, AI evidence when connected, and provider spend.

- [ ] Write tests for priority cap, stale/unavailable data labels, partial-site failure isolation, and a usable free-data report. Run focused tests red.
- [ ] Implement report composition and page; verify responsive UI, authenticated routes, migration deployment, rollback safety, multi-site isolation, and browser behavior against Strum.
- [ ] Run the full suite, `npx tsc --noEmit`, scoped lint, `npm run build`, and deployment smoke checks. Release only after source data and paid-provider limits are visibly correct; commit the task.
