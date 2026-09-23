# DataForSEO Operator Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing DataForSEO safety gateway into three site-scoped, decision-oriented workflows: competitor content gaps, paid-placement checks, and sampled ChatGPT citations.

**Architecture:** Reuse the authenticated per-site API routes and the existing budgeted, cached DataForSEO gateway. Add bounded operation specs and provider-response normalization, then expose explicit-run controls and actionable interpretations in the research workspace. The existing `DataForSeoRun` ledger supplies an audit trail; this release does not require a schema migration or background paid jobs.

**Tech Stack:** Next.js App Router, TypeScript, Prisma, React, node:test.

**Spec:** `docs/superpowers/specs/2026-09-14-solo-seo-operator-design.md` (sections 6, 7, 9, 10).

## Global Constraints

- Preserve `Site` as the tenancy boundary and verify ownership on every API call.
- Paid data is optional, cached, budgeted, and never fetched merely by opening a page.
- DataForSEO Sandbox output is synthetic and cannot be presented as real evidence.
- Show sources, market, sample time, and limitations; do not present third-party estimates as GSC totals.
- Keep the user's $1 credit untouched during implementation and tests.

## Review Focus

- Malformed competitor domains or article URLs must fail before a provider call; Task 1 tests this.
- A competitor gap request must compare competitor against the selected site, never another site's domain; Task 1 tests this.
- An unconfirmed POST must never call a paid endpoint; Task 2 tests this.
- A missing backlink in the provider index must say “not observed,” not “absent”; Task 2 tests this.
- An AI search result must be distinguished from sources actually cited; Task 1 tests this.

---

### Task 1: Provider operations and normalization

**Files:** Modify `lib/dataforseo/gateway.ts`, `lib/dataforseo/client.ts`; test `tests/dataforseo-operator.test.ts`.

**Interfaces:** Extend `DataForSeoKind` with `competitor_gap`, `placement`, `ai_citation`; keep `previewDataForSeo` and `executeDataForSeo` signatures. Export `parseCompetitorGap`, `parsePlacementCheck`, `parseAiCitationSample` normalized results.

- [ ] Write tests for request target validation, per-site request parameters, bounded result limits, and response parsing with documented provider-shaped fixtures.
- [ ] Run `npx tsx --test tests/dataforseo-operator.test.ts` and confirm feature-related failures.
- [ ] Add only these three operation specs, reuse cache and budget ledger, and set a 130-second timeout only for the ChatGPT scraper.
- [ ] Run the focused tests, then the full test suite.

### Task 2: Authenticated on-demand API and decisions

**Files:** Create `app/api/sites/[siteId]/operator-research/route.ts`, `lib/dataforseo/operator-decisions.ts`; modify `app/api/sites/[siteId]/dataforseo/preview/route.ts`; test `tests/dataforseo-operator-routes.test.ts`.

**Interfaces:** `POST` accepts `{kind,target,confirm:true}` and returns source-qualified normalized evidence plus a recommended next step. `GET` reads recent successful runs for this site without provider traffic.

- [ ] Write route tests for unauthorized/foreign-site/unconfirmed requests and decision tests for no result, observed placement, and cited versus uncited AI sources.
- [ ] Run the focused tests to observe failures.
- [ ] Implement the narrow API and pure decision functions; no paid call on GET.
- [ ] Run the focused tests and the full suite.

### Task 3: Research workspace

**Files:** Create `app/(dashboard)/sites/[siteId]/operator-research/page.tsx`, `components/research/operator-research-client.tsx`; modify `components/research/dataforseo-confirm.ts`, `components/layout/sidebar-nav.tsx`.

**Interfaces:** Server page verifies site ownership and supplies recent site-only runs. Client allows a user-initiated preview/confirm/execute for each workflow and shows evidence, recommendation, sample limitations, and provider cost.

- [ ] Add a route-level smoke test for GET read-only behavior and normalized history contract.
- [ ] Run it red; implement the page and controls.
- [ ] Run `npm test`, `npm run lint`, `npx tsc --noEmit`, and `npm run build` with build-time placeholders if needed.
- [ ] Review diff for accidental secrets or changes to user-owned untracked agency docs; commit only scoped files.

## Explicit Non-Goals For This Release

- Automated article purchasing, backlink toxicity scores, or automatic link removal.
- Claiming AI citation share-of-voice from one prompt or equating provider estimates with GSC clicks.
- Scheduled paid calls, a full action CRM, or new provider integrations.
