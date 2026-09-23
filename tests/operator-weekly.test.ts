import assert from "node:assert/strict";
import test from "node:test";
import { buildWeeklyReport, weeklyWindow, weeklyGscEvidenceState } from "../lib/operator/weekly-report";

test("weekly report uses equal finalized Pacific GSC weeks", () => {
  const window = weeklyWindow(new Date("2026-09-23T12:00:00Z"));
  assert.deepEqual(window, {
    current: { startDate: "2026-09-15", endDate: "2026-09-21" },
    previous: { startDate: "2026-09-08", endDate: "2026-09-14" },
  });
});

test("weekly report distinguishes no GSC V2 evidence from partial coverage", () => {
  const window = weeklyWindow(new Date("2026-09-23T12:00:00Z"));
  assert.equal(weeklyGscEvidenceState(false, null, window, new Date("2026-09-23T12:00:00Z")), "UNAVAILABLE");
  assert.equal(weeklyGscEvidenceState(true, null, window, new Date("2026-09-23T12:00:00Z")), "UNAVAILABLE");
  assert.equal(weeklyGscEvidenceState(true, { startDate: "2026-09-15", endDate: "2026-09-21" }, window, new Date("2026-09-23T12:00:00Z")), "PARTIAL");
  assert.equal(weeklyGscEvidenceState(true, { startDate: "2026-09-08", endDate: "2026-09-21" }, window, new Date("2026-09-23T12:00:00Z")), "FRESH");
});

test("weekly report keeps missing first-party data unavailable while retaining free crawler and action work", () => {
  const report = buildWeeklyReport({ siteId: "site-a", domain: "strum.capital",
    window: weeklyWindow(new Date("2026-09-23T12:00:00Z")),
    gsc: { current: null, previous: null, state: "PARTIAL" },
    ga4: { sessions: null, keyEvents: null, lastSync: null },
    googleAi: { impressions: null, days: 0 }, aiPanel: null,
    technical: { newCount: 3, resolvedCount: 1, comparedAt: "2026-09-19" },
    placements: { spentUah: 0, published: 0 }, provider: { spentUsd: 0 },
    actions: [{ id: "a", title: "Fix 5xx", status: "NEW", priority: 1000, signalActive: true },
      { id: "b", title: "Old", status: "DISMISSED", priority: 999, signalActive: true }],
    completed: 0, pendingOutcomes: 1, observedOutcomes: 0 });
  assert.equal(report.search.clicks, null);
  assert.equal(report.search.changePct, null);
  assert.equal(report.technical?.newCount, 3);
  assert.deepEqual(report.nextActions.map((item) => item.id), ["a"]);
  assert.equal(report.ga4.sessions, null);
});

test("weekly report distinguishes a real zero from no data and avoids a percent from zero baseline", () => {
  const report = buildWeeklyReport({ siteId: "site-a", domain: "strum.capital",
    window: weeklyWindow(new Date("2026-09-23T12:00:00Z")),
    gsc: { current: { clicks: 0, impressions: 200 }, previous: { clicks: 0, impressions: 100 }, state: "FRESH" },
    ga4: { sessions: 0, keyEvents: 0, lastSync: "2026-09-23" },
    googleAi: { impressions: 0, days: 7 }, aiPanel: null,
    technical: null, placements: { spentUah: 0, published: 0 }, provider: { spentUsd: 0 },
    actions: [], completed: 0, pendingOutcomes: 0, observedOutcomes: 0 });
  assert.equal(report.search.clicks, 0);
  assert.equal(report.search.changePct, null);
  assert.equal(report.googleAi.impressions, 0);
  assert.equal(report.ga4.sessions, 0);
});
