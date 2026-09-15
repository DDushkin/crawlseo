import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { db } from "../lib/db";
import { prismaGscStore, type ReplaceGscReportInput } from "../lib/gsc/store";
import { createGscSyncService } from "../lib/gsc/sync-service";
import { getGscDataHealth } from "../lib/gsc/health";
import * as metrics from "../lib/seo-metrics";
import { getV2StoredGscRange } from "../lib/gsc/read-model";
import { getStrikingDistance, getLowCtrOpportunities, getContentDecay, getCannibalization } from "../lib/seo-opportunities";
import { type GscMetricRow, type GscReportKind } from "../lib/gsc/types";
import { runVerification } from "../scripts/verify-gsc";
import { coverageDatabase, intercept } from "./helpers/gsc-coverage-db";

const now = new Date("2026-09-15T12:00:00Z");
const scope = { siteId: "site", property: "sc-domain:example.com", searchType: "web" as const };
const target = { ...scope, userId: "owner", dataVersion: 2 };
const oldRange = { startDate: "2026-06-15", endDate: "2026-09-12" };
const refresh = { startDate: "2026-09-07", endDate: "2026-09-13" };
const metric = { date: "2026-09-12", clicks: 0, impressions: 100, ctr: 0, position: 5 };

function service(finalizedThrough: string, rows: Partial<Record<GscReportKind, GscMetricRow[]>> = {}, truncated?: GscReportKind) {
  return createGscSyncService({ store: prismaGscStore, now: () => new Date(now.getTime() + (finalizedThrough === "2026-09-13" ? 60_000 : 0)), randomId: () => "lease",
    probeCoverage: async () => ({ finalizedThrough, source: "metadata" }),
    fetchReport: async (_user, _property, _range, kind) => ({ kind, rows: rows[kind] ?? [], complete: kind !== truncated, pagesFetched: 1, truncatedAt: kind === truncated ? 250000 : null }),
  });
}

async function replace(input: Partial<ReplaceGscReportInput> = {}) {
  return prismaGscStore.replaceReport({ ...scope, runId: "run", kind: "dailyTotal", range: refresh, rows: [], complete: true,
    pagesFetched: 1, truncatedAt: null, lease: { ownerId: "lease", expiresAt: new Date("2026-09-15T13:00:00Z") }, ...input });
}

function seedReplacement(fixture: ReturnType<typeof coverageDatabase>) {
  fixture.tables.runs.push({ id: "run", ...scope, reportCounts: {}, reportStates: {} });
  fixture.tables.leases.push({ ...scope, ownerId: "lease", expiresAt: new Date("2026-09-15T13:00:00Z") });
}

test("complete empty backfill is synced through the metadata-finalized date in range, health and verification", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const fixture = coverageDatabase(t);
  assert.equal((await service("2026-09-13").syncTarget({ ...target, dataVersion: 1 }, "INITIAL")).status, "completed");
  assert.equal(fixture.tables.coverage.length, 6);
  assert.deepEqual(await metrics.getStoredGscRange("site", 28), { startDate: "2026-08-17", endDate: "2026-09-13" });
  assert.equal(await metrics.hasGscData("site"), true);
  const health = await getGscDataHealth("site");
  assert.equal(health.state, "fresh");
  assert.equal(health.startDate, "2026-06-16");
  assert.equal(health.endDate, "2026-09-13");
  const output: string[] = [];
  const code = await runVerification(["--site", "site"], {
    findSite: async () => ({ id: "site", userId: "owner", gscProperty: scope.property, gscSearchType: "web" }),
    getCanonicalRange: getV2StoredGscRange,
    fetchReadOnlyReport: async (_user, _property, range, kind) => {
      assert.deepEqual(range, { startDate: "2026-08-17", endDate: "2026-09-13" });
      return { kind, rows: [], complete: true, pagesFetched: 1, truncatedAt: null };
    }, getStoredRows: async () => [], writeLine: (line) => output.push(line),
  });
  assert.equal(code, 0);
  assert.equal(JSON.parse(output[0]).matches, true);
});

