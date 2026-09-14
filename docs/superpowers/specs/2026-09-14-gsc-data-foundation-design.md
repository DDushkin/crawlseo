# GSC Data Foundation Design

**Status:** Approved in conversation on 2026-09-14

**Parent design:** `2026-09-14-solo-seo-operator-design.md`

**Delivery slice:** 1 of 7

## 1. Objective

Replace the corrupted Search Console read model with additive, aggregation-correct, site-scoped storage. Dashboard totals, charts, keyword reports, page reports, comparisons, exports, and GSC-derived opportunities must read from the new tables only after a successful backfill and reconciliation.

## 2. Diagnosed cause

`lib/google/gsc-client.ts` currently requests a single report grouped by query, page, date, device, and country. Both synchronization paths write those rows into `Keyword`, whose unique key is only `[siteId, query, date]`. Rows that differ by page, device, or country therefore overwrite one another. `lib/seo-metrics.ts` later sums the surviving rows as though they were query totals.

The current date helper also constructs an inclusive today-minus-N through today range, producing 29 calendar dates for a nominal 28-day request and mixing UTC boundaries with Search Console's Pacific Time reporting calendar.

For the observed `strum.capital` example, Search Console displayed roughly 1.57K clicks for its selected 28-day Web report while CrawlSEO showed 22 clicks. Normal anonymized-query or aggregation differences cannot explain that scale of loss.

## 3. Scope

### Included

- New aggregation-specific GSC tables and relations.
- A typed Search Console adapter capable of fetching each report independently.
- Correct finalized date-window calculation.
- Paginated imports with explicit coverage state.
- Initial 90-day backfill and recent-overlap refresh.
- One synchronization service used by initial, manual, and scheduled entry points.
- Database-backed concurrency protection.
- Reconciliation and data-health reporting.
- New read services for dashboard, chart, keyword, page, country, device, comparison, export, and existing opportunity consumers.
- Compatibility flag for safe read cutover.
- Focused tests and a manual `strum.capital` reconciliation procedure.

### Excluded

- Deleting or rewriting legacy `Keyword`, `Page`, or `RankSnapshot` data.
- DataForSEO changes beyond keeping its output out of GSC totals.
- GA4, content briefs, action persistence, or AI citation monitoring.
- Undocumented Google API calls.
- Bulk Search Console export infrastructure.

## 4. Data model

All dates represent Search Console calendar dates and should use a PostgreSQL date column through Prisma's `DateTime @db.Date` mapping.

### 4.1 `GscDailyTotal`

One property-aggregated row per site, search type, and date.

- `id`
- `siteId`
- `date`
- `searchType`
- `clicks`
- `impressions`
- `ctr`
- `position`
- `syncRunId`
- `createdAt`
- `updatedAt`
- Unique: `[siteId, searchType, date]`
- Index: `[siteId, date]`

This is the only source for headline cards and site-wide trend charts.

### 4.2 `GscQueryDaily`

One query-aggregated row per site, search type, date, and query.

- Metrics and provenance fields matching `GscDailyTotal`
- `query`
- Unique: `[siteId, searchType, date, query]`
- Indexes supporting site/date and site/query/date reads

This is the source for keyword lists, query comparisons, striking-distance detection, and low-CTR detection.

### 4.3 `GscPageDaily`

One page-aggregated row per site, search type, date, and canonical page URL returned by Google.

- Metrics and provenance fields matching `GscDailyTotal`
- `url`
- Unique: `[siteId, searchType, date, url]`
- Indexes supporting site/date and site/url/date reads

This is the source for page lists, page trends, and content-decay detection.

### 4.4 `GscQueryPageDaily`

One row per site, search type, date, query, and page pair.

- Metrics and provenance fields matching `GscDailyTotal`
- `query`
- `url`
- Unique: `[siteId, searchType, date, query, url]`
- Indexes supporting site/query/date and site/url/date reads

This is used only when a relationship between a query and a page is required, especially cannibalization and keyword-map suggestions. Its metrics are not summed into property totals.

### 4.5 `GscDeviceDaily`

One property-aggregated row per site, search type, date, and device.

- Metrics and provenance fields matching `GscDailyTotal`
- `device`
- Unique: `[siteId, searchType, date, device]`

### 4.6 `GscCountryDaily`

One property-aggregated row per site, search type, date, and country code.

- Metrics and provenance fields matching `GscDailyTotal`
- `country`
- Unique: `[siteId, searchType, date, country]`

