# GSC Sync Operations

This runbook covers the self-hosted GSC V2 rollout. Backfill and verification commands select stored site records by site ID; they never accept a user ID as authority. Run production reconciliation only after the application deployment and database migration have completed.

## 1. Required environment

Set these values in the application and one-off command environment:

- `DATABASE_URL`: PostgreSQL connection string for the deployed CrawlSEO database.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: Google OAuth credentials used by the existing stored user connections.
- `CRON_SECRET`: strong secret shared with the Coolify scheduler.
- `GSC_READ_MODEL_V2`: leave enabled or unset during rollout. The explicit value `false` is the emergency rollback switch.

Do not put secrets in command output or logs. Confirm the selected site already has a valid stored Google connection and the intended Search Console property.

## 2. Apply migration

Apply committed migrations once from the release environment:

```bash
npx prisma migrate deploy
```

Do not use a development migration command in production. Confirm the migration succeeds before starting a backfill.

## 3. Backfill one site

Start the explicit 90-finalized-day backfill for one stored site:

```bash
npm run gsc:backfill -- --site cmrvvvvjb0003oy019eff27sj
```

The command prints one JSON result for the site. A failed or `already-running` result exits nonzero. Investigate that result rather than immediately starting another run. For a deliberate fleet backfill, use `--all`; it selects only stored, GSC-connected sites and prints one JSON result per site.

## 4. Verify one site

Run a fresh, read-only provider comparison for the latest 28 finalized stored dates:

```bash
npm run gsc:verify -- --site cmrvvvvjb0003oy019eff27sj --days 28
```

The JSON output identifies the current property, Web search type, exact dates, source metrics, stored metrics, differences, and match result. Clicks and impressions must match exactly. CTR and impression-weighted position may differ by at most `0.000001`; an unavailable value matches only another unavailable value. A mismatch exits nonzero. Use exactly the printed property, Web search type, and date range when comparing Search Console manually.

## 5. Coolify daily scheduler

Configure a daily Coolify scheduled request at the chosen UTC time:

- Method: `POST`
- Path: `/api/cron/gsc-sync`
- Header: `Authorization: Bearer <CRON_SECRET>`

Schedule one invocation per day. The endpoint resolves eligible stored sites server-side and synchronizes them sequentially to limit quota contention.

## 6. Readiness check

Before declaring the V2 read model ready, confirm all of the following:

- The latest synchronization run is complete (or complete with reviewed, acceptable warnings).
- Every required report state is complete: daily total, query, page, query-page, device, and country.
- The health output and verification JSON show the exact covered start and end dates.
- Property clicks and impressions reconcile exactly; CTR is total clicks divided by total impressions; average position is within `0.000001`.
- In Search Console, the same property, Web search type, and printed dates produce the same headline metrics.
- A high-click `strum` query appears when it exists in that range, and query coverage explains any anonymized-query remainder.
- Device and country reconciliation warnings are understood and within the recorded tolerance.
- Dashboard, traffic chart, keyword table, page table, CSV exports, alerts, opportunities, and MCP tools read the V2 site/property scope.

Keep the rollback switch available through at least one complete daily synchronization cycle.

## 7. Rollback

Set `GSC_READ_MODEL_V2=false` and restart the application. This globally returns eligible reads to the compatibility path while preserving the V2 data for diagnosis.

Do not delete V2 tables, V2 rows, or legacy rows during rollback. Changing or reconnecting a property can affect which legacy data is safe to expose, so verify property provenance before evaluating rollback results.

## 8. Recovery

### Reauthentication required

Ask the site owner to reconnect Google from CrawlSEO, confirm the intended property remains selected, then rerun the single-site backfill. Do not substitute a different user ID on the command line.

### Stale lease or already-running result

First check whether another synchronization is active. If none is active, allow the 30-minute lease to expire; the next run can remove the expired lease and acquire a new one. Do not delete an unexpired lease while a worker may still be writing.

### Partial pagination

Treat any incomplete report state or pagination truncation as not ready. Preserve the current canonical rows, review report counts and truncation details, then retry after correcting the limiting condition. Cutover requires all six report states to be complete.

### Provider quota errors

Stop manual retries, wait for Google quota to recover, and resume with one site first. Keep scheduled runs sequential and avoid overlapping fleet backfills. If quota pressure persists, move the daily UTC schedule away from other Google API jobs and inspect sanitized run errors before retrying.

## Production reconciliation checkpoint

After deployment and migration, execute the documented Strum backfill and verification commands from the production release environment. Complete the readiness check against `sc-domain:strum.capital` with Web search and exactly the dates printed by verification. This checkpoint is a release operation, not part of local build verification.

Do not delete legacy data after reconciliation. Retain the emergency rollback switch through at least one complete daily synchronization cycle.