test("a zero-data final day still selects exactly August 17 through September 13", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  coverageDatabase(t);
  await service("2026-09-13", { dailyTotal: [{ ...metric, clicks: 5 }] }).syncTarget(target, "CLI", "backfill");
  assert.deepEqual(await metrics.getStoredGscRange("site", 28), { startDate: "2026-08-17", endDate: "2026-09-13" });
  assert.equal((await metrics.getSitePeriodMetrics("site")).current.clicks, 5);
});

test("incomplete replacement preserves the prior complete interval and its provenance", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const fixture = coverageDatabase(t); seedReplacement(fixture);
  fixture.tables.coverage.push({ ...scope, reportKind: "dailyTotal", startDate: new Date(oldRange.startDate), endDate: new Date(oldRange.endDate), syncRunId: "prior" });
  const prior = structuredClone(fixture.tables.coverage);
  await replace({ complete: false, truncatedAt: 250000 });
  assert.deepEqual(fixture.tables.coverage, prior);
});

for (const [label, priorStart, priorEnd, incomingStart, incomingEnd, wantStart, wantEnd] of [
  ["overlap", "2026-08-01", "2026-09-12", "2026-09-07", "2026-09-13", "2026-08-01", "2026-09-13"],
  ["contiguous", "2026-08-01", "2026-09-06", "2026-09-07", "2026-09-13", "2026-08-01", "2026-09-13"],
  ["newer gap", "2026-08-01", "2026-09-01", "2026-09-07", "2026-09-13", "2026-09-07", "2026-09-13"],
  ["older gap", "2026-09-07", "2026-09-13", "2026-08-01", "2026-08-15", "2026-09-07", "2026-09-13"],
] as const) test(`coverage records ${label} without claiming missing dates`, async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const fixture = coverageDatabase(t); seedReplacement(fixture);
  fixture.tables.runs.push({ id: "prior", ...scope });
  fixture.tables.coverage.push({ ...scope, reportKind: "dailyTotal", startDate: new Date(priorStart), endDate: new Date(priorEnd), syncRunId: "prior" });
  await replace({ range: { startDate: incomingStart, endDate: incomingEnd } });
  assert.deepEqual(fixture.tables.coverage.map((row) => [row.startDate, row.endDate, row.syncRunId]), [[new Date(wantStart), new Date(wantEnd), label === "older gap" ? "prior" : "run"]]);
});

test("coverage reads never mix sites, properties, search types or mismatched run properties", async (t) => {
  const fixture = coverageDatabase(t);
  fixture.tables.runs.push({ id: "old", ...scope, property: "sc-domain:old.example" }, { id: "matching", ...scope });
  for (const extra of [{ property: "sc-domain:old.example" }, { siteId: "other" }, { searchType: "image" }, { syncRunId: "old" }]) {
    fixture.tables.coverage.push({ ...scope, reportKind: "dailyTotal", startDate: new Date("2026-06-01"), endDate: new Date("2026-09-13"), syncRunId: "matching", ...extra });
  }
  assert.equal(await metrics.getStoredGscRange("site"), null);
  assert.equal((await getGscDataHealth("site")).endDate, null);
});

test("completing another property's report preserves existing property history and never merges its coverage", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const fixture = coverageDatabase(t); seedReplacement(fixture);
  const other = { ...scope, property: "sc-domain:other.example" };
  fixture.tables.runs.push({ id: "other", ...other });
  fixture.tables.coverage.push({ ...other, reportKind: "dailyTotal", startDate: new Date("2026-06-15"), endDate: new Date("2026-09-12"), syncRunId: "other" });
  const oldRow = { ...other, date: new Date("2026-09-12"), clicks: 9, impressions: 90, position: 2, syncRunId: "other" };
  fixture.tables.dailyTotal.push(oldRow);
  const prior = structuredClone(fixture.tables.coverage[0]);
  await replace();
  assert.equal(fixture.tables.coverage.length, 2);
  assert.deepEqual(fixture.tables.coverage[0], prior);
  assert.equal(fixture.tables.coverage[1].startDate?.valueOf(), new Date("2026-09-07").valueOf());
  assert.deepEqual(fixture.tables.dailyTotal, [oldRow]);
  assert.equal(await metrics.getStoredGscRange("site", 28), null);
});

