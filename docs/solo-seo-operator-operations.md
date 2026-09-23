# Solo SEO Operator: rollout and weekly use

This release preserves the `Site` tenancy boundary. Every page, prompt, action, change, outcome, placement, and imported observation is scoped to one site. Deploy and validate one site first (Strum), then enable the same workflows on others.

## What the numbers mean

| Surface | Source and calculation | Important qualification |
| --- | --- | --- |
| GSC clicks/impressions | Finalized Web **property-total daily** rows summed over the displayed dates | Query/page rows never replace property totals; compare the exact property, search type, and Pacific reporting dates in GSC. |
| Action evidence | Two complete equal 28-day GSC periods for declines; complete current 28-day query report for striking-distance queries | A decline is a signal to investigate, not a diagnosis. An impression/position opportunity is not a forecast of extra clicks. |
| Measured outcome | The 28 days before and after the recorded change, excluding two days on either side, with finalized GSC coverage | Observed difference is not proof the change caused it. Missing coverage is unavailable, not zero. |
| Google AI impressions | User-confirmed chart CSV export from GSC's Generative AI (Search) report | Included in normal Web impressions; never add them to GSC totals. CSV does not cryptographically identify its property. Google export may render unavailable values as zero. |
| GA4 AI referrals | Sessions and key events from identifiable ChatGPT, Perplexity, Claude, Gemini, and Copilot referrers | Direct/stripped referrers are missed. GA4 property-timezone sessions are not GSC Pacific-time clicks. |
| ChatGPT citations | DataForSEO final-answer `sources` for a fixed panel of site-owned questions | A sample, not actual user prompts, AI search traffic, or population visibility. Sandbox observations are synthetic and excluded from the live rate. |
| Paid placements | Recorded publisher article URL, target URL, cost and fee in UAH; independent live HTML checks | Publication date is not payment date; an absent provider-indexed backlink is not proof a link is absent. No link value or traffic attribution is inferred. |

## Deploy safely in Coolify

1. Back up the production PostgreSQL database and record the currently running image/commit. Confirm the application's `DATABASE_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_URL`, `AUTH_TRUST_HOST=true`, and `CRON_SECRET` are present. Keep the existing encryption secret unchanged; changing it would make stored DataForSEO keys unreadable.
2. Deploy the release image. The Docker startup command runs `prisma migrate deploy` before serving requests. If using a different startup command, run `npx prisma migrate deploy` once in the release environment. Migrations are additive and retain existing GSC and legacy rows.
3. Confirm `/api/health` and sign in. Check Strum's selected GSC property and search type. Run the documented [GSC reconciliation](gsc-sync-operations.md) before trusting any action or report; use the same exact dates shown by the verifier in the GSC browser tab.
4. Open Strum's Today page, Action Backlog, Page Inventory, Keyword Map, Content Briefs, Crawl Changes, Paid Placements, AI Visibility, and Weekly Report. Verify no site shows another site's records. Historical agency documents and spreadsheets are **not** automatically imported; use the page-map preview import and placement ledger for records you choose to bring in.
5. Leave DataForSEO in Sandbox until the account key and site market are confirmed. Sandbox responses are synthetic. Switching a site to Live and confirming a cost preview is the only way the research/panel workflows can spend its DataForSEO credit. The current pilot safety cap is US$0.15 per site, with a US$0.06 per-request cap; this is a code cap, not the provider account balance.

No new required environment variable was added. Optional GA4 uses the existing Google OAuth client, but its Cloud project must have the **Google Analytics Data API** enabled. The site owner explicitly authorizes `analytics.readonly`, then enters the numeric GA4 property ID under AI Visibility. Connect checks access before saving. The GA4 property must correspond to the selected site; this is an owner selection, not automatically proven from its domain.

## Coolify scheduler

All jobs are `POST` requests with `Authorization: Bearer <CRON_SECRET>`. Put the secret in Coolify's secret store, not a public URL or repository file. Stagger jobs so they do not compete for resources:

| Suggested cadence (UTC) | Path | Work |
| --- | --- | --- |
| Daily 02:00 | `/api/cron/gsc-sync` | Refresh finalized GSC reports across connected sites. |
| Daily 03:00 | `/api/cron/seo-actions` | Re-evaluate free GSC action signals. Requires two complete 28-day periods for declines. |
| Daily 03:15 | `/api/cron/seo-outcomes` | Evaluate due changes when comparable finalized data exists. |
| Daily 03:30 | `/api/cron/ga4-sync` | Refresh connected GA4 properties; one failing site does not stop others. |
| Every 3 minutes | `/api/cron/ai-panel` | Process **one** confirmed, queued fixed-panel question. No queued run means no provider call. Allow a 180-second request timeout. |

The AI panel is deliberately resumable. Confirming a preview saves the exact question snapshot and estimated maximum; it does not call DataForSEO inside that browser request. The user can process the next question manually, and the cron worker can continue the same queue after a browser closes. A three-minute lease prevents overlapping workers. Cancel between questions to stop remaining requests. A request already in flight can still incur a charge. No cron endpoint accepts a caller-provided site ID.

## The 15-minute weekly operating loop

1. Read Today and GSC data health. If totals are stale or partial, fix synchronization before making a traffic conclusion.
2. Refresh free-data actions, then choose at most three from the Action Backlog. Inspect the evidence and affected URL/query. Plan the owner and due date. Treat exploratory Opportunities as research, not an automatically confirmed task.
3. For a service page or article, assign one strategic target in Keyword Map, create a Content Brief, and have the copywriter implement it on Strum. Crawl the site afterward. CrawlSEO does not publish content automatically.
4. Record the actual change and date on the action. The baseline is preserved and an equal post-change GSC outcome becomes available once enough finalized days exist.
5. Review the Weekly Report and Paid Placements ledger. Inspect live article links and spend; do not buy another placement solely because a publisher has a high domain rating. Compare useful qualified traffic and conversions, not just link counts.
6. For AI visibility, import a real GSC chart export when available, sync GA4, and only run a fixed citation panel if the sampled question will inform a decision. The exact private prompts that real AI users typed are not exposed by these sources.

## Release checks and rollback

- Run `node --import tsx --test tests/*.test.ts`, `npx tsc --noEmit --incremental false`, `npx eslint ...`, `npx prisma validate`, and `npm run build` in the release commit.
- Production check: `npm run gsc:verify -- --site cmrvvvvjb0003oy019eff27sj --days 28` must reconcile with Search Console before claiming click-count parity.
- Test a free action refresh, a completed action on a controlled sample, and an outcome only after its post-change window has finalized. Verify a missing report remains unavailable.
- Test GA4 and the GSC AI import with the owner's real property/export before claiming live-provider compatibility. Mock tests and the local PostgreSQL migration smoke test do not substitute for those checks.
- If a deployment fails, restore the previous image/commit and retain the new tables. The existing `GSC_READ_MODEL_V2=false` switch rolls back only GSC V2 reads, not the whole operator UI. Do not drop tables or delete user records as a rollback shortcut.
