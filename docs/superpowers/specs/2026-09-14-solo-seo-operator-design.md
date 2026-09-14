# Solo SEO Operator Product Design

**Status:** Approved in conversation on 2026-09-14

**Product:** CrawlSEO

**Primary constraint:** Preserve multi-site tenancy

## 1. Purpose

CrawlSEO will become a practical operating system for a person managing SEO without a dedicated SEO team. It must answer three questions for every site:

1. What changed?
2. What should I do next?
3. Did the work produce a measurable result?

The product is not intended to reproduce every report in Ahrefs, Semrush, or an agency CRM. Its value comes from connecting trustworthy evidence to a small number of prioritized actions and then measuring the outcome.

## 2. Current problem

The current product contains useful pieces—GSC synchronization, crawl data, keyword research, backlinks, alerts, Core Web Vitals, and opportunity calculations—but they do not yet form a dependable workflow.

The immediate correctness problem is that GSC rows grouped by query, page, date, device, and country are written into a table unique only by site, query, and date. Dimension combinations overwrite one another. Dashboard cards then sum the damaged rows, so their values can differ dramatically from Search Console.

Beyond that defect, most current insights are transient dashboard calculations. They are not deduplicated, assignable, dismissible, measurable, or connected to a change history. Paid DataForSEO calls also use global US/English defaults and are not guarded by per-site cost controls.

## 3. Product principles

- `Site` remains the tenancy and configuration boundary.
- Trustworthy first-party data takes priority over third-party estimates.
- Every recommendation must show evidence, date coverage, and calculation.
- The main experience is a prioritized action queue, not a wall of charts.
- Missing data, zero results, stale data, and provider errors are different states.
- Paid data is optional, cached, budgeted, and never fetched merely by opening a page.
- AI results are identified as sampled observations unless they come from first-party analytics.
- Completed work is measured, but correlation is not presented as proof of causation.
- Features must remain useful with only free Google data and the built-in crawler.
- New schema and behavior are introduced additively and can be rolled back safely.

## 4. System architecture

### 4.1 Site isolation

Every metric, page entity, keyword target, crawl, finding, action, change, outcome, prompt, provider setting, and report is scoped by `siteId`. Server-side access always verifies that the authenticated user owns the site. User-scoped credentials may be reused across sites only after the user explicitly connects a property to each site.

### 4.2 Normalized evidence pipeline

```text
Google Search Console  ─┐
GA4                    ─┤
Crawler                ─┤
PageSpeed / CrUX       ─┼─> normalized site evidence
DataForSEO             ─┤              │
AI visibility sources ─┘              v
                              deterministic detectors
                                       │
                                       v
                              prioritized SEO actions
                                       │
                                       v
                               changes and outcomes
```

Provider adapters convert external responses into normalized internal records. Recommendation logic does not consume raw provider response objects.

### 4.3 Durable page identity

The current `Page` model is a daily GSC metric row. Add a durable `SitePage` entity representing a canonical URL. GSC history, crawl snapshots, target keywords, actions, briefs, changes, and outcomes connect to it. Redirected and retired pages remain available for historical reporting.

## 5. Trustworthy GSC foundation

Fetch each valid Search Console aggregation independently instead of storing one over-dimensional report:

- Property totals by date.
- Query totals by date.
- Page totals by date.
- Query-to-page rows by date.
- Device totals by date.
- Country totals by date.

Cards and site trends use property totals. Keyword analysis uses query totals. Page analysis uses page totals. Cannibalization analysis uses query-to-page rows. Query and page sums are never substituted for property totals.

The first synchronization backfills 90 finalized days. Daily synchronization refreshes a recent overlap so late Google corrections are absorbed. Dates use Search Console's Pacific Time reporting semantics. Synchronization records pagination, data coverage, preliminary/final state, errors, and reconciliation differences.

The existing `Keyword` and `Page` tables remain temporarily for rollback but stop feeding primary views after the new data is reconciled and enabled.

## 6. Recommendation and action system

### 6.1 Persistent actions

Add a site-scoped `SeoAction` with:

- Stable fingerprint for idempotent detection.
- Type, affected page, and affected query or cluster.
- Plain-language title, rationale, and recommended implementation.
- Evidence with source and comparison dates.
- Expected benefit when it can be supported.
- Confidence and effort bands.
- Priority and material-change tracking.
- Status: new, planned, in progress, completed, dismissed, or monitoring.
- Optional owner, due date, notes, and checklist.
- First seen, last seen, dismissed-until, and completion dates.