test("failed report transaction rolls back rows and complete coverage together", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const fixture = coverageDatabase(t); seedReplacement(fixture);
  const row = { ...scope, date: new Date("2026-09-12"), clicks: 9, impressions: 90, position: 2, syncRunId: "run" };
  fixture.tables.dailyTotal.push(row);
  fixture.tables.coverage.push({ ...scope, reportKind: "dailyTotal", startDate: new Date(oldRange.startDate), endDate: new Date(oldRange.endDate), syncRunId: "run" });
  const prior = structuredClone(fixture.tables.coverage);
  intercept(t, db.gscSyncRun, "update", async () => { throw new Error("transaction fails after replacing rows and coverage"); });
  await assert.rejects(replace());
  assert.deepEqual(fixture.tables.coverage, prior);
  assert.deepEqual(fixture.tables.dailyTotal, [row]);
});

test("lost lease leaves complete coverage unchanged", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const fixture = coverageDatabase(t); seedReplacement(fixture);
  fixture.tables.leases[0].ownerId = "new-owner";
  fixture.tables.coverage.push({ ...scope, reportKind: "dailyTotal", startDate: new Date(oldRange.startDate), endDate: new Date(oldRange.endDate), syncRunId: "run" });
  const prior = structuredClone(fixture.tables.coverage);
  await assert.rejects(replace(), { code: "PROVIDER_ERROR" });
  assert.deepEqual(fixture.tables.coverage, prior);
});

test("decay requires complete previous coverage even when the current page report is complete", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const fixture = coverageDatabase(t);
  await service("2026-09-13", { page: [{ ...metric, date: "2026-08-01", clicks: 100, url: "/decay" }] }).syncTarget(target, "CLI", "backfill");
  const pageCoverage = fixture.tables.coverage.find((row) => row.reportKind === "page")!;
  pageCoverage.startDate = new Date("2026-08-17");
  assert.equal(await metrics.hasCompleteGscReportCoverage("site", "page", { startDate: "2026-08-17", endDate: "2026-09-13" }), true);
  assert.deepEqual(await getContentDecay("site"), []);
});

test("a gap prevents a 28-day canonical verification range but preserves one-day readiness", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  coverageDatabase(t);
  await service("2026-09-13").syncTarget(target, "MANUAL");
  assert.equal(await getV2StoredGscRange(scope, 28), null);
  assert.equal(await metrics.hasGscData("site"), true);
});

for (const truncated of ["page", "query", "queryPage"] as const) test(`ready-site ${truncated} truncation gates only recommendations using that report`, async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const fixture = coverageDatabase(t);
  const previous = { ...metric, date: "2026-08-01", clicks: 100, url: "/decay" };
  const oldRows = { dailyTotal: [metric], query: [{ ...metric, query: "shoe" }], page: [previous, { ...metric, date: "2026-08-16", clicks: 100, url: "/decay" }],
    queryPage: [{ ...metric, query: "shoe", url: "/a" }, { ...metric, query: "shoe", url: "/b" }] };
  await service("2026-09-12", oldRows).syncTarget(target, "CLI", "backfill");
  assert.equal((await getContentDecay("site")).length, 0, "the prior window has no decay");
  const oldCoverage = structuredClone(fixture.tables.coverage.find((row) => row.reportKind === truncated));
  const result = await service("2026-09-13", { dailyTotal: [{ ...metric, date: "2026-09-13" }], query: oldRows.query, queryPage: oldRows.queryPage }, truncated).syncTarget(target, "SCHEDULED");
  assert.equal(result.status, "completed-with-warnings");
  assert.deepEqual(fixture.tables.coverage.find((row) => row.reportKind === truncated), oldCoverage);
  assert.equal((await metrics.getStoredGscRange("site"))?.endDate, "2026-09-13");
  assert.equal((await getGscDataHealth("site")).state, "partial");
  assert.equal((await getStrikingDistance("site")).length, truncated === "query" ? 0 : 1);
  assert.equal((await getLowCtrOpportunities("site")).length, truncated === "query" ? 0 : 1);
  assert.equal((await getContentDecay("site")).length, truncated === "page" ? 0 : 1);
  assert.equal((await getCannibalization("site")).length, truncated === "queryPage" ? 0 : 1);
});

