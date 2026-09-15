import assert from "node:assert/strict";
import test from "node:test";
import { projectGscDataHealth, type GscHealthInput } from "../lib/gsc/health";
import * as healthModule from "../lib/gsc/health";
import * as trafficModule from "../lib/gsc/health";
import * as syncModule from "../components/sites/sync-button";
import { db } from "../lib/db";
import { emptyGscReportCounts } from "../lib/gsc/types";
import type { GscSyncResult } from "../lib/gsc/sync-service";

const now = new Date("2026-09-15T06:30:00Z"); // September 14 in Pacific time.
const complete = { status: "COMPLETED", finishedAt: new Date("2026-09-14T10:00:00Z"), reportStates: {}, reconciliation: { queryCoverage: { clicks: 0.8 }, warnings: [] }, errorCode: null, errorMessage: null };
const input: GscHealthInput = { property: "sc-domain:example.com", searchType: "web", startDate: "2026-08-14", endDate: "2026-09-10", lastSuccessfulRun: complete, latestRun: complete, leaseExpiresAt: null, now };

test("unavailable without a property or a successful run", () => {
  assert.equal(projectGscDataHealth({ ...input, property: null }).state, "unavailable");
  assert.equal(projectGscDataHealth({ ...input, latestRun: null, lastSuccessfulRun: null }).state, "unavailable");
});
test("syncing only while the latest running run has a current lease, including first sync", () => {
  assert.equal(projectGscDataHealth({ ...input, lastSuccessfulRun: null, latestRun: { ...complete, status: "RUNNING" }, leaseExpiresAt: new Date("2026-09-15T07:00:00Z") }).state, "syncing");
});
test("fresh through four Pacific dates, with exact stored coverage and reconciliation", () => {
  assert.deepEqual(projectGscDataHealth(input), { state: "fresh", property: "sc-domain:example.com", searchType: "web", startDate: "2026-08-14", endDate: "2026-09-10", lastSuccessfulSync: "2026-09-14T10:00:00.000Z", queryClickCoverage: 0.8, warnings: [] });
});
test("stale beyond four Pacific dates", () => {
  assert.equal(projectGscDataHealth({ ...input, endDate: "2026-09-09" }).state, "stale");
});
test("partial for warning completion or incomplete reports, ahead of stale", () => {
  assert.equal(projectGscDataHealth({ ...input, endDate: "2026-08-01", latestRun: { ...complete, status: "COMPLETED_WITH_WARNINGS" } }).state, "partial");
  const health = projectGscDataHealth({ ...input, latestRun: { ...complete, reportStates: { query: { complete: false } } } });
  assert.equal(health.state, "partial");
  assert.match(health.warnings[0].message, /incomplete/i);
});
test("a successful run with warnings remains partial when no totals were stored", () => {
  const run = { ...complete, status: "COMPLETED_WITH_WARNINGS", reportStates: { dailyTotal: { complete: false } } };
  assert.equal(projectGscDataHealth({ ...input, startDate: null, endDate: null, latestRun: run, lastSuccessfulRun: run }).state, "partial");
});
test("failed preserves earlier coverage and sanitized recovery, even on a first failed sync", () => {
  const latestRun = { ...complete, status: "FAILED", errorCode: "PROVIDER_ERROR", errorMessage: "Search Console synchronization failed. Please try again." };
  const health = projectGscDataHealth({ ...input, latestRun });
  assert.equal(health.state, "failed");
  assert.equal(health.endDate, "2026-09-10");
  assert.equal(health.queryClickCoverage, 0.8);
  assert.match(health.warnings[0].message, /try again/);
  assert.equal(projectGscDataHealth({ ...input, latestRun, lastSuccessfulRun: null }).state, "failed");
});
test("reauth-required takes precedence over failed and missing success", () => {
  assert.equal(projectGscDataHealth({ ...input, lastSuccessfulRun: null, latestRun: { ...complete, status: "FAILED", errorCode: "REAUTH_REQUIRED" } }).state, "reauth-required");
});
test("expired or absent running leases report interruption instead of syncing forever", () => {
  for (const leaseExpiresAt of [null, now]) {
    const result = projectGscDataHealth({ ...input, latestRun: { ...complete, status: "RUNNING" }, leaseExpiresAt });
    assert.equal(result.state, "failed");
    assert.match(result.warnings[0].message, /sync again/i);
  }
});
test("missing property totals and malformed reconciliation have explicit empty states", () => {
  const health = projectGscDataHealth({ ...input, startDate: null, endDate: null, lastSuccessfulRun: { ...complete, reconciliation: { queryCoverage: { clicks: "bad" }, warnings: [null] } } });
  assert.equal(health.state, "unavailable");
  assert.equal(health.queryClickCoverage, null);
  assert.deepEqual(health.warnings, []);
});