### 4.7 `GscSyncRun`

Records one synchronization attempt for one site.

- `id`
- `siteId`
- `trigger`: initial, manual, or scheduled
- `status`: running, completed, completed-with-warnings, or failed
- `searchType`
- Requested and effective start/end dates
- `dataState`
- Start and finish timestamps
- Per-report imported row counts
- Per-report completion and truncation state
- Reconciliation summary
- Sanitized error code and message
- `createdAt`

Sensitive tokens and raw credentials are never stored in this record.

### 4.8 `GscSyncLease`

Provides one active lease per site so manual and scheduled imports cannot overlap.

- `siteId` as the primary key
- `ownerId`
- `expiresAt`
- `updatedAt`

Lease acquisition and renewal are atomic. An expired lease may be reclaimed. Every upsert remains idempotent even if a worker stops unexpectedly.

### 4.9 `Site` additions

- `gscSearchType`, defaulting to Web.
- `lastGscSyncAt` for the last successful complete or complete-with-warnings run.

Do not place reporting timezone, location/language, or paid-provider configuration into this migration. GSC dates remain explicitly governed by Search Console's Pacific Time reporting calendar; broader reporting preferences belong to a later site-settings slice.

## 5. Search Console requests

The adapter exposes independent operations with a shared typed request runner:

- Daily totals: dimensions `[date]`.
- Queries: dimensions `[date, query]`.
- Pages: dimensions `[date, page]`.
- Query-page relations: dimensions `[date, query, page]`.
- Devices: dimensions `[date, device]`.
- Countries: dimensions `[date, country]`.

Each request includes the selected search type and requests finalized data for normal reporting. The adapter accepts start date, end date, row limit, and start row explicitly.

For paginated reports, request up to the supported page size and increment `startRow` until a short or empty page is returned. Apply a documented application safety cap. Reaching that cap marks the report truncated and produces a visible warning; it is never treated as a complete import.

The adapter returns normalized rows and metadata. It does not write to Prisma.

## 6. Date semantics

The default reporting range is anchored to the latest finalized date discovered through a date-only presence request.

- A 28-day range contains exactly 28 Search Console dates.
- `endDate` is the latest finalized date.
- `startDate` is `endDate - 27 calendar days`.
- The previous comparison range is the immediately preceding 28 dates.
- Date labels are preserved as Search Console Pacific Time calendar dates.
- The database stores those labels as date-only values, not converted instants.

The UI displays the actual covered dates rather than only saying "Last 28 days."

## 7. Import transaction behavior

Each report is fetched before replacing the corresponding covered rows. A report's write transaction:

1. Validates normalized rows and date coverage.
2. Upserts by the table's full unique key.
3. Removes stale rows only inside the successfully fetched report scope where necessary.
4. Records row count and completeness on the run.

A failed report does not erase its last known good rows. If some reports succeed and another fails, the run becomes `completed-with-warnings`; successful evidence remains usable while affected surfaces show the warning.

Initial backfill covers 90 finalized days. Scheduled synchronization refreshes the latest finalized days with a configurable overlap, initially seven days, to absorb delayed corrections. Manual synchronization uses the same service and overlap rules unless an explicit backfill range is requested.

## 8. Reconciliation

Reconciliation is aggregation-aware:

- Property daily rows are the source of truth for total clicks, impressions, CTR, and position.
- Query coverage compares displayed query clicks/impressions with property totals and labels the unreported remainder as privacy/anonymization coverage, not corruption.
- Page impressions may differ from property impressions because page and property aggregation count multi-URL appearances differently.
- Device and country breakdowns should reconcile closely with property totals for the same finalized scope; material differences create warnings.
- Query-page metrics are never expected to reconcile with property impressions.

Period metrics are calculated as follows:

- Clicks: sum of daily clicks.
- Impressions: sum of daily impressions.
- CTR: total clicks divided by total impressions.
- Position: impression-weighted average of Google's daily position values.

When impressions are zero, CTR and position return a defined unavailable state rather than `NaN` or a misleading zero.

## 9. Application services and entry points

### 9.1 Service boundaries

- `lib/google/gsc-client.ts`: authenticated provider transport and normalized report fetching.
- New `lib/gsc/` modules: date ranges, import orchestration, reconciliation, read queries, and shared types.
- `lib/workers/gsc-sync.ts`: scheduled/initial worker wrapper calling the shared import service.
- `app/api/gsc/sync/route.ts`: authenticated manual wrapper calling the same service.
- New protected cron route: scheduled multi-site dispatch using the same worker service.
- `lib/seo-metrics.ts`: compatibility facade that reads the new tables when the cutover flag is enabled.
- `lib/seo-opportunities.ts`: continues to consume the metrics facade; its detector behavior is otherwise outside this slice.

