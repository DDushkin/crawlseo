# Final whole-branch fix

## Scope and result

Resolved the two Important final-review findings in the existing GSC data-foundation worktree. The deferred Minor findings (backfill error cleanup and provider retries) are unchanged.

1. Complete GSC report coverage now persists independently of traffic rows. Empty daily-total reports and zero-traffic final dates retain the metadata-finalized reporting boundary.
2. V2 opportunity detectors require complete coverage for the report and dates they consume. Keyword and page listing screens receive the actual site health through the existing DataLagBadge.

Read CLAUDE.md / AGENTS.md, the complete approved design and implementation plan, and the complete test-driven-development skill plus writing-good-tests.md before task actions. Used verification-before-completion for the final validation and commit.

## Design applied

- Added `GscReportCoverage` keyed by `(siteId, property, searchType, reportKind)`, with date-only start/end and a required originating sync-run relation.
- Amended the existing unshipped additive migration. Legacy metric models and existing property-aware history are preserved.
- Coverage updates occur after complete canonical replacement in the same transaction, protected by the existing conditional lease renewal. Empty replacements also update coverage. Incomplete replacements leave coverage and its provenance unchanged.
- Overlapping and contiguous intervals merge. A separated later interval replaces the tracked interval; a separated earlier interval preserves the newer interval and its provenance. Canonical row deletion remains limited to the existing successfully fetched site/property/type/date scope.
- Coverage queries filter site, property, search type, report kind, and the originating run's matching property.
- Daily-total coverage is authoritative for stored reporting ranges, health, and the existing verification command. A requested range is returned only when its entire requested day count fits inside the continuous coverage interval. `hasGscData` uses the existing one-day query, so an empty successful report remains synced.
- `hasCompleteGscReportCoverage` is exposed through the compatibility facade. Query opportunities require the current 28 dates; decay requires both adjacent 28-date page periods; cannibalization requires the current query-page period. Legacy rollback continues its opportunity logic without requiring V2 coverage records.
- Demo data seeds all six complete coverage records before marking the demo site ready.

## RED evidence

Before production changes, added `tests/gsc-report-coverage.test.ts`, a database-boundary fixture, the Prisma DMMF coverage contract, and seed coverage expectations.

An initial unqualified `npx tsx` invocation selected the older worktree shell runtime, which lacks the required node:test mock APIs. That infrastructure failure is not counted as RED. The valid RED command used Node 24.15.0:

```sh
PATH=/Users/adushkin/.nvm/versions/node/v24.15.0/bin:$PATH node --import tsx --test tests/gsc-report-coverage.test.ts tests/gsc-schema.test.ts tests/gsc-demo-seed.test.ts
```

Result: **18 tests, 5 pass, 13 fail, exit 1**. The final pre-implementation RED run showed these assertion failures:

- Empty complete backfill persisted **0 coverage records, expected 6**.
- Zero-traffic finalized September 13 selected **August 16–September 12**, expected **August 17–September 13**.
- Overlapping and contiguous replacements left the old endpoint/provenance instead of advancing them.
- A separated newer interval incorrectly retained the older coverage.
- An empty successful seven-day refresh reported no one-day readiness.
- Each ready-site truncated `page`, `query`, and `queryPage` refresh produced **1 affected recommendation, expected 0**, while daily totals advanced to September 13.
- Both keyword and page listing DataLagBadge props had **undefined health state, expected partial**.
- DMMF had no `GscReportCoverage` model; demo seed had no six coverage records.

Five guards already passed before production changes: existing schema retention, incomplete replacement preservation, the older-gap no-op case, cross-property no-data isolation, and legacy rollback recommendations. These are recorded as guards, not falsely claimed as new RED failures.

## GREEN and test quality

Implemented the coverage model/store/readers, report gates, seed coverage, and health props. The initial GREEN attempt had 16/18 passing: two surface tests used two runs with identical fake start times, so their database fixture selected the earlier run. Corrected that test fixture to give successive synchronization attempts distinct times. No production behavior was changed for the fixture correction. The original regression set then passed **18/18**.

Updated existing store/read/health/property tests for the new query contracts. Added four passing boundary guards after the core GREEN run: other-property history preservation, transaction rollback of rows and coverage together, lost-lease coverage preservation, and requiring page coverage for the previous period. Final focused set: **22/22**.

The tests exercise real synchronization, Prisma store logic, coverage readers, facade, health projection, detectors, verification runner, and server-page trees. Only database and provider/auth boundaries are replaced. Expectations use literal independently checked dates and counts. No source-text grep assertions were introduced.

## Final verification

The complete final verification used the project's **Node 22.16.0**:

```sh
PATH=/Users/adushkin/.nvm/versions/node/v22.16.0/bin:$PATH
```

Every command below exited 0:

- `DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:1/placeholder npx prisma validate`: schema valid.
- Same inert URL with `npx prisma generate`: Prisma Client 6.19.3 generated.
- `node --import tsx --test tests/gsc-report-coverage.test.ts tests/gsc-schema.test.ts tests/gsc-demo-seed.test.ts`: **22 passed, 0 failed, 0 skipped**; 852.58275 ms.
- `npm test`: **143 passed, 0 failed, 0 skipped**; 687.136083 ms.
- `npx tsc --noEmit --incremental false`: no errors.
- Changed-file ESLint across both listing pages, all changed TypeScript production files, and all changed/new test files including `tests/helpers/gsc-coverage-db.ts`: no errors or warnings.
- `npm run build` with inert DB/OAuth/auth placeholders: compiled, typechecked, generated all **15 static pages**, finalized successfully. Compile 2.7 seconds; TypeScript 3.7 seconds.
- `git diff --check`: clean.
- Pre-commit status: only the intended fix files, tests, and this report.

