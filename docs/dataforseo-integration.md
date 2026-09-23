# DataForSEO pilot for STRUM

## What is live in the app

- Settings → DataForSEO is site-scoped. `strum.capital` starts in Ukraine (`2804`) / Ukrainian (`uk`); other sites retain US/English defaults until configured.
- Sandbox is the default. It is free but returns synthetic data. The interface labels it as such and prevents saving dummy keyword results.
- A saved API key does **not** enable paid calls. Live mode requires explicit site-level acknowledgement; each research action previews its estimated charge and asks for confirmation.
- The Settings page can check the provider account's actual balance using DataForSEO's free User Data endpoint. This is distinct from the app's per-site pilot ledger and includes spending outside this app.
- The pilot limits each site to $0.15 of recorded Live charges, with at most $0.06 estimated per individual request. Settings shows recent requests and charges. This is an application guard, not a provider-side billing limit: provider prices and final charges can differ from the estimate.
- Identical successful requests are cached (keywords 30 days; domains/backlinks 7 days). Duplicate requests already in progress are rejected.
- GET routes for keyword research, domain overview, and backlinks are free. Paid-provider operations require confirmed POST requests.

## Deployment

1. Deploy the new code. The existing Docker startup command runs `prisma migrate deploy` before launching the app. Confirm that step succeeded in Coolify logs; the migration adds site-scoped provider settings and a request ledger without altering existing site/GSC data. For a non-Docker deployment, run `npx prisma migrate deploy` before starting the new version.
2. Keep the existing `DATABASE_URL` and `NEXTAUTH_SECRET`. No new environment variable or DataForSEO credential in Coolify is required; credentials remain encrypted in the user API-key settings.
3. In a site's Settings page, save DataForSEO API credentials (the API login and generated API password, not the account password), test the connection, and confirm that the site market is correct.
4. Keep Sandbox enabled for initial UI checks. It will return dummy data. Only switch to Live when ready to spend; the pilot cap then applies per site.

## What the data means

- GSC clicks/impressions are first-party property totals; DataForSEO Labs traffic is a third-party estimate. They are different metrics and should not be reconciled as the same number.
- Outbound links discovered by the crawler are not backlinks. The Backlinks screen now reports no inbound data until a backlink provider is used.
- DataForSEO domain rank overview does not supply backlink counts; those come from its Backlinks Summary endpoint.
- The summary's “Not nofollow” count is derived from total backlinks minus links carrying the `nofollow` attribute; it is not a separate audited dofollow count.

## Next endpoints worth considering for STRUM

1. **Keyword ideas and domain gap:** combine GSC query/page performance with DataForSEO [Keyword Ideas](https://docs.dataforseo.com/v3/dataforseo_labs-google-keyword_ideas-live/) and [Domain Intersection](https://docs.dataforseo.com/v3/dataforseo_labs-google-domain_intersection-live/) to propose Ukrainian service pages and briefs. Review candidates manually before publishing.
2. **Link-placement quality and ROI:** use [Domain Pages Summary](https://docs.dataforseo.com/v3/backlinks-domain_pages_summary-live/) to see which STRUM pages actually attracted links, and [Backlinks Competitors](https://docs.dataforseo.com/v3/backlinks-competitors-live/) for prospect discovery. Verify editorial relevance, live links, indexability, `rel` attributes, and referral/conversion outcomes before paying publishers; do not rank publishers by DR alone.
3. **AI citations:** evaluate the current [LLM Mentions API](https://docs.dataforseo.com/v3/ai_optimization/llm_mentions/overview/) and [ChatGPT scraper](https://docs.dataforseo.com/v3/ai_optimization-chat_gpt-llm_scraper-overview/) on a fixed, small set of Ukrainian investment questions. Report prompt, platform, date, citations and source URL—not an invented universal “AI visibility” score. Validate pricing and locale support in Sandbox before adding Live requests.

These are candidates, not implemented data sources. Do not run paid API Explorer queries to test them: DataForSEO's Sandbox is the free integration environment.