No entry point independently implements GSC parsing or database upserts.

### 9.2 Ownership

Manual routes verify the session user owns `siteId`. Scheduled dispatch obtains eligible sites server-side and does not accept arbitrary user-supplied site ownership. All service calls require an already-resolved site object or ownership context rather than trusting a naked site ID at the HTTP boundary.

## 10. User interface

The current dashboard retains its general structure during this slice but switches its GSC cards, chart, query table, page table, comparisons, and exports to the corrected read model.

Add a compact data-health area showing:

- Connected GSC property and search type.
- Actual date coverage.
- Last successful synchronization.
- Current run state.
- Final, partial, stale, unavailable, or truncated status.
- Query privacy coverage where relevant.
- A retry action for an authenticated owner.

Do not add the full "Today" action interface in this slice.

## 11. Compatibility and rollout

Use an application configuration flag to control reads from the new model.

1. Apply the additive migration.
2. Deploy write and backfill support with legacy reads still active.
3. Backfill each connected site independently.
4. Reconcile a selected finalized period against Search Console.
5. Enable new reads for verified sites or environments.
6. Monitor sync failures and metric differences.
7. Keep legacy tables intact for rollback.

Rollback disables the new read path. It does not require reversing or deleting imported data.

## 12. Error handling

- OAuth expiration: refresh where supported; otherwise show reconnect-required without deleting data.
- Permission loss: preserve history and mark the property inaccessible.
- Rate limit or transient Google failure: bounded retry with jitter, then record a retryable failure.
- Invalid property: fail before writes and show the selected property.
- Empty valid result: store successful zero/empty coverage distinctly from failure.
- Partial pagination: preserve imported rows, mark truncated/partial, and exclude incomplete breakdowns from confident recommendations.
- Database failure: fail the report transaction and preserve the prior successful scope.
- Stale lease: reclaim only after expiry and record the interrupted run.

Logs include run ID, site ID, report type, and sanitized provider error code. They never include OAuth tokens or full provider credentials.

## 13. Testing

### Unit tests

- Exactly 28 finalized dates are selected.
- Month, year, daylight-saving, and leap-day boundaries preserve GSC date labels.
- CTR uses summed clicks divided by summed impressions.
- Position uses impression weighting and handles zero impressions.
- Dimension keys map into the correct normalized fields.
- Pagination terminates correctly and flags safety-cap truncation.
- Reconciliation applies the correct expectation for each aggregation.

### Database/service tests

- Distinct query-page combinations do not overwrite one another.
- Re-importing the same scope is idempotent.
- Overlap refresh updates corrected Google values.
- A failed report retains prior rows.
- Lease acquisition prevents overlapping syncs and permits expiry recovery.
- One site's import never updates another site's rows.
- Legacy and new read paths can be selected independently.

### Route tests

- Unauthorized access returns 401.
- A user cannot sync a site they do not own.
- Manual, initial, and cron entry points call the same synchronization service.
- Provider errors return actionable, sanitized states.

### Manual production proof

For `sc-domain:strum.capital`:

1. Select Web search and the same finalized 28-day dates in Search Console and CrawlSEO.
2. Verify clicks and impressions match the property-level report.
3. Verify CTR matches clicks divided by impressions.
4. Verify average position is consistent with the same aggregation.
5. Compare top queries and pages while accounting for anonymized-query and page-aggregation differences.
6. Confirm the previously missing high-click query appears when present in the selected dates.
7. Confirm country/device totals and data-health warnings are reasonable.

## 14. Acceptance criteria

- Headline clicks and impressions match Search Console for the same property, search type, and finalized dates.
- A nominal 28-day range contains exactly 28 GSC dates.
- Query, page, query-page, device, and country rows use complete unique keys and cannot overwrite sibling dimension values.
- Dashboard, chart, comparisons, exports, and existing GSC-derived opportunities read corrected aggregation-specific data after cutover.
- Imports are paginated, idempotent, overlap-safe, and site-isolated.
- Partial, truncated, stale, unavailable, and failed states are visible and distinct.
- Existing GSC rows remain available for rollback.
- No paid API is required to complete or verify this slice.
