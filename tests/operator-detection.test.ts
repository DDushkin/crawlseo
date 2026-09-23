import assert from "node:assert/strict";
import test from "node:test";
import { detectGscFindings, chooseTodayActions } from "../lib/operator/detect";

test("detector explains a significant property decline with equal GSC periods", () => {
  const findings = detectGscFindings({ property: "sc-domain:strum.capital", searchType: "web",
    previous: { startDate: "2026-07-27", endDate: "2026-08-23" }, current: { startDate: "2026-08-24", endDate: "2026-09-20" },
    totals: [
      { date: "2026-08-01", clicks: 200, impressions: 3000 },
      { date: "2026-09-01", clicks: 120, impressions: 2800 },
    ], pages: [], queries: [] });
  assert.equal(findings[0].type, "SITE_TRAFFIC_DECLINE");
  assert.equal(findings[0].expectedClicks, null);
  assert.equal(findings[0].evidence.source, "GSC_PROPERTY_TOTAL");
  assert.equal(findings[0].evidence.lostClicks, 80);
  assert.match(findings[0].rationale, /200.*120/);
});

test("detector suppresses small noisy drops and qualifies page and query opportunities", () => {
  const findings = detectGscFindings({ property: "sc-domain:strum.capital", searchType: "web",
    previous: { startDate: "2026-07-27", endDate: "2026-08-23" }, current: { startDate: "2026-08-24", endDate: "2026-09-20" },
    totals: [{ date: "2026-08-01", clicks: 20, impressions: 100 }, { date: "2026-09-01", clicks: 10, impressions: 100 }],
    pages: [
      { date: "2026-08-01", url: "https://www.strum.capital/features/stock-tracker/", clicks: 70, impressions: 1000, position: 8 },
      { date: "2026-09-01", url: "https://www.strum.capital/features/stock-tracker/", clicks: 30, impressions: 900, position: 9 },
    ],
    queries: [
      { date: "2026-09-01", query: "трекер акцій", clicks: 15, impressions: 400, position: 8 },
      { date: "2026-09-01", query: "too small", clicks: 2, impressions: 40, position: 8 },
    ] });
  assert.deepEqual(findings.map((item) => item.type), ["PAGE_TRAFFIC_DECLINE", "QUERY_STRIKING_DISTANCE"]);
  assert.equal(findings[0].evidence.source, "GSC_PAGE");
  assert.equal(findings[1].evidence.source, "GSC_QUERY");
  assert.match(findings[1].recommendation, /Review the actual ranking page/i);
});

test("Today chooses at most three current actions and hides dismissed or completed work", () => {
  const chosen = chooseTodayActions([
    { id: "low", status: "NEW", priority: 20 }, { id: "high", status: "NEW", priority: 90 },
    { id: "done", status: "COMPLETED", priority: 1000 }, { id: "planned", status: "PLANNED", priority: 60 },
    { id: "middle", status: "IN_PROGRESS", priority: 50 }, { id: "dismissed", status: "DISMISSED", priority: 800 },
    { id: "resolved", status: "NEW", priority: 999, signalActive: false },
  ]);
  assert.deepEqual(chosen.map((item) => item.id), ["high", "planned", "middle"]);
});
