# GSC Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace CrawlSEO's corrupted Google Search Console storage and calculations with aggregation-correct, site-isolated data that reconciles with the same finalized Search Console report.

**Architecture:** Add a versioned GSC read model with one table per aggregation and keep the legacy `Keyword` and `Page` tables intact. A typed Google adapter feeds one shared, lease-protected synchronization service; dashboard, API, export, alert, opportunity, and MCP consumers cut over through a compatibility facade only after a site's backfill succeeds.

**Tech Stack:** Next.js 16 App Router, TypeScript 5, Prisma 6, PostgreSQL, React 19, Node's built-in test runner through `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-09-14-gsc-data-foundation-design.md`

## Global Constraints

- `Site` remains the multi-site tenancy boundary.
- All GSC dates use Search Console's Pacific Time calendar semantics and are stored with Prisma `DateTime @db.Date`.
- A 28-day range contains exactly 28 finalized dates.
- Property totals, queries, pages, query-page pairs, devices, and countries are fetched independently.
- Cards and site-wide charts use only property-aggregated daily totals.
- Query/page breakdown sums are never substituted for property totals.
- Existing `Keyword`, `Page`, and `RankSnapshot` rows are neither deleted nor rewritten.
- Failed or partial imports do not erase the last known good scope.
- No paid API or undocumented Google endpoint is introduced.
- Manual, initial, scheduled, and CLI synchronization call the same service.
- `GSC_READ_MODEL_V2=false` is the global emergency rollback switch; otherwise a site reads V2 only after `gscDataVersion` becomes `2`.
- No new runtime dependency is required.

---

## File Responsibility Map

### New files

- `lib/gsc/types.ts` — normalized provider, storage, synchronization, reconciliation, and health contracts.
- `lib/gsc/date-range.ts` — date-label arithmetic and finalized GSC window selection.
- `lib/gsc/aggregate.ts` — correct period aggregation and comparison math.
- `lib/gsc/reconciliation.ts` — aggregation-aware coverage checks and warning generation.
- `lib/gsc/store.ts` — `GscStore` interface and Prisma implementation, including leases and scoped replacement.
- `lib/gsc/sync-service.ts` — the single orchestration service for all GSC imports.
- `lib/gsc/read-model.ts` — V2 queries and the legacy/V2 selection policy.
- `lib/gsc/health.ts` — site data-health projection.
- `lib/gsc/cron-auth.ts` — timing-safe bearer-secret validation for cron requests.
- `lib/gsc/manual-sync-handler.ts` — testable manual-route authorization, input validation, and status mapping.
- `app/api/cron/gsc-sync/route.ts` — protected scheduled synchronization entry point.
- `components/sites/gsc-data-health.tsx` — actual property, coverage, freshness, and warning display.
- `scripts/backfill-gsc.ts` — explicit one-site or all-site 90-day backfill command.
- `scripts/verify-gsc.ts` — read-only comparison between fresh property totals and stored V2 totals.
- `docs/gsc-sync-operations.md` — self-hosted scheduling, rollout, verification, and rollback runbook.
- `tests/gsc-date-range.test.ts` — date and Pacific Time boundary tests.
- `tests/gsc-aggregate.test.ts` — CTR, position, comparison, and unavailable-value tests.
- `tests/gsc-client.test.ts` — request shape, dimension mapping, pagination, and provider-error tests.
- `tests/gsc-reconciliation.test.ts` — property/breakdown coverage semantics.
- `tests/gsc-sync-service.test.ts` — lease, idempotency, partial import, and site-isolation behavior using fakes.
- `tests/gsc-read-model.test.ts` — read-version policy and normalized period selection.
- `tests/gsc-cron-auth.test.ts` — cron-secret authorization behavior.
- `tests/gsc-route-policy.test.ts` — manual-route authentication, ownership-error, validation, and result mapping.
- `tests/gsc-verification.test.ts` — reconciliation diff output.
- `prisma/migrations/20260915090000_add_gsc_read_model_v2/migration.sql` — additive schema migration.

### Modified files

- `prisma/schema.prisma` — new models, enums, site relations, `gscSearchType`, `gscDataVersion`, and `lastGscSyncAt`.
- `lib/google/gsc-client.ts` — replace positional parsing with report-aware typed pagination.
- `lib/google/index.ts` — export the new adapter types/functions.
- `lib/workers/gsc-sync.ts` — become a thin wrapper over `syncGscSite`.
- `app/api/gsc/sync/route.ts` — authorize and call the shared service; remove direct Prisma writes.
- `app/api/sites/route.ts` — start an initial backfill through the shared service and return V2 state.
- `lib/seo-metrics.ts` — preserve public functions while delegating to V2 or legacy readers.
- `lib/seo-opportunities.ts` — read page decay and query-page relationships through the metrics facade.
- `lib/alerts/evaluate.ts` — handle unavailable deltas and corrected metrics.
- `app/api/sites/[siteId]/rank-history/route.ts` — replace direct legacy keyword reads.
- `app/api/sites/[siteId]/saved-keywords/route.ts` — replace direct legacy keyword reads.
- `app/api/sites/[siteId]/domain-overview/route.ts` — use normalized keyword counts.
- `app/(dashboard)/sites/[siteId]/saved-keywords/page.tsx` — use the normalized saved-keyword metrics reader.
- `app/(dashboard)/dashboard/page.tsx` — use actual V2 availability instead of legacy row count.
- `app/(dashboard)/sites/page.tsx` — report normalized query/page counts.
- `app/(dashboard)/sites/[siteId]/page.tsx` — use actual data health and coverage.
- `app/(dashboard)/sites/[siteId]/opportunities/page.tsx` — use actual data availability.
- `app/(dashboard)/sites/[siteId]/settings/page.tsx` — show V2 stored-data counts and sync state.
- `components/dashboard/metrics.tsx` — render unavailable CTR/position safely and show actual dates.
- `components/dashboard/traffic-chart.tsx` — display the returned coverage instead of assuming today-based dates.
- `components/sites/sync-button.tsx` — display normalized sync counts and warning status.
- `mcp/server.ts` — report V2 counts while keeping the existing tool contract.
- `scripts/seed-demo.ts` — seed coherent V2 demo aggregates and mark the demo site as V2-ready.
- `.env.example` — document `CRON_SECRET` and `GSC_READ_MODEL_V2`.
- `package.json` — add backfill and verification scripts.
- `vercel.json` — set the cron sync route duration consistently with the manual route.

---

### Task 1: GSC Calendar and Metric Primitives

**Files:**
- Create: `lib/gsc/types.ts`
- Create: `lib/gsc/date-range.ts`
- Create: `lib/gsc/aggregate.ts`
- Create: `tests/gsc-date-range.test.ts`
- Create: `tests/gsc-aggregate.test.ts`

**Interfaces:**
- Produces: `GscDateRange`, `GscMetricRow`, `AggregatedGscMetrics`, `shiftDateLabel()`, `inclusiveRangeEnding()`, `previousDateRange()`, `pacificDateLabel()`, `toDbDate()`, `aggregateGscMetrics()`, and `compareGscMetrics()`.
- Consumes: no application or database state.

- [ ] **Step 1: Write failing date-label tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  inclusiveRangeEnding,
  pacificDateLabel,
  previousDateRange,
  shiftDateLabel,
  toDbDate,
} from "../lib/gsc/date-range";

test("creates an inclusive 28-date range", () => {
  assert.deepEqual(inclusiveRangeEnding("2026-09-12", 28), {
    startDate: "2026-08-16",
    endDate: "2026-09-12",
  });
});

test("creates the immediately preceding comparison range", () => {
  assert.deepEqual(previousDateRange({ startDate: "2026-08-16", endDate: "2026-09-12" }), {
    startDate: "2026-07-19",
    endDate: "2026-08-15",
  });
});

test("date arithmetic survives leap day and stores a date label without local conversion", () => {
  assert.equal(shiftDateLabel("2024-03-01", -1), "2024-02-29");
  assert.equal(toDbDate("2026-09-12").toISOString(), "2026-09-12T00:00:00.000Z");
});

