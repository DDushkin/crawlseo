import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createRequire } from "node:module";
import { db } from "../lib/db";
import { getGscDataHealth } from "../lib/gsc/health";
import * as metrics from "../lib/seo-metrics";
import { prismaGscStore } from "../lib/gsc/store";
import type { Prisma } from "@prisma/client";

const require = createRequire(import.meta.url);
require.cache[require.resolve("../lib/auth")] = { exports: { auth: async () => ({ user: { id: "owner" } }) } } as NodeModule;
const siteRoute = require("../app/api/sites/[siteId]/route") as typeof import("../app/api/sites/[siteId]/route");
const propertyA = "sc-domain:a.example";
const propertyB = "sc-domain:b.example";
const range = { startDate: "2026-09-01", endDate: "2026-09-12" };
const row = { siteId: "site", property: propertyA, searchType: "web", date: new Date("2026-09-12"), clicks: 9, impressions: 90, ctr: 0.1, position: 3, query: "old", url: "/old", page: "/old" };
function intercept(t: TestContext, target: object, method: string, fn: (...args: never[]) => unknown) {
  const original = Object.getOwnPropertyDescriptor(target, method);
  Object.defineProperty(target, method, { configurable: true, value: fn });
  t.after(() => { if (original) Object.defineProperty(target, method, original); else Reflect.deleteProperty(target, method); });
}
function site(t: TestContext, version = 2) {
  intercept(t, db.site, "findUnique", async () => ({ id: "site", userId: "owner", gscProperty: propertyB, gscLegacyProperty: propertyA, gscDataVersion: version, gscSearchType: "web", gscSyncLease: null }));
  const flag = process.env.GSC_READ_MODEL_V2;
  delete process.env.GSC_READ_MODEL_V2;
  t.after(() => { if (flag === undefined) delete process.env.GSC_READ_MODEL_V2; else process.env.GSC_READ_MODEL_V2 = flag; });
}

test("health for property B ignores A runs and coverage", async (t) => {
  site(t);
  const run = { status: "COMPLETED", finishedAt: row.date, reportStates: {}, reconciliation: null, errorCode: null, errorMessage: null };
  intercept(t, db.gscSyncRun, "findFirst", async ({ where }: { where: { property?: string } }) => where.property === propertyB ? null : run);
  intercept(t, db.gscReportCoverage, "findFirst", async ({ where }: { where: { property?: string; syncRun?: { property: string } } }) =>
    where.property === propertyB && where.syncRun?.property === propertyB ? null : { startDate: row.date, endDate: row.date });
  const health = await getGscDataHealth("site");
  assert.equal(health.state, "unavailable");
  assert.equal(health.endDate, null);
  assert.equal(health.lastSuccessfulSync, null);
});

test("all V2 facade reads scope current property and originating sync run", async (t) => {
  site(t);
  let reads = 0;
  intercept(t, db.gscReportCoverage, "findFirst", async ({ where }: { where: Record<string, unknown> }) => {
    assert.equal(where.siteId, "site"); assert.equal(where.property, propertyB); assert.equal(where.searchType, "web");
    assert.deepEqual(where.syncRun, { property: propertyB });
    return { startDate: new Date("2026-06-15"), endDate: row.date };
  });
  for (const delegate of [db.gscDailyTotal, db.gscQueryDaily, db.gscPageDaily, db.gscQueryPageDaily]) {
    for (const method of ["findFirst", "findMany", "count"]) intercept(t, delegate, method, async ({ where }: { where: Record<string, unknown> }) => {
      reads++;
      assert.equal(where.siteId, "site");
      assert.equal(where.property, propertyB);
      assert.deepEqual(where.syncRun, { property: propertyB });
      return method === "count" ? 0 : method === "findFirst" ? { ...row, property: propertyB } : [];
    });
  }
  await metrics.getSitePeriodMetrics("site"); await metrics.getTopKeywords("site"); await metrics.getTopPages("site");
  await metrics.getDailyTraffic("site"); await metrics.getGscPeriodMetrics("site", range); await metrics.getGscTopQueries("site", range);
  await metrics.getGscTopPages("site", range); await metrics.getGscDailyTraffic("site", range); await metrics.getGscQueryHistory("site", "q", 28);
  await metrics.getGscLatestQueryMetric("site", "q"); await metrics.getGscSavedQueryMetrics("site", ["q"], 28);
  await metrics.getGscQueryPageRows("site", range); await metrics.getGscStoredCounts("site");
  assert.ok(reads > 20);
});

