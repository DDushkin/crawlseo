import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSitePageUrl, normalizeTargetQuery, validateKeywordDecision } from "../lib/operator/pages";
import { buildContentBrief } from "../lib/operator/briefs";

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