for (const [name, detect] of [["striking distance", getStrikingDistance], ["low CTR", getLowCtrOpportunities]] as const) {
  test(`${name} consumes its validated range when daily coverage advances before the query read`, async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now });
    const fixture = coverageDatabase(t);
    await service("2026-09-12", { query: [{ ...metric, date: "2026-08-16", query: "validated-boundary" }] }).syncTarget(target, "CLI", "backfill");
    const findCoverage = db.gscReportCoverage.findFirst.bind(db.gscReportCoverage);
    let dailyLookups = 0;
    intercept(t, db.gscReportCoverage, "findFirst", async (input: { where: { reportKind: string } }) => {
      const coverage = await findCoverage(input);
      if (input.where.reportKind !== "dailyTotal") return coverage;
      dailyLookups++;
      const snapshot = coverage ? { ...coverage } : null;
      // Another sync commits newer daily totals while the query report stays complete only through September 12.
      fixture.tables.coverage.find((row) => row.reportKind === "dailyTotal")!.endDate = new Date("2026-09-13");
      return snapshot;
    });
    const findQueries = db.gscQueryDaily.findMany.bind(db.gscQueryDaily);
    const consumed: unknown[] = [];
    intercept(t, db.gscQueryDaily, "findMany", async (input: { where: { date: { gte: Date; lte: Date } } }) => {
      consumed.push(input.where.date);
      return findQueries(input);
    });
    const results = await detect("site");
    assert.deepEqual(consumed, [{ gte: new Date("2026-08-16"), lte: new Date("2026-09-12") }]);
    assert.deepEqual(results.map((row) => row.query), ["validated-boundary"]);
    assert.equal(dailyLookups, 1);
    assert.deepEqual(await metrics.getStoredGscRange("site", 28), { startDate: "2026-08-17", endDate: "2026-09-13" });
  });
}

test("rollback retains legacy opportunities without V2 completeness records", async (t) => {
  coverageDatabase(t);
  process.env.GSC_READ_MODEL_V2 = "false";
  intercept(t, db.keyword, "findFirst", async () => ({ date: new Date("2026-09-13") }));
  intercept(t, db.keyword, "findMany", async () => [
    { ...metric, siteId: "site", date: new Date(metric.date), query: "shoe", page: "/a" },
    { ...metric, siteId: "site", date: new Date(metric.date), query: "shoe", page: "/b" },
  ]);
  intercept(t, db.page, "findMany", async ({ where }: { where: { date: { lte: Date } } }) => where.date.lte < new Date("2026-08-17")
    ? [{ ...metric, siteId: "site", date: new Date("2026-08-01"), clicks: 100, url: "/decay" }] : []);
  assert.equal((await getStrikingDistance("site")).length, 1);
  assert.equal((await getLowCtrOpportunities("site")).length, 1);
  assert.equal((await getContentDecay("site")).length, 1);
  assert.equal((await getCannibalization("site")).length, 1);
});

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode), ...elements(node.props.actions as ReactNode)];
}

for (const pageName of ["keywords", "pages"]) test(`${pageName} listing passes actual partial health to DataLagBadge`, async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  coverageDatabase(t);
  await service("2026-09-12").syncTarget(target, "CLI", "backfill");
  await service("2026-09-13", {}, pageName === "keywords" ? "query" : "page").syncTarget(target, "SCHEDULED");
  const require = createRequire(import.meta.url);
  const authPath = require.resolve("../lib/auth");
  const original = require.cache[authPath];
  require.cache[authPath] = { exports: { auth: async () => ({ user: { id: "owner" } }) } } as NodeModule;
  t.after(() => { if (original) require.cache[authPath] = original; else delete require.cache[authPath]; });
  const Page = require(`../app/(dashboard)/sites/[siteId]/${pageName}/page`).default;
  const { DataLagBadge } = require("../components/ui/data-lag-badge");
  const tree = elements(await Page({ params: Promise.resolve({ siteId: "site" }) }));
  const health = tree.find((element) => element.type === DataLagBadge)?.props.health as { state: string; endDate: string; warnings: unknown[] } | undefined;
  assert.equal(health?.state, "partial");
  assert.equal(health?.endDate, "2026-09-13");
  assert.ok(health?.warnings.length);
});
