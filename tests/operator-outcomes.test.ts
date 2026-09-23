import assert from "node:assert/strict";
import test from "node:test";
import { comparisonWindow, completeAction, evaluateDueChanges, observedOutcome, outcomeReady, readGscMetricWindow, type PendingChange } from "../lib/operator/outcomes";

test("change evaluation uses equal 28-day windows and skips two days around the change", () => {
  assert.deepEqual(comparisonWindow("2026-09-23", 28), {
    baselineStart: "2026-08-24",
    baselineEnd: "2026-09-20",
    afterStart: "2026-09-25",
    afterEnd: "2026-10-22",
  });
});

test("outcome is pending until comparison data can be finalized", () => {
  assert.equal(outcomeReady("2026-10-22", "2026-10-23"), false);
  assert.equal(outcomeReady("2026-10-22", "2026-10-25"), true);
});

test("observed change reports absolute and relative differences without claiming causation", () => {
  assert.deepEqual(observedOutcome({ baselineClicks: 100, afterClicks: 120, baselineImpressions: 1000, afterImpressions: 1200 }), {
    status: "OBSERVED", clickDelta: 20, clickChangePct: 20, impressionDelta: 200,
    qualification: "The change preceded this difference; other factors may have contributed.",
  });
});

test("missing baseline is unavailable, while a true zero remains measurable", () => {
  assert.deepEqual(observedOutcome({ baselineClicks: null, afterClicks: 0, baselineImpressions: null, afterImpressions: 0 }), {
    status: "UNAVAILABLE", clickDelta: null, clickChangePct: null, impressionDelta: null,
    qualification: "A complete comparable GSC baseline is unavailable.",
  });
  assert.equal(observedOutcome({ baselineClicks: 0, afterClicks: 3, baselineImpressions: 0, afterImpressions: 5 }).clickChangePct, null);
});

test("completion snapshots a site-owned page baseline and never crosses tenants", async () => {
  const calls: string[] = [];
  const store = {
    findAction: async (siteId: string, actionId: string) => {
      calls.push(`find:${siteId}:${actionId}`);
      return { id: actionId, siteId, status: "IN_PROGRESS", pageUrl: "https://www.strum.capital/features/ovdp-tracker/", query: null };
    },
    readMetrics: async (siteId: string, scope: string, key: string | null, range: { startDate: string; endDate: string }) => {
      calls.push(`metrics:${siteId}:${scope}:${key}:${range.startDate}:${range.endDate}`);
      return { clicks: 40, impressions: 300 };
    },
    saveCompletion: async (input: { siteId: string; actionId: string; baselineClicks: number | null }) => {
      calls.push(`save:${input.siteId}:${input.actionId}:${input.baselineClicks}`);
      return { id: "change-1" };
    },
  };
  const result = await completeAction("site-1", "action-1", { description: "Added current OVDP examples", changedAt: "2026-09-23" }, store);
  assert.equal(result.id, "change-1");
  assert.deepEqual(calls, [
    "find:site-1:action-1",
    "metrics:site-1:PAGE:https://www.strum.capital/features/ovdp-tracker/:2026-08-24:2026-09-20",
    "save:site-1:action-1:40",
  ]);
});

test("completion rejects an action not owned by the selected site", async () => {
  let saved = false;
  const store = {
    findAction: async () => null,
    readMetrics: async () => null,
    saveCompletion: async () => { saved = true; return { id: "bad" }; },
  };
  await assert.rejects(completeAction("site-1", "foreign-action", { description: "Updated page", changedAt: "2026-09-23" }, store), /not found/i);
  assert.equal(saved, false);
});

test("completion rejects a future change date before reading site data", async () => {
  let read = false;
  const store = {
    findAction: async () => { read = true; return null; },
    readMetrics: async () => null,
    saveCompletion: async () => ({ id: "bad" }),
  };
  await assert.rejects(completeAction("site-1", "action-1", { description: "Updated page", changedAt: "2099-01-01" }, store), /future/i);
  assert.equal(read, false);
});

test("incomplete page coverage is unavailable and is never interpreted as zero clicks", async () => {
  let summed = false;
  const result = await readGscMetricWindow("site-1", "PAGE", "https://www.strum.capital/a", {
    startDate: "2026-08-01", endDate: "2026-08-28",
  }, {
    siteScope: async () => ({ property: "sc-domain:strum.capital", searchType: "web" }),
    completeCoverage: async () => false,
    sumMetrics: async () => { summed = true; return { clicks: 0, impressions: 0 }; },
  });
  assert.equal(result, null);
  assert.equal(summed, false);
});

