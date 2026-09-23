import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSitePageUrl, normalizeObservedSitePageUrls, normalizeTargetQuery, validateKeywordDecision } from "../lib/operator/pages";
import { buildContentBrief, updateBriefPlan } from "../lib/operator/briefs";

test("page identity accepts the site's www URL but rejects a lookalike host", () => {
  assert.equal(normalizeSitePageUrl("strum.capital", "https://www.strum.capital/features/ovdp-tracker/#overview"), "https://www.strum.capital/features/ovdp-tracker/");
  assert.throws(() => normalizeSitePageUrl("strum.capital", "https://strum.capital.evil.example/features/ovdp-tracker/"), /site domain/i);
  assert.throws(() => normalizeSitePageUrl("strum.capital", "http://localhost/features/ovdp-tracker/"), /site domain/i);
});

test("keyword decision requires a target page when optimizing existing content", () => {
  assert.equal(normalizeTargetQuery("  Трекер   ОВДП  "), "трекер овдп");
  assert.throws(() => validateKeywordDecision("OPTIMIZE_EXISTING", null), /target page/i);
  assert.equal(validateKeywordDecision("OPTIMIZE_EXISTING", "page-1"), true);
  assert.equal(validateKeywordDecision("CREATE_PAGE", null), true);
});

test("observed pages materialize only canonical HTTPS URLs on the selected site", () => {
  assert.deepEqual(normalizeObservedSitePageUrls("strum.capital", [
    "https://www.strum.capital/a/", "https://www.strum.capital/a/",
    "https://www.strum.capital/a/?utm_source=x", "http://www.strum.capital/b/",
    "https://other.example/c/", "https://www.strum.capital/b/",
  ]), ["https://www.strum.capital/a/", "https://www.strum.capital/b/"]);
});

test("brief marks missing competitor research as unavailable instead of inventing findings", () => {
  const brief = buildContentBrief({
    decision: "OPTIMIZE_EXISTING", query: "трекер овдп", pageUrl: "https://www.strum.capital/features/ovdp-tracker/",
    gsc: { clicks: 12, impressions: 210, position: 8.2, startDate: "2026-08-01", endDate: "2026-08-28" },
    competitorResults: [],
  });
  assert.deepEqual(brief.competitorEvidence, []);
  assert.equal(brief.competitorStatus, "UNAVAILABLE");
  assert.deepEqual(brief.gscEvidence, { source: "GSC", clicks: 12, impressions: 210, position: 8.2, startDate: "2026-08-01", endDate: "2026-08-28" });
  assert.match(brief.nextStep, /update|review/i);
});

test("brief distinguishes crawled facts and query-page overlap from unresearched SERP questions", () => {
  const brief = buildContentBrief({ decision: "OPTIMIZE_EXISTING", query: "трекер овдп", intent: "commercial",
    pageUrl: "https://www.strum.capital/features/ovdp-tracker/", gsc: null, competitorResults: [],
    pageEvidence: { source: "CRAWL", crawledAt: "2026-09-20", title: null, description: null, indexable: true,
      canonical: "https://www.strum.capital/features/ovdp-tracker/", hasSchema: false, internalLinks: 2 },
    queryPageEvidence: [{ url: "https://www.strum.capital/features/ovdp-tracker/", impressions: 90 },
      { url: "https://www.strum.capital/blog/ovdp/", impressions: 35 }],
  });
  assert.equal(brief.serpQuestionsStatus, "UNAVAILABLE");
  assert.equal(brief.cannibalizationReview.status, "REVIEW");
  assert.match(brief.crawlChecks.join(" "), /title|description/i);
  assert.deepEqual(brief.plan.questions, []);
});

test("copywriter can edit a brief plan without overwriting its evidence snapshot", () => {
  const original = buildContentBrief({ decision: "CREATE_PAGE", query: "трекер овдп", pageUrl: null, gsc: null, competitorResults: [] });
  const updated = updateBriefPlan(original, { title: "Трекер ОВДП", metaDescription: "Як стежити за ОВДП.",
    outline: ["Що таке трекер", "Приклади"], questions: ["Як рахувати купони?"], entities: ["ОВДП"],
    internalLinks: ["https://www.strum.capital/features/investment-tracker/"], expertiseNotes: "Verify with NBU sources", notes: "Review with copywriter" });
  assert.deepEqual(updated.gscEvidence, original.gscEvidence);
  assert.deepEqual(updated.plan.questions, ["Як рахувати купони?"]);
  assert.throws(() => updateBriefPlan(original, { ...updated.plan, outline: Array.from({ length: 51 }, () => "x") }), /outline/i);
});