test("health loader scopes selected fields, successful run, latest run and date bounds to site/search type", async (context) => {
  assert.equal(typeof healthModule.getGscDataHealth, "function");
  function intercept(target: object, method: string, implementation: (...args: never[]) => unknown) {
    const original = Object.getOwnPropertyDescriptor(target, method);
    Object.defineProperty(target, method, { configurable: true, value: implementation });
    context.after(() => { if (original) Object.defineProperty(target, method, original); else Reflect.deleteProperty(target, method); });
  }
  intercept(db.site, "findUnique", async (args: { where: unknown; select: unknown }) => {
    assert.deepEqual(args, { where: { id: "site-a" }, select: { gscProperty: true, gscSearchType: true, gscSyncLease: { select: { expiresAt: true } } } });
    return { gscProperty: "sc-domain:example.com", gscSearchType: "image", gscSyncLease: null };
  });
  intercept(db.gscSyncRun, "findFirst", async (args: { where: Record<string, unknown>; select: Record<string, unknown> }) => {
    assert.equal(args.where.siteId, "site-a");
    assert.equal(args.where.searchType, "image");
    assert.equal(args.where.property, "sc-domain:example.com");
    assert.equal(args.where.dataState, "final");
    assert.equal(args.select.reportCounts, undefined);
    if (args.where.status) assert.deepEqual(args.where.status, { in: ["COMPLETED", "COMPLETED_WITH_WARNINGS"] });
    return complete;
  });
  intercept(db.gscDailyTotal, "aggregate", async (args: unknown) => {
    assert.deepEqual(args, { where: { siteId: "site-a", property: "sc-domain:example.com", searchType: "image", syncRun: { property: "sc-domain:example.com" } }, _min: { date: true }, _max: { date: true } });
    return { _min: { date: new Date("2026-08-14") }, _max: { date: new Date("2026-09-10") } };
  });
  const health = await healthModule.getGscDataHealth("site-a");
  assert.equal(health.searchType, "image");
  assert.equal(health.startDate, "2026-08-14");
  assert.equal(health.endDate, "2026-09-10");
});

test("traffic response derives observed bounds from returned rows, preserving metrics and empty coverage", () => {
  assert.equal(typeof trafficModule.toTrafficResponse, "function");
  const rows = [{ date: "2026-09-12", clicks: 0, impressions: 0 }, { date: "2026-09-10", clicks: 3, impressions: 8 }];
  assert.deepEqual(trafficModule.toTrafficResponse(rows), { coverage: { startDate: "2026-09-10", endDate: "2026-09-12" }, rows });
  assert.deepEqual(trafficModule.toTrafficResponse([]), { coverage: { startDate: null, endDate: null }, rows: [] });
});

const result: GscSyncResult = { status: "completed", runId: "run-a", startDate: "2026-08-14", endDate: "2026-09-12", reportCounts: { ...emptyGscReportCounts(), dailyTotal: 28, query: 200, page: 40 }, warnings: [] };
for (const [status, message, refresh, tone] of [
  ["completed", "Synced through 2026-09-12", true, "success"],
  ["completed-with-warnings", "Synced with data warnings", true, "warning"],
  ["already-running", "A sync is already running", false, "neutral"],
  ["failed", "Search Console synchronization failed. Please try again.", false, "error"],
] as const) {
  test(`sync feedback maps ${status} to status text and refresh behavior`, () => {
    assert.equal(typeof syncModule.projectSyncFeedback, "function");
    const feedback = syncModule.projectSyncFeedback({ ...result, status }, status === "already-running" ? 409 : status === "failed" ? 502 : 200);
    assert.equal(feedback.message, message);
    assert.equal(feedback.refresh, refresh);
    assert.equal(feedback.tone, tone);
    assert.equal(feedback.reauthRequired, false);
    if (refresh) assert.match(feedback.counts!, /28 daily totals · 200 query rows · 40 page rows/);
    else assert.equal(feedback.counts, null);
  });
}
test("sync feedback understands both sanitized HTTP errors and nested result errors, including reconnect", () => {
  assert.equal(typeof syncModule.projectSyncFeedback, "function");
  for (const body of [{ error: "Reconnect Google.", code: "REAUTH_REQUIRED" }, { ...result, status: "failed", error: { code: "REAUTH_REQUIRED", message: "Reconnect Google." } }]) {
    const feedback = syncModule.projectSyncFeedback(body, 401);
    assert.equal(feedback.reauthRequired, true);
    assert.equal(feedback.refresh, false);
  }
  assert.equal(syncModule.projectSyncFeedback({ error: "Connect a Search Console property first.", code: "NO_PROPERTY" }, 400).message, "Connect a Search Console property first.");
  assert.equal(syncModule.projectSyncFeedback({ ...result, endDate: null }, 200).message, "Sync completed; no finalized dates were returned.");
  assert.equal(syncModule.projectSyncFeedback(null, 200).tone, "error");
});