test("Pacific date label follows America/Los_Angeles at the UTC boundary", () => {
  assert.equal(pacificDateLabel(new Date("2026-09-15T06:30:00.000Z")), "2026-09-14");
  assert.equal(pacificDateLabel(new Date("2026-09-15T08:30:00.000Z")), "2026-09-15");
});
```

- [ ] **Step 2: Run date tests and confirm the missing-module failure**

Run: `npx tsx --test tests/gsc-date-range.test.ts`

Expected: FAIL with `Cannot find module '../lib/gsc/date-range'`.

- [ ] **Step 3: Define normalized GSC contracts**

Create `lib/gsc/types.ts` with these exact public shapes:

```ts
export const GSC_REPORT_KINDS = [
  "dailyTotal",
  "query",
  "page",
  "queryPage",
  "device",
  "country",
] as const;

export type GscReportKind = (typeof GSC_REPORT_KINDS)[number];
export type GscSearchType = "web";
export type GscDataState = "final" | "all";
export type GscDateRange = { startDate: string; endDate: string };

export type GscMetricRow = {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  query?: string;
  url?: string;
  device?: string;
  country?: string;
};

export type GscReportResult = {
  kind: GscReportKind;
  rows: GscMetricRow[];
  complete: boolean;
  pagesFetched: number;
  truncatedAt: number | null;
};

export type AggregatedGscMetrics = {
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
};

export function emptyGscReportCounts(): Record<GscReportKind, number> {
  return {
    dailyTotal: 0,
    query: 0,
    page: 0,
    queryPage: 0,
    device: 0,
    country: 0,
  };
}
```

- [ ] **Step 4: Implement calendar-date arithmetic**

Create `lib/gsc/date-range.ts`. Parse labels into `Date.UTC`, mutate only UTC calendar fields, and format from UTC fields. Format the current Pacific label with `Intl.DateTimeFormat(...).formatToParts()` so the result does not depend on the server timezone.

```ts
import type { GscDateRange } from "./types";

const DATE_LABEL = /^\d{4}-\d{2}-\d{2}$/;