test("complete coverage with no query row is a measured zero", async () => {
  const result = await readGscMetricWindow("site-1", "QUERY", "овдп", {
    startDate: "2026-08-01", endDate: "2026-08-28",
  }, {
    siteScope: async (siteId: string) => { assert.equal(siteId, "site-1"); return { property: "sc-domain:strum.capital", searchType: "web" }; },
    completeCoverage: async (_siteId: string, report: string) => { assert.equal(report, "query"); return true; },
    sumMetrics: async (scope: string, siteId: string, property: string, searchType: string, key: string | null) => {
      assert.deepEqual([scope, siteId, property, searchType, key], ["QUERY", "site-1", "sc-domain:strum.capital", "web", "овдп"]);
      return { clicks: null, impressions: null };
    },
  });
  assert.deepEqual(result, { clicks: 0, impressions: 0 });
});

test("evaluation saves only due changes with complete post-change coverage", async () => {
  const saved: Array<{ changeId: string; clickDelta: number | null }> = [];
  const changes = [
    { id: "due", siteId: "site-1", actionId: "action-1", metricScope: "PAGE" as const, metricKey: "https://www.strum.capital/a", baselineStart: "2026-08-24", baselineEnd: "2026-09-20", afterStart: "2026-09-25", afterEnd: "2026-10-22", baselineClicks: 40, baselineImpressions: 300 },
    { id: "later", siteId: "site-1", actionId: "action-2", metricScope: "QUERY" as const, metricKey: "овдп", baselineStart: "2026-08-24", baselineEnd: "2026-09-20", afterStart: "2026-10-01", afterEnd: "2026-10-28", baselineClicks: 10, baselineImpressions: 100 },
    { id: "incomplete", siteId: "site-1", actionId: "action-3", metricScope: "PAGE" as const, metricKey: "https://www.strum.capital/b", baselineStart: "2026-08-24", baselineEnd: "2026-09-20", afterStart: "2026-09-25", afterEnd: "2026-10-22", baselineClicks: 20, baselineImpressions: 200 },
  ];
  const result = await evaluateDueChanges("site-1", "2026-10-25", {
    listPending: async (siteId: string) => { assert.equal(siteId, "site-1"); return changes; },
    readMetrics: async (_siteId: string, _scope: string, key: string | null) => key?.endsWith("/b") ? null : { clicks: 50, impressions: 350 },
    saveBaseline: async () => {},
    saveOutcome: async (input: { changeId: string; clickDelta: number | null }) => { saved.push({ changeId: input.changeId, clickDelta: input.clickDelta }); },
  });
  assert.deepEqual(saved, [{ changeId: "due", clickDelta: 10 }]);
  assert.deepEqual(result, { evaluated: 1, pending: 2 });
});

test("missing baseline stays pending until a complete backfill allows an observed outcome", async () => {
  const saved: string[] = [];
  let baseline: { clicks: number; impressions: number } | null = null;
  const change: PendingChange = { id: "change-1", siteId: "site-1", actionId: "action-1", metricScope: "PAGE",
    metricKey: "https://www.strum.capital/a", baselineStart: "2026-08-24", baselineEnd: "2026-09-20",
    afterStart: "2026-09-25", afterEnd: "2026-10-22", baselineClicks: null, baselineImpressions: null };
  const store = {
    listPending: async () => [change],
    readMetrics: async (_siteId: string, _scope: string, _key: string | null, range: { startDate: string }) =>
      range.startDate === change.baselineStart ? baseline : { clicks: 12, impressions: 120 },
    saveBaseline: async (input: { baselineClicks: number; baselineImpressions: number }) => {
      change.baselineClicks = input.baselineClicks;
      change.baselineImpressions = input.baselineImpressions;
    },
    saveOutcome: async (input: { status: string; clickDelta: number | null }) => { saved.push(`${input.status}:${input.clickDelta}`); },
  };
  assert.deepEqual(await evaluateDueChanges("site-1", "2026-10-25", store), { evaluated: 0, pending: 1 });
  assert.deepEqual(saved, []);
  baseline = { clicks: 10, impressions: 100 };
  assert.deepEqual(await evaluateDueChanges("site-1", "2026-10-25", store), { evaluated: 1, pending: 0 });
  assert.deepEqual(saved, ["OBSERVED:2"]);
});