for (const [version, rollback] of [[1, false], [2, true]] as const) test(`legacy property mismatch hides every read (version ${version}, rollback ${rollback})`, async (t) => {
  site(t, version);
  if (rollback) process.env.GSC_READ_MODEL_V2 = "false";
  for (const delegate of [db.keyword, db.page]) {
    intercept(t, delegate, "findMany", async () => [row]);
    intercept(t, delegate, "findFirst", async () => row);
    intercept(t, delegate, "count", async () => 1);
  }
  assert.equal(await metrics.hasGscData("site"), false);
  assert.equal(await metrics.getStoredGscRange("site"), null);
  assert.equal((await metrics.getSitePeriodMetrics("site")).current.startDate, null);
  assert.equal((await metrics.getGscPeriodMetrics("site", range)).current.clicks, 0);
  assert.deepEqual(await metrics.getTopKeywords("site"), []); assert.deepEqual(await metrics.getTopPages("site"), []);
  assert.deepEqual(await metrics.getDailyTraffic("site"), []); assert.deepEqual(await metrics.getGscTopQueries("site", range), []);
  assert.deepEqual(await metrics.getGscTopPages("site", range), []); assert.deepEqual(await metrics.getGscDailyTraffic("site", range), []);
  assert.deepEqual(await metrics.getGscQueryHistory("site", "old", 28), []); assert.equal(await metrics.getGscLatestQueryMetric("site", "old"), null);
  assert.equal((await metrics.getGscSavedQueryMetrics("site", ["old"], 28)).size, 0);
  assert.deepEqual(await metrics.getGscQueryPageRows("site", range), []); assert.deepEqual(await metrics.getGscStoredCounts("site"), { queries: 0, pages: 0 });
});

test("property update resets readiness only on a change and never edits legacy provenance or rows", async (t) => {
  site(t);
  const writes: Record<string, unknown>[] = [];
  intercept(t, db.site, "update", async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); return data; });
  for (const gscProperty of [propertyA, propertyB]) {
    const response = await siteRoute.PUT(new Request("https://example.com/api/sites/site", { method: "PUT", body: JSON.stringify({ gscProperty }) }), { params: Promise.resolve({ siteId: "site" }) });
    assert.equal(response.status, 200);
  }
  assert.deepEqual(writes[0], { gscProperty: propertyA, gscDataVersion: 1, lastGscSyncAt: null });
  assert.deepEqual(writes[1], { gscProperty: propertyB });
});

test("in-flight property A cannot mark property B ready inside the fenced transaction", async (t) => {
  let inTransaction = false;
  let markedReady = false;
  intercept(t, db, "$transaction", async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => { inTransaction = true; try { return await callback(db); } finally { inTransaction = false; } });
  intercept(t, db.gscSyncLease, "updateMany", async () => ({ count: 1 }));
  intercept(t, db.site, "update", async ({ where }: { where: { gscProperty?: string } }) => {
    assert.equal(inTransaction, true);
    if (where.gscProperty !== propertyB && where.gscProperty !== undefined) throw new Error("Property changed");
    markedReady = true;
    return {};
  });
  await assert.rejects(prismaGscStore.markSiteReady("site", row.date, { ownerId: "old-run", expiresAt: new Date("2026-09-16") }, propertyA));
  assert.equal(markedReady, false);
});

test("run creation persists its target property and replacement scopes retain other properties", async (t) => {
  intercept(t, db.gscSyncRun, "create", async ({ data }: { data: { property?: string } }) => { assert.equal(data.property, propertyB); return { id: "run-b" }; });
  await prismaGscStore.createRun({ siteId: "site", property: propertyB, searchType: "web", trigger: "MANUAL", requestedRange: range, startedAt: row.date });
  intercept(t, db, "$transaction", async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => callback(db));
  intercept(t, db.gscSyncLease, "updateMany", async () => ({ count: 1 }));
  intercept(t, db.gscSyncRun, "findFirst", async ({ where }: { where: { property?: string } }) => { assert.equal(where.property, propertyB); return { reportCounts: {}, reportStates: {} }; });
  intercept(t, db.gscSyncRun, "update", async () => ({}));
  intercept(t, db.gscReportCoverage, "findFirst", async () => null);
  intercept(t, db.gscReportCoverage, "upsert", async ({ create }: { create: { property: string; syncRunId: string } }) => {
    assert.equal(create.property, propertyB); assert.equal(create.syncRunId, "run-b"); return create;
  });
  for (const delegate of [db.gscDailyTotal, db.gscQueryDaily, db.gscPageDaily, db.gscQueryPageDaily, db.gscDeviceDaily, db.gscCountryDaily]) {
    intercept(t, delegate, "deleteMany", async ({ where }: { where: { property?: string } }) => { assert.equal(where.property, propertyB); return { count: 0 }; });
    intercept(t, delegate, "createMany", async ({ data }: { data: { property?: string }[] }) => { assert.equal(data[0].property, propertyB); return { count: 1 }; });
  }
  for (const kind of ["dailyTotal", "query", "page", "queryPage", "device", "country"] as const) await prismaGscStore.replaceReport({ siteId: "site", property: propertyB, runId: "run-b", searchType: "web", range, kind, complete: true, pagesFetched: 1, truncatedAt: null, lease: { ownerId: "owner", expiresAt: row.date }, rows: [{ ...row, date: "2026-09-12", device: "MOBILE", country: "USA" }] });
});