Evidence may be structured JSON in the first version. Provider-specific raw payloads are not exposed as the action contract.

### 6.2 Prioritization

The default priority is based on supported upside, confidence, and effort. Critical indexability or availability regressions override the normal formula. Expected clicks are estimated only when impression volume and stable performance data are sufficient. CTR expectations should use the site's historical curve once adequate data exists.

The site home page displays approximately three actions for the current week and no more than five high-priority new actions at once. Lower-value findings remain available in the backlog.

Detection order:

1. Indexing, availability, robots, and canonical regressions.
2. Significant click or conversion loss.
3. High-impression pages within reach of stronger rankings.
4. Low CTR with sufficient impressions and stable position.
5. Evidence-backed cannibalization.
6. Weak internal linking for important pages.
7. Content decay.
8. Competitor content gaps.
9. AI citation and visibility gaps.

### 6.3 Change measurement

Completing an action creates an `SeoChange` describing what changed, when, where, and which queries it targeted. The system preserves a baseline and schedules an evaluation. An `SeoOutcome` records the observed difference against an equivalent comparison period and includes data-quality qualifications. Reports say that a change preceded an observed result, not that it necessarily caused it.

### 6.4 Alerts

Alerts and actions have different responsibilities. Alerts notify about urgent events or threshold breaches. Actions hold project work. An alert may create or elevate an action, but alert configuration remains separate.

## 7. Page, keyword, and content workspace

### 7.1 Page inventory

Each `SitePage` workspace combines:

- Canonical URL, page type, lifecycle state, and indexability.
- Latest crawl fields and changes.
- GSC performance and trend data.
- Google generative-AI impressions and sampled citations when available.
- Assigned keywords and intent.
- Internal competitors and linking context.
- Open actions, content briefs, changes, and outcomes.

### 7.2 Keyword map

Add site-scoped `KeywordTarget` records with an optional target page, primary/supporting role, intent, country, language, source, status, and available first- and third-party metrics. Suggested mappings may be generated from GSC query-to-page evidence, but strategic assignments require user confirmation.

The workflow recommends one of four decisions: optimize an existing page, consolidate competing pages, create a page, or reject the keyword. Multiple ranking URLs are flagged as cannibalization only when intent and performance evidence support that conclusion.

### 7.3 Content briefs

An evidence-backed brief includes target queries, intent, current performance, SERP competitors, common questions and entities, content gaps, suggested metadata and structure, internal links, schema, required expertise signals, AI-citability improvements, and cannibalization risks.

SERP research is fetched on demand and cached. Generative AI may synthesize retrieved evidence but may not invent competitor findings, statistics, or expertise. It does not publish changes automatically. If an LLM provider is added, it uses encrypted bring-your-own-key credentials and an explicit data-sharing setting.

### 7.4 Existing work import

Provide a previewed CSV/XLSX import for existing page maps: URLs, keyword assignments, metadata, status, and notes. Rows are validated against the selected site's domain before saving.

## 8. Technical monitoring

Existing `Crawl`, `AuditPage`, `AuditLink`, and `CrawlIssue` records remain immutable snapshots. Only a complete successful crawl becomes the next comparison baseline.

After a crawl, the application identifies new, persistent, and resolved conditions; connects URLs to `SitePage`; adds GSC importance; and updates persistent actions using stable fingerprints.

Default operation:

- Weekly full crawl.
- Manual crawl on demand.
- Optional daily checks for a small critical-page set.
- Per-site crawl limits, concurrency, exclusions, and coverage reporting.
- Sitemap-assisted discovery and protection from infinite URL spaces.

Checks focus on indexability, response failures, canonical conflicts, sitemap consistency, broken links, redirect chains, orphaning, weak internal links, hreflang, duplicate content, structured data appropriate to page type, major metadata/content changes, Core Web Vitals regressions, AI crawler access, and server-rendered content.

Severity is contextual. A missing description, multiple H1 elements, or missing schema is not automatically critical. Page traffic, commercial importance, affected URL count, active targeting, recent changes, and AI visibility influence priority.

## 9. AI visibility and citations

AI visibility consists of four explicitly separated evidence classes:

1. **Google generative-AI performance:** actual GSC impressions by available dimensions for AI Overviews and AI Mode.
2. **AI referral performance:** actual sessions and conversions from identifiable AI referrers through GA4.
3. **Sampled citation monitoring:** scheduled DataForSEO observations for a fixed prompt set across supported platforms, markets, and languages.
4. **On-site readiness:** crawler checks for accessibility, rendering, structure, source attribution, authorship, schema, and self-contained answer passages.

Add `AiPrompt`, `AiVisibilityRun`, `AiVisibilityResult`, `AiReferralDaily`, and `GscAiDaily`, all scoped by site. Useful metrics are Google AI impressions, AI-referred conversions, brand mention rate, citation rate, citation share of voice, cited pages, competing cited sources, new/lost citations, prompt coverage, data freshness, and cost.

Do not publish an opaque AI-readiness or citation-probability score. Sampled metrics always display prompt count, platforms, location, language, and collection time.

If Google's supported public API does not expose the dedicated generative-AI report, use a validated Search Console export import until an official API becomes available. Do not depend on undocumented Google endpoints.

## 10. Integrations and cost control

Initial adapters:

- GSC for search performance.
- GA4 for actual organic and AI-referred outcomes.
- PageSpeed/CrUX and URL Inspection for selective diagnostics.
- DataForSEO for keyword, SERP, competitor, backlink, and sampled AI visibility data.

DataForSEO is preferred over adding Serpstat or Ahrefs initially because CrawlSEO already contains a BYOK adapter and DataForSEO supports pay-as-you-go use. The current global US/English constants are replaced with site-specific location and language.

Paid calls are disabled until credentials and a site budget are configured. Before execution, show provider, operation, estimated cost, request size, cache availability, and remaining budget. Batch and standard-queue endpoints are preferred where supported. A dashboard page load never triggers paid work.

## 11. Scheduling, freshness, and failures

The initial self-hosted scheduler uses authenticated cron endpoints invoked by Coolify or another scheduler. Manual operations and cron operations call the same application services. Database run records and leases prevent duplicate concurrent work. One failing site does not stop other sites.

Every data surface exposes its source, last successful collection, coverage period, and final/preliminary/partial/stale/unavailable state. Transient failures retry with bounded backoff. Failed imports never replace the last known good data. Recommendations derived from stale evidence are marked stale and do not create repeated notifications.

## 12. Weekly operating experience

The default site screen becomes a concise "Today" view:

- Data health and important changes.
- Top three actions.
- Work awaiting measurement.
- Recently confirmed improvements.
- Link to the complete action backlog.

The weekly report adds clicks, impressions, conversions, branded/non-branded performance, Google AI visibility, new and resolved technical issues, completed work, observed outcomes, coming-week effort, and external API spend. It remains useful without paid integrations and should take approximately 15 minutes to review.

Each site may define a small number of goals, such as non-branded clicks, qualified conversions, important top-3/top-10 rankings, indexed priority pages, technical health, or AI-referred conversions.

## 13. Explicit non-goals

- Automatic publication or modification of managed websites.
- Bulk AI article generation.
- Automated link purchasing or outreach.
- An agency CRM, billing system, chat system, or time tracker.
- Daily rank checks for thousands of keywords by default.
- Reproducing every report offered by enterprise SEO suites.
- Recommendations without traceable evidence.
- Multiple paid data providers before a demonstrated need exists.

## 14. Delivery sequence

The product is implemented as independently deployable subprojects:

1. GSC truth layer.
2. Persistent action engine.
3. Page and keyword workspace.
4. Technical crawl comparison.
5. Content briefs and selective SERP research.
6. AI visibility and GA4 outcomes.
7. Weekly operator reporting.

Each subproject receives its own implementation plan and acceptance proof. The GSC truth layer is first because every GSC-based recommendation depends on it.

## 15. Product success criteria

- The same finalized GSC scope produces matching headline clicks and impressions in CrawlSEO and Search Console.
- Every recommendation identifies its source data and calculation.
- Re-running analysis does not create duplicate actions.
- Completed work receives an evaluation period and an evidence-qualified outcome.
- A site remains operable with free data sources only.
- Paid API use remains inside an explicit per-site budget.
- Cross-site access and data contamination are prevented by automated tests.
- A user can understand site health and choose the next three actions in approximately 15 minutes per week.