export function shiftDateLabel(label: string, days: number): string {
  if (!DATE_LABEL.test(label)) throw new Error(`Invalid GSC date: ${label}`);
  const date = new Date(`${label}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid GSC date: ${label}`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function inclusiveRangeEnding(endDate: string, days: number): GscDateRange {
  if (!Number.isInteger(days) || days < 1) throw new Error("days must be a positive integer");
  return { startDate: shiftDateLabel(endDate, -(days - 1)), endDate };
}

export function previousDateRange(range: GscDateRange): GscDateRange {
  const dayCount = Math.round(
    (toDbDate(range.endDate).getTime() - toDbDate(range.startDate).getTime()) / 86_400_000
  ) + 1;
  return {
    startDate: shiftDateLabel(range.startDate, -dayCount),
    endDate: shiftDateLabel(range.startDate, -1),
  };
}

export function pacificDateLabel(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function toDbDate(label: string): Date {
  if (!DATE_LABEL.test(label)) throw new Error(`Invalid GSC date: ${label}`);
  return new Date(`${label}T00:00:00.000Z`);
}
```

- [ ] **Step 5: Run date tests and confirm they pass**

Run: `npx tsx --test tests/gsc-date-range.test.ts`

Expected: 4 tests PASS.

- [ ] **Step 6: Write failing metric aggregation tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { aggregateGscMetrics, compareGscMetrics } from "../lib/gsc/aggregate";

test("calculates CTR from totals and position by impressions", () => {
  assert.deepEqual(
    aggregateGscMetrics([
      { clicks: 10, impressions: 100, position: 2 },
      { clicks: 0, impressions: 300, position: 10 },
    ]),
    { clicks: 10, impressions: 400, ctr: 0.025, position: 8 }
  );
});

test("returns unavailable CTR and position when impressions are zero", () => {
  assert.deepEqual(aggregateGscMetrics([{ clicks: 0, impressions: 0, position: 0 }]), {
    clicks: 0,
    impressions: 0,
    ctr: null,
    position: null,
  });
});

test("comparison keeps unavailable metrics unavailable", () => {
  assert.deepEqual(
    compareGscMetrics(
      { clicks: 0, impressions: 0, ctr: null, position: null },
      { clicks: 0, impressions: 0, ctr: null, position: null }
    ),
    { clicks: 0, impressions: 0, ctr: null, position: null }
  );
});
```

- [ ] **Step 7: Implement metric aggregation and comparison**

Create `lib/gsc/aggregate.ts`. Use `calculatePercentChange` only for count metrics; return `null` when either CTR or position is unavailable. Position improvement is previous minus current.

```ts
import { calculatePercentChange } from "../date-utils";
import type { AggregatedGscMetrics } from "./types";

type MetricInput = { clicks: number; impressions: number; position: number };

export function aggregateGscMetrics(rows: MetricInput[]): AggregatedGscMetrics {
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  if (impressions === 0) return { clicks, impressions, ctr: null, position: null };
  const weightedPosition = rows.reduce(
    (sum, row) => sum + row.position * row.impressions,
    0
  );
  return {
    clicks,
    impressions,
    ctr: clicks / impressions,
    position: weightedPosition / impressions,
  };
}

export function compareGscMetrics(current: AggregatedGscMetrics, previous: AggregatedGscMetrics) {
  return {
    clicks: calculatePercentChange(current.clicks, previous.clicks),
    impressions: calculatePercentChange(current.impressions, previous.impressions),
    ctr: current.ctr === null || previous.ctr === null
      ? null
      : calculatePercentChange(current.ctr, previous.ctr),
    position: current.position === null || previous.position === null
      ? null
      : previous.position - current.position,
  };
}
```

- [ ] **Step 8: Run focused and existing tests**

Run: `npx tsx --test tests/gsc-date-range.test.ts tests/gsc-aggregate.test.ts`

Expected: all GSC primitive tests PASS.

Run: `npm test`

Expected: crawler and GSC primitive tests PASS.

- [ ] **Step 9: Commit the primitives**

```bash
git add lib/gsc/types.ts lib/gsc/date-range.ts lib/gsc/aggregate.ts tests/gsc-date-range.test.ts tests/gsc-aggregate.test.ts
git commit -m "test: define GSC date and metric rules"
```

---

### Task 2: Additive Prisma Read Model

**Files:**
- Modify: `prisma/schema.prisma:83-141`
- Create: `prisma/migrations/20260915090000_add_gsc_read_model_v2/migration.sql`

**Interfaces:**
- Consumes: the report kinds and search type defined in Task 1.
- Produces: Prisma delegates `gscDailyTotal`, `gscQueryDaily`, `gscPageDaily`, `gscQueryPageDaily`, `gscDeviceDaily`, `gscCountryDaily`, `gscSyncRun`, and `gscSyncLease`.

- [ ] **Step 1: Add a schema-contract test that inspects Prisma's data model**

Create `tests/gsc-schema.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("GSC V2 schema has site-scoped aggregation keys and keeps legacy models", async () => {
  const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  for (const model of [
    "Keyword",
    "Page",
    "GscDailyTotal",
    "GscQueryDaily",
    "GscPageDaily",
    "GscQueryPageDaily",
    "GscDeviceDaily",
    "GscCountryDaily",
    "GscSyncRun",
    "GscSyncLease",
  ]) {
    assert.match(schema, new RegExp(`model ${model} \\{`));
  }
  assert.match(schema, /@@unique\(\[siteId, searchType, date, query, url\]\)/);
});
```

- [ ] **Step 2: Run the schema test and verify it fails**

Run: `npx tsx --test tests/gsc-schema.test.ts`

Expected: FAIL because `GscDailyTotal` is absent.

- [ ] **Step 3: Add site fields, relations, enums, and models**

Add these site fields with defaults that preserve every existing row:

```prisma
model Site {
  id              String    @id @default(cuid())
  userId          String
  domain          String
  gscProperty     String?
  gscSearchType   String    @default("web")
  gscDataVersion  Int       @default(1)
  lastGscSyncAt   DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  user              User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  keywords          Keyword[]
  pages             Page[]
  crawls            Crawl[]
  vitals            VitalsReport[]
  alerts            Alert[]
  savedKeywords     SavedKeyword[]
  rankSnapshots     RankSnapshot[]
  gscDailyTotals    GscDailyTotal[]
  gscQueryDaily     GscQueryDaily[]
  gscPageDaily      GscPageDaily[]
  gscQueryPageDaily GscQueryPageDaily[]
  gscDeviceDaily    GscDeviceDaily[]
  gscCountryDaily   GscCountryDaily[]
  gscSyncRuns       GscSyncRun[]
  gscSyncLease      GscSyncLease?

  @@unique([userId, domain])
}

enum GscSyncTrigger {
  INITIAL
  MANUAL
  SCHEDULED
  CLI
}

enum GscSyncStatus {
  RUNNING
  COMPLETED
  COMPLETED_WITH_WARNINGS
  FAILED
}
```

Define all metric models using the following exact common fields: `id String @id @default(cuid())`, `siteId String`, `date DateTime @db.Date`, `searchType String @default("web")`, `clicks Int @default(0)`, `impressions Int @default(0)`, `ctr Float`, `position Float`, `syncRunId String?`, `createdAt DateTime @default(now())`, and `updatedAt DateTime @updatedAt`. Each model relates `site` with `onDelete: Cascade` and optional `syncRun` with `onDelete: SetNull`.

Use these exact dimension fields and unique keys:

```prisma
model GscDailyTotal {
  id          String   @id @default(cuid())
  siteId      String
  date        DateTime @db.Date
  searchType  String   @default("web")
  clicks      Int      @default(0)
  impressions Int      @default(0)
  ctr         Float
  position    Float
  syncRunId   String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  site        Site       @relation(fields: [siteId], references: [id], onDelete: Cascade)
  syncRun     GscSyncRun? @relation(fields: [syncRunId], references: [id], onDelete: SetNull)
  @@unique([siteId, searchType, date])
  @@index([siteId, date])
}

model GscQueryDaily {
  id String @id @default(cuid())
  siteId String
  date DateTime @db.Date
  searchType String @default("web")
  query String
  clicks Int @default(0)
  impressions Int @default(0)
  ctr Float
  position Float
  syncRunId String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  site Site @relation(fields: [siteId], references: [id], onDelete: Cascade)
  syncRun GscSyncRun? @relation(fields: [syncRunId], references: [id], onDelete: SetNull)
  @@unique([siteId, searchType, date, query])
  @@index([siteId, date])
  @@index([siteId, query, date])
}

model GscPageDaily {
  id String @id @default(cuid())
  siteId String
  date DateTime @db.Date
  searchType String @default("web")
  url String
  clicks Int @default(0)
  impressions Int @default(0)
  ctr Float
  position Float
  syncRunId String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  site Site @relation(fields: [siteId], references: [id], onDelete: Cascade)
  syncRun GscSyncRun? @relation(fields: [syncRunId], references: [id], onDelete: SetNull)
  @@unique([siteId, searchType, date, url])
  @@index([siteId, date])
  @@index([siteId, url, date])
}

model GscQueryPageDaily {
  id String @id @default(cuid())
  siteId String
  date DateTime @db.Date
  searchType String @default("web")
  query String
  url String
  clicks Int @default(0)
  impressions Int @default(0)
  ctr Float
  position Float
  syncRunId String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  site Site @relation(fields: [siteId], references: [id], onDelete: Cascade)
  syncRun GscSyncRun? @relation(fields: [syncRunId], references: [id], onDelete: SetNull)
  @@unique([siteId, searchType, date, query, url])
  @@index([siteId, query, date])
  @@index([siteId, url, date])
}

model GscDeviceDaily {
  id String @id @default(cuid())
  siteId String
  date DateTime @db.Date
  searchType String @default("web")
  device String
  clicks Int @default(0)
  impressions Int @default(0)
  ctr Float
  position Float
  syncRunId String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  site Site @relation(fields: [siteId], references: [id], onDelete: Cascade)
  syncRun GscSyncRun? @relation(fields: [syncRunId], references: [id], onDelete: SetNull)
  @@unique([siteId, searchType, date, device])
  @@index([siteId, date])
}

model GscCountryDaily {
  id String @id @default(cuid())
  siteId String
  date DateTime @db.Date
  searchType String @default("web")
  country String
  clicks Int @default(0)
  impressions Int @default(0)
  ctr Float
  position Float
  syncRunId String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  site Site @relation(fields: [siteId], references: [id], onDelete: Cascade)
  syncRun GscSyncRun? @relation(fields: [syncRunId], references: [id], onDelete: SetNull)
  @@unique([siteId, searchType, date, country])
  @@index([siteId, date])
}
```

Add run and lease models with relation arrays for all six metric tables:

```prisma
model GscSyncRun {
  id             String        @id @default(cuid())
  siteId         String
  trigger        GscSyncTrigger
  status         GscSyncStatus @default(RUNNING)
  searchType     String        @default("web")
  requestedStart DateTime      @db.Date
  requestedEnd   DateTime      @db.Date
  effectiveStart DateTime?     @db.Date
  effectiveEnd   DateTime?     @db.Date
  dataState      String        @default("final")
  reportCounts   Json?
  reportStates   Json?
  reconciliation Json?
  errorCode      String?
  errorMessage   String?
  startedAt      DateTime      @default(now())
  finishedAt     DateTime?
  createdAt      DateTime      @default(now())
  site           Site               @relation(fields: [siteId], references: [id], onDelete: Cascade)
  dailyTotals    GscDailyTotal[]
  queryRows      GscQueryDaily[]
  pageRows       GscPageDaily[]
  queryPageRows  GscQueryPageDaily[]
  deviceRows     GscDeviceDaily[]
  countryRows    GscCountryDaily[]
  @@index([siteId, startedAt])
}

model GscSyncLease {
  siteId    String   @id
  ownerId   String
  expiresAt DateTime
  updatedAt DateTime @updatedAt
  site      Site     @relation(fields: [siteId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 4: Create the additive SQL migration**

Create `prisma/migrations/20260915090000_add_gsc_read_model_v2/migration.sql` with `ALTER TABLE "Site"` additions using non-destructive defaults, `CREATE TYPE` statements for the two enums, `CREATE TABLE` statements matching the schema, all listed unique/index definitions, and foreign keys using `ON DELETE CASCADE` for `siteId` and `ON DELETE SET NULL` for `syncRunId`.

Run: `npx prisma migrate diff --from-schema-datasource=prisma/schema.prisma --to-schema-datamodel=prisma/schema.prisma --script`

Expected: output represents only the new site columns, enums, tables, indexes, and foreign keys. Compare it line-for-line with the committed migration; do not include drops of `Keyword`, `Page`, or `RankSnapshot`.

- [ ] **Step 5: Validate schema and regenerate Prisma Client**

Run: `npx prisma validate`

Expected: `The schema at prisma/schema.prisma is valid`.

Run: `npx prisma generate`

Expected: Prisma Client generates successfully.

- [ ] **Step 6: Run the schema test and build typecheck**

Run: `npx tsx --test tests/gsc-schema.test.ts`

Expected: PASS.

Run: `npx tsc --noEmit`

Expected: PASS with the existing code and additive client fields.

- [ ] **Step 7: Commit the additive data model**

```bash
git add prisma/schema.prisma prisma/migrations/20260915090000_add_gsc_read_model_v2/migration.sql tests/gsc-schema.test.ts
git commit -m "feat: add aggregation-specific GSC storage"
```

---

### Task 3: Typed Search Console Adapter and Pagination

**Files:**
- Modify: `lib/google/gsc-client.ts:1-203`
- Modify: `lib/google/index.ts:1-4`
- Create: `tests/gsc-client.test.ts`

**Interfaces:**
- Consumes: `GscReportKind`, `GscMetricRow`, `GscReportResult`, `GscSearchType`, and `GscDateRange` from Task 1.
- Produces: `querySearchAnalyticsPage()`, `paginateGscReport()`, `fetchGscReport()`, and `probeFinalizedCoverage()`.

- [ ] **Step 1: Write failing pagination and request-shape tests**

Use a fake page requester so tests never contact Google:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { dimensionsForReport, paginateGscReport } from "../lib/google/gsc-client";

test("maps each report to an independent dimension set", () => {
  assert.deepEqual(dimensionsForReport("dailyTotal"), ["date"]);
  assert.deepEqual(dimensionsForReport("query"), ["date", "query"]);
  assert.deepEqual(dimensionsForReport("page"), ["date", "page"]);
  assert.deepEqual(dimensionsForReport("queryPage"), ["date", "query", "page"]);
  assert.deepEqual(dimensionsForReport("device"), ["date", "device"]);
  assert.deepEqual(dimensionsForReport("country"), ["date", "country"]);
});

test("paginates until a short page and preserves unrounded provider metrics", async () => {
  const starts: number[] = [];
  const result = await paginateGscReport(
    { kind: "query", rowLimit: 2, maxRows: 10 },
    async (startRow) => {
      starts.push(startRow);
      return startRow === 0
        ? { rows: [
            { keys: ["2026-09-10", "strum"], clicks: 3, impressions: 7, ctr: 3 / 7, position: 1.23456 },
            { keys: ["2026-09-10", "strum ua"], clicks: 1, impressions: 9, ctr: 1 / 9, position: 5.67891 },
          ] }
        : { rows: [
            { keys: ["2026-09-11", "strum"], clicks: 4, impressions: 8, ctr: 0.5, position: 1.11111 },
          ] };
    }
  );
  assert.deepEqual(starts, [0, 2]);
  assert.equal(result.rows[0].position, 1.23456);
  assert.equal(result.complete, true);
  assert.equal(result.truncatedAt, null);
});

test("marks the report truncated at the application safety cap", async () => {
  const result = await paginateGscReport(
    { kind: "dailyTotal", rowLimit: 2, maxRows: 2 },
    async () => ({ rows: [
      { keys: ["2026-09-10"], clicks: 1, impressions: 2, ctr: 0.5, position: 3 },
      { keys: ["2026-09-11"], clicks: 2, impressions: 4, ctr: 0.5, position: 4 },
    ] })
  );
  assert.equal(result.complete, false);
  assert.equal(result.truncatedAt, 2);
});
```

- [ ] **Step 2: Run the client test and verify missing exports fail**

Run: `npx tsx --test tests/gsc-client.test.ts`

Expected: FAIL because `dimensionsForReport` and `paginateGscReport` are not exported.

- [ ] **Step 3: Replace positional keyword parsing with report-aware normalization**

Implement an exhaustive dimension map and parse keys by the requested dimension names:

```ts
const REPORT_DIMENSIONS = {
  dailyTotal: ["date"],
  query: ["date", "query"],
  page: ["date", "page"],
  queryPage: ["date", "query", "page"],
  device: ["date", "device"],
  country: ["date", "country"],
} as const satisfies Record<GscReportKind, readonly string[]>;

export function dimensionsForReport(kind: GscReportKind): string[] {
  return [...REPORT_DIMENSIONS[kind]];
}

function normalizeRow(kind: GscReportKind, row: SearchAnalyticsRow): GscMetricRow {
  const keyed = Object.fromEntries(
    dimensionsForReport(kind).map((dimension, index) => [dimension, row.keys[index]])
  );
  if (!keyed.date) throw new Error(`GSC ${kind} row did not contain a date`);
  return {
    date: keyed.date,
    query: keyed.query,
    url: keyed.page,
    device: keyed.device,
    country: keyed.country,
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    position: row.position,
  };
}
```

- [ ] **Step 4: Implement generic pagination**

`paginateGscReport()` accepts `{ kind, rowLimit, maxRows }` plus a requester `(startRow) => Promise<SearchAnalyticsResponse>`. It appends normalized rows, increments by the actual `rowLimit`, returns complete on an empty or short page, and returns `complete: false` before requesting beyond `maxRows`.

Use defaults `rowLimit = 25_000` and `maxRows = 250_000`. Do not round CTR or position in the adapter.

- [ ] **Step 5: Implement authenticated request and coverage probe**

`querySearchAnalyticsPage()` accepts the access token explicitly, performs the POST, includes `type`, `dataState`, `rowLimit`, and `startRow`, and throws a `GscApiError` containing sanitized `status` and `code`. `fetchGscReport()` obtains the token through `getAccessToken(userId)` and delegates to pagination.

`probeFinalizedCoverage()` requests `[date]` with `dataState: "all"` over the last 14 Pacific dates. Choose the day before response metadata's first incomplete date when present; otherwise choose the greatest returned date. If the property has no rows and no metadata, use Pacific today minus three dates and return `source: "conservative-fallback"` so health reporting does not claim that Google confirmed the date.

Use this response type:

```ts
type SearchAnalyticsResponse = {
  rows?: SearchAnalyticsRow[];
  responseAggregationType?: string;
  metadata?: {
    first_incomplete_date?: string;
    first_incomplete_hour?: string;
  };
};
```

- [ ] **Step 6: Preserve temporary compatibility exports and update the barrel export**

Keep `KeywordData`, `fetchSearchAnalytics()`, and `fetchPageAnalytics()` unchanged temporarily so this commit remains buildable. Mark them `@deprecated` and do not call them from new code. Export `GscApiError`, `fetchGscReport`, and `probeFinalizedCoverage` through `lib/google/index.ts`. Task 5 removes the compatibility exports after every caller moves to the shared synchronization service.

- [ ] **Step 7: Run client tests**

Run: `npx tsx --test tests/gsc-client.test.ts`

Expected: all dimension, pagination, normalization, cap, and provider-error tests PASS.

- [ ] **Step 8: Commit the provider adapter**

```bash
git add lib/google/gsc-client.ts lib/google/index.ts tests/gsc-client.test.ts
git commit -m "fix: fetch GSC aggregations independently"
```

---

### Task 4: Reconciliation, Store, and Synchronization Service

**Files:**
- Create: `lib/gsc/reconciliation.ts`
- Create: `lib/gsc/store.ts`
- Create: `lib/gsc/sync-service.ts`
- Create: `tests/gsc-reconciliation.test.ts`
- Create: `tests/gsc-sync-service.test.ts`

**Interfaces:**
- Consumes: `fetchGscReport()`, `probeFinalizedCoverage()`, Task 1 types/date helpers, and Task 2 Prisma delegates.
- Produces: `GscStore`, `prismaGscStore`, `GscSyncError`, `reconcileGscReports()`, `createGscSyncService().syncTarget()`, `syncGscSite()`, and `GscSyncResult`.

- [ ] **Step 1: Write failing aggregation-aware reconciliation tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { reconcileGscReports } from "../lib/gsc/reconciliation";

test("labels missing query traffic as privacy coverage, not corruption", () => {
  const result = reconcileGscReports({
    totals: { clicks: 100, impressions: 1000 },
    query: { clicks: 80, impressions: 700, complete: true },
    page: { clicks: 100, impressions: 1200, complete: true },
    device: { clicks: 100, impressions: 1000, complete: true },
    country: { clicks: 99, impressions: 995, complete: true },
  });
  assert.equal(result.queryCoverage.clicks, 0.8);
  assert.equal(result.queryCoverage.expectedPrivacyGap, true);
  assert.equal(result.warnings.some((warning) => warning.code === "QUERY_PRIVACY_GAP"), false);
});

test("warns when a property-additive device breakdown materially differs", () => {
  const result = reconcileGscReports({
    totals: { clicks: 100, impressions: 1000 },
    query: { clicks: 80, impressions: 700, complete: true },
    page: { clicks: 100, impressions: 1200, complete: true },
    device: { clicks: 60, impressions: 600, complete: true },
    country: { clicks: 100, impressions: 1000, complete: true },
  });
  assert.equal(result.warnings[0].code, "DEVICE_TOTAL_MISMATCH");
});
```

- [ ] **Step 2: Implement reconciliation with explicit tolerances**

Use a relative difference helper with a 1% tolerance for device/country clicks and impressions. Store query click/impression coverage ratios. Record page coverage without warning on impression differences because page aggregation is not property-additive. Emit truncation warnings separately based on report state.

- [ ] **Step 3: Run reconciliation tests**

Run: `npx tsx --test tests/gsc-reconciliation.test.ts`

Expected: PASS.

- [ ] **Step 4: Define the injectable store boundary and sync result**

In `lib/gsc/store.ts`, define:

```ts
export type GscSyncTarget = {
  siteId: string;
  userId: string;
  property: string;
  searchType: "web";
  dataVersion: number;
};

export interface GscStore {
  resolveOwnedTarget(userId: string, siteId: string): Promise<GscSyncTarget>;
  listScheduledTargets(): Promise<GscSyncTarget[]>;
  acquireLease(siteId: string, ownerId: string, expiresAt: Date): Promise<boolean>;
  releaseLease(siteId: string, ownerId: string): Promise<void>;
  createRun(input: CreateGscRunInput): Promise<string>;
  replaceReport(input: ReplaceGscReportInput): Promise<number>;
  finishRun(input: FinishGscRunInput): Promise<void>;
  markSiteReady(siteId: string, syncedAt: Date): Promise<void>;
}
```

Define `CreateGscRunInput`, `ReplaceGscReportInput`, and `FinishGscRunInput` in the same file using `GscDateRange`, `GscReportKind`, `GscMetricRow`, Prisma enum string literals, report-count records, report-state records, and reconciliation JSON.

- [ ] **Step 5: Write failing sync-service tests with a fake store**

Cover these exact cases:

- A second lease attempt returns `{ status: "already-running" }` and makes no Google calls.
- First sync requests 90 finalized dates and all six report kinds.
- A ready site's scheduled/manual sync requests a seven-date overlap.
- Every stored row receives the target's `siteId`, never a caller-supplied row site.
- Repeating the same complete report calls `replaceReport` with the same unique row identities.
- A truncated report produces `completed-with-warnings`, is not used to mark the site V2-ready, and preserves the last good scope.
- A thrown provider error finishes the run as failed, releases the lease, and returns a sanitized error.
- A successful first sync marks only that target site as V2-ready.

Use dependency injection:

```ts
const service = createGscSyncService({
  store: fakeStore,
  fetchReport: fakeFetchReport,
  probeCoverage: fakeProbeCoverage,
  now: () => new Date("2026-09-15T12:00:00.000Z"),
  randomId: () => "lease-owner-1",
});
```

- [ ] **Step 6: Implement the Prisma store**

`resolveOwnedTarget()` selects the site by ID and rejects missing ownership or missing `gscProperty` with typed errors. Restrict `gscSearchType` to `web` until another type is designed.

Acquire a lease atomically inside `db.$transaction()`: delete only an expired lease for the site, then create the unique site lease. Return `false` on Prisma unique constraint code `P2002`. Release only where both `siteId` and `ownerId` match.

`replaceReport()` must run in one transaction. For a complete report, delete rows inside exactly `[siteId, searchType, startDate, endDate]` for that report table, then `createMany()` normalized rows with `syncRunId`. For an incomplete report, do not delete or write canonical metric rows; preserve prior data and record the partial count on `GscSyncRun`.

`markSiteReady()` updates only the selected site with `{ gscDataVersion: 2, lastGscSyncAt: syncedAt }`.

- [ ] **Step 7: Implement the single synchronization service**

Expose:

```ts
export type GscSyncMode = "auto" | "backfill";

export type GscSyncErrorCode =
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "NO_PROPERTY"
  | "REAUTH_REQUIRED"
  | "PROVIDER_ERROR";

export class GscSyncError extends Error {
  constructor(public readonly code: GscSyncErrorCode, message: string) {
    super(message);
    this.name = "GscSyncError";
  }
}

export type GscSyncResult = {
  status: "completed" | "completed-with-warnings" | "failed" | "already-running";
  runId: string | null;
  startDate: string | null;
  endDate: string | null;
  reportCounts: Record<GscReportKind, number>;
  warnings: { code: string; message: string }[];
  error?: { code: string; message: string };
};

export function createGscSyncService(deps: GscSyncDependencies): {
  syncTarget(target: GscSyncTarget, trigger: GscSyncTrigger, mode?: GscSyncMode): Promise<GscSyncResult>;
};

export async function syncGscSite(
  userId: string,
  siteId: string,
  trigger: GscSyncTrigger,
  mode: GscSyncMode = "auto"
): Promise<GscSyncResult>;
```

The service acquires the lease, creates a run with a conservative Pacific-time requested range, probes finalized coverage, selects 90 dates for `backfill` or a V1 target, selects seven dates for a ready V2 target in `auto`, fetches the six kinds with bounded concurrency of two, stores only complete reports, reconciles results, finishes the run with the effective range, and releases its lease in `finally`. A coverage-probe failure therefore still leaves a failed run record.

Mark a site ready only when all six report requests are complete. A valid no-data response is complete and may mark the site ready. Query privacy coverage alone does not downgrade the run.

- [ ] **Step 8: Run sync and reconciliation tests**

Run: `npx tsx --test tests/gsc-reconciliation.test.ts tests/gsc-sync-service.test.ts`

Expected: all reconciliation, lease, backfill, overlap, partial-failure, and site-isolation tests PASS.

- [ ] **Step 9: Commit the synchronization core**

```bash
git add lib/gsc/reconciliation.ts lib/gsc/store.ts lib/gsc/sync-service.ts tests/gsc-reconciliation.test.ts tests/gsc-sync-service.test.ts
git commit -m "feat: add reliable GSC synchronization service"
```

---

### Task 5: Manual, Initial, and Scheduled Entry Points

**Files:**
- Modify: `lib/workers/gsc-sync.ts:1-201`
- Modify: `app/api/gsc/sync/route.ts:1-137`
- Modify: `app/api/sites/route.ts:46-125`
- Create: `lib/gsc/cron-auth.ts`
- Create: `lib/gsc/manual-sync-handler.ts`
- Create: `app/api/cron/gsc-sync/route.ts`
- Create: `tests/gsc-cron-auth.test.ts`
- Create: `tests/gsc-route-policy.test.ts`
- Modify: `.env.example:30-36`
- Modify: `vercel.json:1-18`

**Interfaces:**
- Consumes: `syncGscSite()`, `prismaGscStore.listScheduledTargets()`, and `createGscSyncService()` from Task 4.
- Produces: unchanged `syncGSCDataForSite()` compatibility wrapper, manual response contract `GscSyncResult`, and protected cron POST endpoint.

- [ ] **Step 1: Write failing cron authorization tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { isAuthorizedCronRequest } from "../lib/gsc/cron-auth";

test("accepts exactly the configured bearer token", () => {
  assert.equal(isAuthorizedCronRequest("Bearer sync-secret", "sync-secret"), true);
  assert.equal(isAuthorizedCronRequest("Bearer wrong", "sync-secret"), false);
  assert.equal(isAuthorizedCronRequest(null, "sync-secret"), false);
});

test("rejects an unset or empty configured secret", () => {
  assert.equal(isAuthorizedCronRequest("Bearer sync-secret", undefined), false);
  assert.equal(isAuthorizedCronRequest("Bearer ", ""), false);
});
```

- [ ] **Step 2: Implement timing-safe cron authorization**

Use `timingSafeEqual` only after confirming both non-empty buffers have equal length:

```ts
import { timingSafeEqual } from "node:crypto";

export function isAuthorizedCronRequest(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
```

- [ ] **Step 3: Replace the worker implementation with a compatibility wrapper**

Keep the existing exported name so site creation and any external imports do not break:

```ts
import { syncGscSite, type GscSyncMode } from "@/lib/gsc/sync-service";

export function syncGSCDataForSite(
  userId: string,
  siteId: string,
  mode: GscSyncMode = "auto"
) {
  return syncGscSite(userId, siteId, mode === "backfill" ? "INITIAL" : "SCHEDULED", mode);
}
```

Retain `syncAllUserSites()` only if a current caller needs it; implement it by resolving that user's sites and invoking the same service, with no direct Google or Prisma row writes.

- [ ] **Step 4: Write and pass manual-route policy tests**

Extract `handleManualGscSync()` into `lib/gsc/manual-sync-handler.ts` with injected `sync` dependency. Test these exact mappings without a database or Google request:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { emptyGscReportCounts } from "../lib/gsc/types";
import { GscSyncError } from "../lib/gsc/sync-service";
import { handleManualGscSync } from "../lib/gsc/manual-sync-handler";

test("rejects a missing session before synchronization", async () => {
  const response = await handleManualGscSync({
    userId: null,
    body: { siteId: "site-1" },
    sync: async () => { throw new Error("sync must not run"); },
  });
  assert.equal(response.status, 401);
});

test("maps an ownership miss to 404", async () => {
  const response = await handleManualGscSync({
    userId: "user-1",
    body: { siteId: "site-2" },
    sync: async () => { throw new GscSyncError("NOT_FOUND", "Site not found"); },
  });
  assert.equal(response.status, 404);
});

test("maps an active lease to 409", async () => {
  const response = await handleManualGscSync({
    userId: "user-1",
    body: { siteId: "site-1" },
    sync: async () => ({
      status: "already-running",
      runId: null,
      startDate: null,
      endDate: null,
      reportCounts: emptyGscReportCounts(),
      warnings: [],
    }),
  });
  assert.equal(response.status, 409);
});
```

Also test invalid `body.siteId`, reconnect-required, completed, completed-with-warnings, and provider-failed responses.

- [ ] **Step 5: Simplify the manual route**

Validate the JSON body has a string `siteId`, resolve ownership through `syncGscSite(session.user.id, siteId, "MANUAL", "auto")`, and map typed failures:

- 401 for no session or `REAUTH_REQUIRED`.
- 404 for missing/not-owned site.
- 400 for no connected property.
- 409 for `already-running`.
- 200 for completed or completed-with-warnings.
- 502 for sanitized Google/provider failure.

Delete every direct `db.keyword.upsert`, `db.page.upsert`, and provider fetch from the route.

After the worker and route imports are migrated, delete the deprecated `KeywordData`, `fetchSearchAnalytics()`, and `fetchPageAnalytics()` compatibility exports from `lib/google/gsc-client.ts`.

- [ ] **Step 6: Use the same service for initial site synchronization**

After creating the site and default alerts, call:

```ts
void syncGscSite(session.user.id, site.id, "INITIAL", "backfill").catch((error) => {
  console.error(`[GSC Sync] Initial sync failed for site ${site.id}`, error);
});
```

The daily cron remains the recovery path if the hosting runtime ends this background work early.

- [ ] **Step 7: Add the protected cron route**

The route validates `Authorization: Bearer <CRON_SECRET>`, loads scheduled targets server-side, processes them sequentially so sites do not compete for Google quota, and returns counts by status. It must not accept a user-supplied site ID.

Use the production sync service with trigger `SCHEDULED` and mode `auto`. Catch per-site errors, append the site ID and sanitized error code to the result, and continue with the next site.

- [ ] **Step 8: Document runtime configuration**

Add to `.env.example`:

```dotenv
# Required for POST /api/cron/gsc-sync
# Generate with: openssl rand -hex 32
# CRON_SECRET=

# Emergency rollback: set false to read legacy Keyword/Page data
# GSC_READ_MODEL_V2=true
```

Add `app/api/cron/gsc-sync/route.ts` to `vercel.json` with `maxDuration: 60`. Do not add a Vercel schedule because this deployment is self-hosted and Coolify remains the scheduler.

- [ ] **Step 9: Run route, cron, type, and full tests**

Run: `npx tsx --test tests/gsc-cron-auth.test.ts tests/gsc-route-policy.test.ts`

Expected: PASS.

Run: `npx tsc --noEmit`

Expected: PASS; no imports of removed `fetchSearchAnalytics` or `fetchPageAnalytics` remain.

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 10: Commit all entry points**

```bash
git add lib/workers/gsc-sync.ts app/api/gsc/sync/route.ts app/api/sites/route.ts lib/gsc/cron-auth.ts lib/gsc/manual-sync-handler.ts app/api/cron/gsc-sync/route.ts tests/gsc-cron-auth.test.ts tests/gsc-route-policy.test.ts .env.example vercel.json
git commit -m "feat: unify GSC sync entry points"
```

---

### Task 6: V2 Read Model and Compatibility Facade

**Files:**
- Create: `lib/gsc/read-model.ts`
- Create: `tests/gsc-read-model.test.ts`
- Modify: `lib/seo-metrics.ts:1-317`
- Modify: `components/dashboard/metrics.tsx:1-88`
- Modify: `app/(dashboard)/dashboard/page.tsx:122-159`
- Modify: `lib/alerts/evaluate.ts:30-58`
- Modify: `mcp/formatters.ts:1-70`
- Modify: `components/research/domain-overview-client.tsx:1-40`

**Interfaces:**
- Consumes: Task 1 aggregation/date functions and Task 2 Prisma delegates.
- Produces: `shouldUseGscV2()`, `hasGscData()`, `getStoredGscRange()`, `getGscPeriodMetrics()`, `getGscTopQueries()`, `getGscTopPages()`, `getGscDailyTraffic()`, `getGscQueryHistory()`, `getGscLatestQueryMetric()`, `getGscSavedQueryMetrics()`, `getGscPageMetricsForRange()`, `getGscQueryPageRows()`, and `getGscStoredCounts()`.
- Preserves: public `getSitePeriodMetrics()`, `getTopKeywords()`, `getTopPages()`, and `getDailyTraffic()` names.

- [ ] **Step 1: Write failing read-policy and stored-range tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { shouldUseGscV2, storedRangeEnding } from "../lib/gsc/read-model";

test("uses V2 only for migrated sites unless globally disabled", () => {
  assert.equal(shouldUseGscV2(2, undefined), true);
  assert.equal(shouldUseGscV2(2, "true"), true);
  assert.equal(shouldUseGscV2(2, "false"), false);
  assert.equal(shouldUseGscV2(1, "true"), false);
});

test("anchors periods to the latest stored finalized date", () => {
  assert.deepEqual(storedRangeEnding("2026-09-12", 28), {
    startDate: "2026-08-16",
    endDate: "2026-09-12",
  });
});
```

- [ ] **Step 2: Implement V2 selection and range helpers**

```ts
export function shouldUseGscV2(dataVersion: number, flag: string | undefined): boolean {
  return dataVersion === 2 && flag !== "false";
}

export function storedRangeEnding(latestDate: string, days: number): GscDateRange {
  return inclusiveRangeEnding(latestDate, days);
}
```

`getStoredGscRange()` queries the greatest `GscDailyTotal.date` for the site's selected search type. Return `null` when no complete property-total data exists. All V2 report functions accept an explicit range internally so current and previous periods remain adjacent.

- [ ] **Step 3: Implement V2 database readers**

- `getGscPeriodMetrics()` reads `GscDailyTotal` for current and previous ranges, aggregates with Task 1 functions, and counts distinct queries from `GscQueryDaily` for the current range.
- `getGscTopQueries()` reads `GscQueryDaily`, groups by query in TypeScript, sums counts, weights position by impressions, and computes CTR from totals.
- `getGscTopPages()` does the equivalent from `GscPageDaily`.
- `getGscDailyTraffic()` returns `GscDailyTotal` rows directly in date order.
- `getGscQueryHistory()` reads one query from `GscQueryDaily` by stored range.
- `getGscLatestQueryMetric()` reads the newest query row and derives its leading URL from same-date `GscQueryPageDaily` rows.
- `getGscSavedQueryMetrics()` performs one query for the requested query list and returns a `Map<string, KeywordRow>`.
- `getGscPageMetricsForRange()` aggregates `GscPageDaily` for an explicit current or comparison range.
- `getGscQueryPageRows()` reads `GscQueryPageDaily` for cannibalization.
- `getGscStoredCounts()` returns normalized query/page row counts through the selected read version.
- `hasGscData()` returns true only when the selected read version has usable property totals.

Every reader filters `siteId` and `searchType`. No reader uses query/page rows for property totals.

- [ ] **Step 4: Convert `lib/seo-metrics.ts` into the compatibility facade**

Move existing implementation bodies into private `legacyGet*` functions. For each public function, load `{ gscDataVersion, gscSearchType }`, evaluate `shouldUseGscV2()`, and call the matching V2 or legacy function.

Change `PeriodMetrics` to:

```ts
export type PeriodMetrics = {
  clicks: number;
  impressions: number;
  avgPosition: number | null;
  avgCtr: number | null;
  uniqueKeywords: number;
  startDate: string | null;
  endDate: string | null;
};
```

Change CTR/position deltas to `number | null`. Update `formatPosition()` and `formatCtr()` to accept `null` and return `"—"`. Preserve `KeywordRow`, `PageRow`, and `DailyTraffic` field names so existing tables, exports, and MCP formatters remain compatible.

- [ ] **Step 5: Add facade tests with injected row aggregation**

Test query/page aggregation as exported pure helpers from `read-model.ts`, including duplicate query dates, zero-impression rows, and strict separation of two supplied site IDs. The test fixtures must prove that a query-page row cannot affect a property-total aggregate.

- [ ] **Step 6: Update existing consumers for the nullable metric contract**

Update the dashboard metric cards, portfolio cards, alert comparisons, MCP formatters, and domain-overview client types in this task so the repository remains buildable. Render a null metric as `"—"`, omit its delta, and skip a position/CTR alert when either comparison value is null.

Use the same explicit branch everywhere:

```ts
const positionLabel = metrics.current.avgPosition === null
  ? "—"
  : metrics.current.avgPosition.toFixed(1);
```

- [ ] **Step 7: Run read-model and TypeScript tests**

Run: `npx tsx --test tests/gsc-read-model.test.ts tests/gsc-aggregate.test.ts`

Expected: PASS.

Run: `npx tsc --noEmit`

Expected: PASS with every existing consumer handling the nullable contract.

- [ ] **Step 8: Commit the read model**

```bash
git add lib/gsc/read-model.ts lib/seo-metrics.ts tests/gsc-read-model.test.ts components/dashboard/metrics.tsx 'app/(dashboard)/dashboard/page.tsx' lib/alerts/evaluate.ts mcp/formatters.ts components/research/domain-overview-client.tsx
git commit -m "feat: read metrics from corrected GSC aggregates"
```

---

### Task 7: Cut Over Every GSC Consumer

**Files:**
- Modify: `lib/seo-opportunities.ts:1-268`
- Modify: `lib/alerts/evaluate.ts:1-118`
- Modify: `app/api/sites/[siteId]/rank-history/route.ts:1-120`
- Modify: `app/api/sites/[siteId]/saved-keywords/route.ts:1-162`
- Modify: `app/api/sites/[siteId]/domain-overview/route.ts:1-72`
- Modify: `app/api/sites/[siteId]/route.ts:1-60`
- Modify: `app/api/sites/route.ts:7-44`
- Modify: `app/(dashboard)/sites/[siteId]/saved-keywords/page.tsx:1-139`
- Modify: `app/(dashboard)/dashboard/page.tsx:1-165`
- Modify: `app/(dashboard)/sites/page.tsx:1-109`
- Modify: `app/(dashboard)/sites/[siteId]/page.tsx:1-151`
- Modify: `app/(dashboard)/sites/[siteId]/opportunities/page.tsx:1-260`
- Modify: `app/(dashboard)/sites/[siteId]/settings/page.tsx:1-137`
- Modify: `components/dashboard/metrics.tsx:1-88`
- Modify: `mcp/server.ts:45-80`
- Modify: `scripts/seed-demo.ts:187-252`

**Interfaces:**
- Consumes: the Task 6 compatibility facade and V2 specialized readers.
- Produces: no new external API contract; removes every production direct read from legacy GSC tables outside the legacy facade.

- [ ] **Step 1: Add a regression guard for forbidden direct reads**

Create `tests/gsc-consumer-boundary.test.ts` that scans production `.ts` and `.tsx` files and permits `db.keyword`/`db.page` only in `lib/seo-metrics.ts` legacy functions and `scripts/seed-demo.ts`. The test should fail initially on the known direct consumers.

```ts
const allowed = new Set([
  "lib/seo-metrics.ts",
  "scripts/seed-demo.ts",
]);
```

- [ ] **Step 2: Refactor opportunity detectors**

Use `getGscPageMetricsForRange()` for both current and previous decay periods. Use `getGscQueryPageRows()` for cannibalization when V2 is active and the legacy query-page field only through the facade when V1 is active.

Skip low-CTR and position-based findings when position or CTR is unavailable. Do not coerce unavailable values to zero.

- [ ] **Step 3: Refactor saved-keyword and history consumers**

- Saved-keyword page calls `getGscSavedQueryMetrics(siteId, queries, 28)` once instead of `db.keyword.groupBy()`.
- Saved-keyword API calls `getGscLatestQueryMetric(siteId, query)` instead of `db.keyword.findFirst()`.
- Rank-history route calls `getGscQueryHistory(siteId, query, days)` and overlays `RankSnapshot` exactly as it does now.

Keep response field names unchanged.

- [ ] **Step 4: Refactor overview, onboarding, and stored-count consumers**

Replace legacy `_count.keywords` as a readiness test with `hasGscData(siteId)`. For displayed stored counts, use `getGscStoredCounts(siteId)`, which selects V2 counts when the site is ready and legacy counts only when the emergency flag selects V1.

The DataForSEO domain overview fallback uses `metrics.current.uniqueKeywords`; remove its direct `db.keyword.groupBy()`.

The MCP `list_sites` tool keeps its rendered labels but obtains counts through a small `getGscStoredCounts(siteId)` facade so tools and UI agree.

- [ ] **Step 5: Preserve nullable handling while migrating remaining consumers**

Use:

```tsx
value={current.avgPosition === null ? "—" : current.avgPosition.toFixed(1)}
```

and:

```tsx
value={formatCtr(current.avgCtr)}
```

Task 6 establishes the nullable contract. Preserve it while changing direct reads in this task: `MetricCard` accepts `delta: number | null`, MCP formatting omits unavailable deltas, and traffic or position alerts do not fire when the current or comparison metric is unavailable.

- [ ] **Step 6: Seed coherent V2 demo data**

Set the demo site's `gscDataVersion` to `2`, `gscSearchType` to `web`, and `lastGscSyncAt` to the seed time. For each demo date, create one `GscDailyTotal` from the date's property totals, query rows in `GscQueryDaily`, page rows in `GscPageDaily`, and coherent query-page mappings in `GscQueryPageDaily`. Derive device and country totals by partitioning each property daily total without duplicating clicks or impressions.

Keep legacy seed rows so the emergency rollback path remains demonstrable.

- [ ] **Step 7: Run the consumer boundary test and compiler**

Run: `npx tsx --test tests/gsc-consumer-boundary.test.ts`

Expected: PASS with no unexpected direct legacy GSC reads.

Run: `npx tsc --noEmit`

Expected: PASS with all nullable metric consumers handled.

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 8: Commit the consumer cutover**

```bash
git add lib/seo-opportunities.ts lib/alerts/evaluate.ts 'app/api/sites/[siteId]/rank-history/route.ts' 'app/api/sites/[siteId]/saved-keywords/route.ts' 'app/api/sites/[siteId]/domain-overview/route.ts' 'app/api/sites/[siteId]/route.ts' app/api/sites/route.ts 'app/(dashboard)/sites/[siteId]/saved-keywords/page.tsx' 'app/(dashboard)/dashboard/page.tsx' 'app/(dashboard)/sites/page.tsx' 'app/(dashboard)/sites/[siteId]/page.tsx' 'app/(dashboard)/sites/[siteId]/opportunities/page.tsx' 'app/(dashboard)/sites/[siteId]/settings/page.tsx' components/dashboard/metrics.tsx mcp/server.ts scripts/seed-demo.ts tests/gsc-consumer-boundary.test.ts
git commit -m "fix: cut GSC consumers over to corrected data"
```

---

### Task 8: Actual Data Health and Sync Feedback

**Files:**
- Create: `lib/gsc/health.ts`
- Create: `components/sites/gsc-data-health.tsx`
- Create: `tests/gsc-health.test.ts`
- Modify: `components/sites/sync-button.tsx:10-106`
- Modify: `components/ui/data-lag-badge.tsx:1-20`
- Modify: `app/(dashboard)/sites/[siteId]/page.tsx:58-148`
- Modify: `app/(dashboard)/sites/[siteId]/opportunities/page.tsx:16-59`
- Modify: `components/dashboard/metrics.tsx:53-86`
- Modify: `components/dashboard/traffic-chart.tsx:14-188`
- Modify: `app/api/sites/[siteId]/traffic/route.ts:1-36`
- Modify: `app/(dashboard)/dashboard/page.tsx:77-160`

**Interfaces:**
- Consumes: `GscSyncRun`, stored coverage, reconciliation JSON, and Task 6 metrics.
- Produces: `GscDataHealth`, `getGscDataHealth()`, and a visible, honest data-health panel.

- [ ] **Step 1: Write failing health-state projection tests**

Cover these states with fixed dates:

- `unavailable`: no property or no successful run.
- `syncing`: latest run is RUNNING and lease is current.
- `fresh`: complete run, latest finalized date within four Pacific dates.
- `stale`: complete data older than four Pacific dates.
- `partial`: completed-with-warnings or a report marked incomplete.
- `failed`: latest run failed but earlier coverage remains visible.
- `reauth-required`: latest sanitized error code is `REAUTH_REQUIRED`.

The returned shape is:

```ts
export type GscDataHealth = {
  state: "unavailable" | "syncing" | "fresh" | "stale" | "partial" | "failed" | "reauth-required";
  property: string | null;
  searchType: string;
  startDate: string | null;
  endDate: string | null;
  lastSuccessfulSync: string | null;
  queryClickCoverage: number | null;
  warnings: { code: string; message: string }[];
};
```

- [ ] **Step 2: Implement the health projection**

Keep `projectGscDataHealth()` pure for tests. `getGscDataHealth(siteId)` loads only the selected site's property, search type, last successful run, latest run, and min/max property-total dates, then calls the projector.

- [ ] **Step 3: Build the server-rendered health component**

Display property, exact covered dates, last successful sync, state, query coverage, and the first actionable warning. Use restrained status colors already present in the design tokens. Do not show an approximate today-minus-three badge as though it were observed data.

Keep `DataLagBadge` as a compatibility wrapper accepting a `GscDataHealth` prop, or replace its call sites and remove it if no other page uses it.

Remove the single approximate lag badge from the portfolio header. Each site card shows its own actual covered-through date because sites can have different synchronization health.

- [ ] **Step 4: Return coverage with traffic data**

Change the traffic endpoint response to:

```ts
type TrafficResponse = {
  coverage: { startDate: string | null; endDate: string | null };
  rows: DailyTraffic[];
};
```

Update `TrafficChart` to read `rows` and render the exact range in its subtitle. Align the site overview chart default to 28 days so it matches the headline cards; retain the endpoint's 7–180 validation.

- [ ] **Step 5: Update manual sync feedback**

`SyncButton` renders report counts from `GscSyncResult` and distinguishes:

- completed: `Synced through YYYY-MM-DD`;
- completed-with-warnings: `Synced with data warnings`;
- already-running: `A sync is already running`;
- failed: sanitized error message;
- reauth-required: existing reconnect control.

Refresh the route after completed or completed-with-warnings so health and metrics update together.

- [ ] **Step 6: Run health, component type, and full tests**

Run: `npx tsx --test tests/gsc-health.test.ts`

Expected: all seven state tests PASS.

Run: `npx tsc --noEmit`

Expected: PASS.

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 7: Commit the data-health experience**

```bash
git add lib/gsc/health.ts components/sites/gsc-data-health.tsx tests/gsc-health.test.ts components/sites/sync-button.tsx components/ui/data-lag-badge.tsx 'app/(dashboard)/sites/[siteId]/page.tsx' 'app/(dashboard)/sites/[siteId]/opportunities/page.tsx' 'app/(dashboard)/dashboard/page.tsx' components/dashboard/metrics.tsx components/dashboard/traffic-chart.tsx 'app/api/sites/[siteId]/traffic/route.ts'
git commit -m "feat: show real GSC coverage and sync health"
```

---

### Task 9: Backfill, Verification, Operations, and Release Proof

**Files:**
- Create: `scripts/backfill-gsc.ts`
- Create: `scripts/verify-gsc.ts`
- Create: `tests/gsc-verification.test.ts`
- Create: `docs/gsc-sync-operations.md`
- Modify: `package.json:24-31`

**Interfaces:**
- Consumes: `syncGscSite()`, `fetchGscReport()`, `getStoredGscRange()`, and Task 1 aggregation functions.
- Produces: `npm run gsc:backfill -- --site <siteId>`, `npm run gsc:verify -- --site <siteId> --days 28`, and the operator runbook.

- [ ] **Step 1: Write a failing verification-diff test**

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { compareVerificationMetrics } from "../scripts/verify-gsc";

test("reports exact count matches and bounded floating metric differences", () => {
  assert.deepEqual(
    compareVerificationMetrics(
      { clicks: 1570, impressions: 9860, ctr: 1570 / 9860, position: 7.5 },
      { clicks: 1570, impressions: 9860, ctr: 1570 / 9860, position: 7.5 }
    ),
    {
      matches: true,
      clicksDifference: 0,
      impressionsDifference: 0,
      ctrDifference: 0,
      positionDifference: 0,
    }
  );
});
```

- [ ] **Step 2: Implement the read-only verification command**

Export `compareVerificationMetrics()` without starting the CLI when the module is imported. The CLI requires `--site`, accepts `--days` from 1 to 180, resolves the site's owner/property/search type, anchors to stored finalized coverage, fetches a fresh `dailyTotal` report for the same dates, aggregates both datasets, and prints JSON containing property, dates, source metrics, stored metrics, differences, and `matches`.

Counts must match exactly. CTR/position differences pass when their absolute difference is at most `0.000001`; null matches only null. The command performs no database writes.

- [ ] **Step 3: Implement the explicit backfill command**

`scripts/backfill-gsc.ts` accepts either `--site <siteId>` or `--all`, but not both. It loads targets from Prisma, invokes the shared synchronization service with trigger `CLI` and mode `backfill`, prints one JSON result per site, and exits nonzero when any result is failed or already-running. It never accepts a user ID as authority; targets come from stored sites.

- [ ] **Step 4: Add package scripts**

```json
{
  "gsc:backfill": "tsx scripts/backfill-gsc.ts",
  "gsc:verify": "tsx scripts/verify-gsc.ts"
}
```

Merge these keys into the existing `scripts` object without changing the current commands.

- [ ] **Step 5: Write the self-hosted operations runbook**

`docs/gsc-sync-operations.md` must contain these exact operational sections:

1. Required environment: `DATABASE_URL`, Google OAuth credentials, `CRON_SECRET`, and `GSC_READ_MODEL_V2`.
2. Apply migration: `npx prisma migrate deploy`.
3. Backfill one site: `npm run gsc:backfill -- --site cmrvvvvjb0003oy019eff27sj`.
4. Verify one site: `npm run gsc:verify -- --site cmrvvvvjb0003oy019eff27sj --days 28`.
5. Coolify daily scheduler: POST `/api/cron/gsc-sync` with `Authorization: Bearer <CRON_SECRET>` at the chosen UTC time.
6. Readiness check: latest run complete, all report states complete, exact covered dates shown, counts reconciled.
7. Rollback: set `GSC_READ_MODEL_V2=false` and restart; do not delete V2 tables or legacy rows.
8. Recovery for reauthentication, stale lease, partial pagination, and provider quota errors.

- [ ] **Step 6: Run the verification test and static checks**

Run: `npx tsx --test tests/gsc-verification.test.ts`

Expected: PASS.

Run: `npm test`

Expected: all tests PASS.

Run: `npm run lint`

Expected: PASS with no new lint errors.

Run: `npx tsc --noEmit`

Expected: PASS.

Run: `npm run build`

Expected: production build PASS.

- [ ] **Step 7: Inspect migration and working tree before database use**

Run: `git diff --check`

Expected: no output.

Run: `git status --short`

Expected: only Task 9 files are modified; the user's existing untracked SEO reference files remain unmodified and uncommitted.

- [ ] **Step 8: Commit operations and verification tooling**

```bash
git add scripts/backfill-gsc.ts scripts/verify-gsc.ts tests/gsc-verification.test.ts docs/gsc-sync-operations.md package.json
git commit -m "docs: add GSC backfill and verification runbook"
```

- [ ] **Step 9: Perform the production reconciliation checkpoint**

After deployment and migration, run the documented Strum backfill and verification commands. In Search Console, select `sc-domain:strum.capital`, Web, and exactly the dates printed by `gsc:verify`. Confirm:

- property clicks equal stored clicks;
- property impressions equal stored impressions;
- CTR equals total clicks divided by total impressions;
- average position is within the verification tolerance;
- the high-click `strum` query appears when it exists in those dates;
- query coverage explains any anonymized-query remainder;
- device and country mismatches do not exceed the recorded tolerance;
- dashboard, traffic chart, keyword table, page table, CSV exports, alerts, opportunities, and MCP tools all read the V2 scope.

Do not delete legacy data after this checkpoint. Keep the emergency rollback switch through at least one complete daily-sync cycle.

---

## Final Acceptance Checklist

- [ ] Same property, Web search type, and finalized 28 dates produce identical headline clicks and impressions in Search Console and CrawlSEO.
- [ ] CTR is `clicks / impressions`; average position is impression-weighted and unavailable on zero impressions.
- [ ] Every GSC aggregation has its own full unique key.
- [ ] Query-page, device, and country rows cannot overwrite query totals.
- [ ] Six reports are paginated independently and incomplete reports are visibly excluded from cutover.
- [ ] Initial backfill covers 90 finalized dates; routine sync refreshes seven overlapping dates.
- [ ] Manual, initial, scheduled, and CLI paths call one synchronization service.
- [ ] A per-site lease prevents overlapping syncs and can recover after expiry.
- [ ] V2 reads are site-scoped and gated by `gscDataVersion` plus the global rollback switch.
- [ ] Dashboard, charts, tables, exports, alerts, opportunities, saved keywords, rank history, domain fallback, seed data, and MCP output use the compatibility facade.
- [ ] Data health shows property, exact coverage, last success, partial/truncated state, and query privacy coverage.
- [ ] Existing legacy rows and user-owned SEO reference documents remain untouched.
- [ ] `npm test`, `npm run lint`, `npx tsc --noEmit`, and `npm run build` pass.
