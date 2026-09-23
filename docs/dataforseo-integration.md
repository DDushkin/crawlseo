# DataForSEO pilot for STRUM

## What is live in the app

- Settings → DataForSEO is site-scoped. `strum.capital` starts in Ukraine (`2804`) / Ukrainian (`uk`); other sites retain US/English defaults until configured.
- Sandbox is the default. It is free but returns synthetic data. The interface labels it as such and prevents saving dummy keyword results.
- A saved API key does **not** enable paid calls. Live mode requires explicit site-level acknowledgement; each research action previews its estimated charge and asks for confirmation.
- The Settings page can check the provider account's actual balance using DataForSEO's free User Data endpoint. This is distinct from the app's per-site pilot ledger and includes spending outside this app.
- The pilot limits each site to $0.15 of recorded Live charges, with at most $0.06 estimated per individual request. Settings shows recent requests and charges. This is an application guard, not a provider-side billing limit: provider prices and final charges can differ from the estimate.
- Identical successful requests are cached (keywords 30 days; domains/backlinks 7 days). Duplicate requests already in progress are rejected.
- GET routes for keyword research, domain overview, and backlinks are free. Paid-provider operations require confirmed POST requests.
- Operator Research adds three manual workflows behind the same preview/confirmation and per-site ledger: competitor-only organic keyword gaps (Google Domain Intersection), exact paid-article backlink checks (Backlinks with `url_from` filter), and one-prompt ChatGPT web-search citation samples. No provider request is made when the workspace opens. Runs are kept in site-scoped history.

## Deployment

1. Deploy the new code. The existing Docker startup command runs `prisma migrate deploy` before launching the app. Confirm that step succeeded in Coolify logs; the migration adds site-scoped provider settings and a request ledger without altering existing site/GSC data. For a non-Docker deployment, run `npx prisma migrate deploy` before starting the new version.
2. Keep the existing `DATABASE_URL` and `NEXTAUTH_SECRET`. No new environment variable or DataForSEO credential in Coolify is required; credentials remain encrypted in the user API-key settings.
3. In a site's Settings page, save DataForSEO API credentials (the API login and generated API password, not the account password), test the connection, and confirm that the site market is correct.
4. Keep Sandbox enabled for initial UI checks. It will return dummy data. Only switch to Live when ready to spend; the pilot cap then applies per site.

## Operator Research: what to do next

1. **Competitor gaps:** Enter one direct Ukrainian competitor domain. Review the returned queries, volume, difficulty, intent, and competitor ranking page. Save only relevant queries, then map each to an existing STRUM service page or prepare a copywriter brief. These are provider estimates, not actual STRUM clicks or proof that a new page is needed.
2. **Paid article checks:** Paste an exact published article URL from the placement spreadsheet. An observed link shows its destination, anchor, and `dofollow` flag. “Not observed” means DataForSEO has not returned a matching link; check the live article or ask the publisher before drawing conclusions. The check does not measure the article's business ROI.
3. **AI citations:** Run a repeatable Ukrainian customer question. The workspace lists only final-answer cited sources, shows whether a STRUM domain was cited, and records the model and sample time when available. This is one ChatGPT sample, not a cross-platform citation share or a Google AI Overview metric.

The ChatGPT Live scraper is currently listed at $0.004 per result page in [DataForSEO pricing](https://dataforseo.com/pricing/ai-optimization/llm-scraper); the preview is an estimate, and the provider's recorded charge is authoritative. No Live requests or $1 trial-credit spending were used to implement or test these workflows.

## What the data means

- GSC clicks/impressions are first-party property totals; DataForSEO Labs traffic is a third-party estimate. They are different metrics and should not be reconciled as the same number.
- Outbound links discovered by the crawler are not backlinks. The Backlinks screen now reports no inbound data until a backlink provider is used.
- DataForSEO domain rank overview does not supply backlink counts; those come from its Backlinks Summary endpoint.
- The summary's “Not nofollow” count is derived from total backlinks minus links carrying the `nofollow` attribute; it is not a separate audited dofollow count.

## Later candidates, not yet implemented

1. **Broader content discovery:** [Keyword Ideas](https://docs.dataforseo.com/v3/dataforseo_labs-google-keyword_ideas-live/) can expand seed topics, then GSC and an explicit page map can separate optimize-existing from create-new decisions. The current keyword research already offers related-keyword metrics, and Operator Research now offers competitor-only gaps.
2. **Placement quality and ROI:** [Domain Pages Summary](https://docs.dataforseo.com/v3/backlinks-domain_pages_summary-live/) and [Backlinks Competitors](https://docs.dataforseo.com/v3/backlinks-competitors-live/) may help prospecting. A durable placement register with UAH cost, publisher agreement, live-page verification, target-page GSC outcome, and referral/conversion data is still needed before judging purchases. Do not rank publishers by DR alone.
3. **Longitudinal AI visibility:** a fixed prompt set, scheduled controlled samples, Google AI performance where officially available, and GA4 AI referrals are still needed for trends. [LLM Mentions](https://docs.dataforseo.com/v3/ai_optimization/llm_mentions/overview/) is not integrated and may have different locale coverage.

Do not run paid API Explorer queries to test these candidates: DataForSEO's Sandbox is the free integration environment.