The sandbox initially denied tsx's local IPC socket; the allowed retry ran the normal `npm test` script successfully. The first sandboxed build could not download public Google Fonts; the allowed retry succeeded. The same final checks also passed under Node 24 before repeating them under Node 22. Node 22 emits its existing standard MockTimers experimental warning; the build retains the existing multiple-lockfile workspace-root warning.

Exact build environment values:

```sh
DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:1/placeholder
GOOGLE_CLIENT_ID=build-placeholder
GOOGLE_CLIENT_SECRET=build-placeholder
AUTH_SECRET=build-placeholder
NEXTAUTH_SECRET=build-placeholder
```

## Changed files

Production:

- `prisma/schema.prisma`
- `prisma/migrations/20260915090000_add_gsc_read_model_v2/migration.sql`
- `lib/gsc/store.ts`
- `lib/gsc/read-model.ts`
- `lib/gsc/health.ts`
- `lib/seo-metrics.ts`
- `lib/seo-opportunities.ts`
- `scripts/seed-demo.ts`
- `app/(dashboard)/sites/[siteId]/keywords/page.tsx`
- `app/(dashboard)/sites/[siteId]/pages/page.tsx`

Tests:

- `tests/gsc-report-coverage.test.ts`
- `tests/helpers/gsc-coverage-db.ts`
- `tests/gsc-schema.test.ts`
- `tests/gsc-demo-seed.test.ts`
- `tests/gsc-sync-service.test.ts`
- `tests/gsc-read-model.test.ts`
- `tests/gsc-health.test.ts`
- `tests/gsc-property-provenance.test.ts`
- `tests/gsc-consumer-behavior.test.ts`

## Self-review and limits

Confirmed complete-empty coverage, exact 28-date selection, scoped provenance, interval gap rules, unchanged incomplete coverage, lease fencing, transactional rollback, preservation of other properties, per-detector gates, usable legacy rollback, and actual partial-health props. Existing metric replacement scopes remain unchanged. No styles or UI structure were redesigned.

Database behavior is verified through the Prisma query/transaction boundary and generated schema contracts; no live PostgreSQL integration or Search Console reconciliation was run. The migration remains unshipped and was amended as authorized. A site with fewer than the requested continuous covered dates returns no full reporting range; the caller can still see one-day readiness and actual health coverage. Live deployment, migration, backfill, and reconciliation remain release work.

## No live actions

No real database was connected to or modified. No migration, backfill, seed, deployment, paid API, or live GSC/provider-data command was executed. Provider and seed executions inside tests used controlled fakes. Network access during the successful build was limited to its public font asset downloads. Legacy data, user files, and the deferred Minor findings were not changed.

## Refinement after scoped re-review

The scoped re-review found that striking-distance and low-CTR detectors checked coverage for one range, then called `getTopKeywords`, which resolved the daily-total range again. If another synchronization advanced daily coverage in between, the detectors could read dates beyond the validated query coverage.

Added two behavioral interleaving regressions before changing production. Each exercises real sync/store, facade, and detector code with the database boundary fixture. After the initial daily coverage read returns September 12, the fixture advances daily coverage to September 13 while query coverage remains through September 12. A query on August 16 makes the validated versus shifted period observable. The test checks the actual query bounds and recommendation, then confirms a subsequent independent range lookup returns August 17–September 13.

RED command, using Node 22.16.0:

```sh
PATH=/Users/adushkin/.nvm/versions/node/v22.16.0/bin:$PATH node --import tsx --test --test-name-pattern='consumes its validated range' tests/gsc-report-coverage.test.ts
```

Result: **2 tests, 0 pass, 2 fail, exit 1**; 225.567625 ms. Both failed with the same incorrect consumed query bounds:

```text
actual:   2026-08-17 through 2026-09-13
expected: 2026-08-16 through 2026-09-12
```

The only production change is in `lib/seo-opportunities.ts`: import the existing `getGscTopQueries` facade and use `getGscTopQueries(siteId, range, 200)` in both detectors after coverage validation. This carries the validated range directly into the read. No other production files changed.

GREEN and final verification used the same Node 22.16.0 PATH:

- `node --import tsx --test tests/gsc-report-coverage.test.ts tests/gsc-consumer-behavior.test.ts tests/gsc-read-model.test.ts`: **49 passed, 0 failed, 0 skipped**, exit 0; 443.033375 ms. Includes both interleavings, truncated-report gates, legacy rollback opportunities, and existing consumer checks.
- `npm test`: **145 passed, 0 failed, 0 skipped**, exit 0; 641.997459 ms. The normal tsx script ran with its required local IPC permission.
- `npx tsc --noEmit --incremental false`: exit 0, no errors.
- `npx eslint lib/seo-opportunities.ts tests/gsc-report-coverage.test.ts`: exit 0, no warnings or errors.
- Inert-placeholder `npm run build`, using the exact DB/OAuth/auth values above and public font asset access: exit 0; compiled in 2.7 seconds, TypeScript in 3.8 seconds, all 15 static pages generated, build finalized. Only the existing workspace-root warning remains.
- `git diff --check`: exit 0.

Self-review confirmed both detectors now consume exactly the checked interval and perform only one daily range lookup per detector invocation. The regression proves a second independent lookup sees the newer interval. This refinement changes only the detector module, its behavioral tests, and this report. The deferred Minor findings remain unchanged. No live DB, provider-data, migration, backfill, deployment, or seed action was performed. Recorded in a new follow-up commit without rewriting the earlier final-fix commit.
