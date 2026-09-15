import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { db } from "../lib/db";
import * as readers from "../lib/gsc/read-model";
import { formatCtr, formatPosition, getSitePeriodMetrics, getTopKeywords, getTopPages, getDailyTraffic } from "../lib/seo-metrics";
import { exportKeywordsCsv, exportPagesCsv, getLowCtrOpportunities, getStrikingDistance } from "../lib/seo-opportunities";
import { formatSiteOverview } from "../mcp/formatters";
import * as keywordTable from "../components/sites/keywords-table";
import { aggregatePageRows, aggregatePeriodRows, aggregateQueryRows, shouldUseGscV2, storedRangeEnding } from "../lib/gsc/read-model";

const scope = { siteId: "site-a", searchType: "web", range: { startDate: "2026-09-11", endDate: "2026-09-12" } };
const row = { siteId: "site-a", searchType: "web", date: new Date("2026-09-12"), clicks: 10, impressions: 100, position: 2 };

test("uses V2 only for migrated sites unless globally disabled", () => {
  assert.equal(shouldUseGscV2(2, undefined), true);
  assert.equal(shouldUseGscV2(2, "true"), true);
  assert.equal(shouldUseGscV2(2, "false"), false);
  assert.equal(shouldUseGscV2(1, "true"), false);
  assert.equal(shouldUseGscV2(3, undefined), false);
});

test("anchors periods to the latest stored finalized date", () => {
  assert.deepEqual(storedRangeEnding("2026-09-12", 28), { startDate: "2026-08-16", endDate: "2026-09-12" });
  assert.throws(() => storedRangeEnding("2026-09-12", 0));
});

test("query aggregation weights duplicate dates and excludes other sites, types, and ranges", () => {
  const rows = [
    { ...row, query: "shoe" },
    { ...row, query: "shoe", date: new Date("2026-09-11"), clicks: 20, impressions: 300, position: 6 },
    { ...row, query: "shoe", impressions: 0, clicks: 0, position: 999 },
    { ...row, query: "shoe", siteId: "site-b", clicks: 999 },
    { ...row, query: "shoe", searchType: "image", clicks: 999 },
    { ...row, query: "shoe", date: new Date("2026-09-10"), clicks: 999 },
    { ...row, query: "empty", clicks: 0, impressions: 0 },
  ];
  assert.deepEqual(aggregateQueryRows(rows, scope), [
    { query: "shoe", clicks: 30, impressions: 400, ctr: 0.075, position: 5 },
    { query: "empty", clicks: 0, impressions: 0, ctr: null, position: null },
  ]);
  assert.equal(aggregateQueryRows(rows, { ...scope, siteId: "site-b" })[0].clicks, 999);
});

test("page aggregation uses summed CTR and impression weights, including unavailable metrics", () => {
  assert.deepEqual(aggregatePageRows([
    { ...row, url: "/a" },
    { ...row, url: "/a", clicks: 0, impressions: 100, position: 4 },
    { ...row, url: "/a", siteId: "site-b", clicks: 999 },
    { ...row, url: "/empty", clicks: 0, impressions: 0 },
  ], scope), [
    { url: "/a", clicks: 10, impressions: 200, ctr: 0.05, position: 3 },
    { url: "/empty", clicks: 0, impressions: 0, ctr: null, position: null },
  ]);
});

test("property metrics use only property totals and distinct scoped query names", () => {
  const input = {
    totals: [row, { ...row, siteId: "site-b", clicks: 999 }],
    queries: [{ ...row, query: "shoe", clicks: 999 }, { ...row, query: "shoe" }, { ...row, query: "foreign", siteId: "site-b" }],
    queryPages: [{ ...row, query: "shoe", url: "/a", clicks: 10000 }],
  };
  assert.deepEqual(aggregatePeriodRows(input, scope), {
    clicks: 10, impressions: 100, avgCtr: 0.1, avgPosition: 2, uniqueKeywords: 1,
    startDate: "2026-09-11", endDate: "2026-09-12",
  });
  assert.deepEqual(aggregatePeriodRows({ totals: [], queries: [] }, scope), {
    clicks: 0, impressions: 0, avgCtr: null, avgPosition: null, uniqueKeywords: 0,
    startDate: "2026-09-11", endDate: "2026-09-12",
  });
});

function intercept(context: TestContext, target: object, method: string, implementation: (...args: never[]) => unknown) {
  const original = Object.getOwnPropertyDescriptor(target, method);
  Object.defineProperty(target, method, { configurable: true, value: implementation });
  context.after(() => { if (original) Object.defineProperty(target, method, original); else Reflect.deleteProperty(target, method); });
}

function siteVersion(context: TestContext, version: number, flag?: string) {
  const original = process.env.GSC_READ_MODEL_V2;
  if (flag === undefined) delete process.env.GSC_READ_MODEL_V2;
  else process.env.GSC_READ_MODEL_V2 = flag;
  context.after(() => { if (original === undefined) delete process.env.GSC_READ_MODEL_V2; else process.env.GSC_READ_MODEL_V2 = original; });
  intercept(context, db.site, "findUnique", async (input: unknown) => {
    assert.deepEqual(input, { where: { id: "site-a" }, select: { gscDataVersion: true, gscSearchType: true } });
    return { gscDataVersion: version, gscSearchType: "web" };
  });
}

test("facade selects canonical property totals with adjacent stored periods", async (context) => {
  siteVersion(context, 2);
  intercept(context, db.gscDailyTotal, "findFirst", async (input: unknown) => {
    assert.deepEqual(input, { where: { siteId: "site-a", searchType: "web" }, orderBy: { date: "desc" }, select: { date: true } });
    return { date: row.date };
  });
  const ranges: unknown[] = [];
  intercept(context, db.gscDailyTotal, "findMany", async (input: { where: { date: { gte: Date; lte: Date }; siteId: string; searchType: string } }) => {
    assert.equal(input.where.siteId, "site-a"); assert.equal(input.where.searchType, "web");
    ranges.push(input.where.date);
    return input.where.date.lte.toISOString().startsWith("2026-09-12") ? [row] : [{ ...row, date: new Date("2026-09-10"), clicks: 5, position: 4 }];
  });
  intercept(context, db.gscQueryDaily, "findMany", async () => [{ ...row, query: "shoe", clicks: 999 }]);
  intercept(context, db.keyword, "findMany", async () => { throw new Error("Legacy metrics must not be read"); });
  const result = await getSitePeriodMetrics("site-a", 2);
  assert.equal(result.current.clicks, 10);
  assert.equal(result.previous.clicks, 5);
  assert.equal(result.deltas.avgPosition, 2);
  assert.equal(result.current.startDate, "2026-09-11");
  assert.equal(result.previous.endDate, "2026-09-10");
  assert.deepEqual(ranges, [
    { gte: new Date("2026-09-11"), lte: new Date("2026-09-12") },
    { gte: new Date("2026-09-09"), lte: new Date("2026-09-10") },
  ]);
});

for (const [version, flag] of [[1, "true"], [2, "false"]] as const) {
  test(`facade uses legacy data for version ${version}, flag ${flag}`, async (context) => {
    siteVersion(context, version, flag);
    intercept(context, db.keyword, "findMany", async () => [{ ...row, query: "legacy" }]);
    intercept(context, db.page, "findMany", async () => [{ ...row, url: "/legacy" }]);
    intercept(context, db.gscDailyTotal, "findFirst", async () => { throw new Error("V2 must not be read"); });
    assert.equal((await getSitePeriodMetrics("site-a")).current.clicks, 10);
    assert.equal((await getTopKeywords("site-a"))[0].query, "legacy");
    assert.equal((await getTopPages("site-a"))[0].url, "/legacy");
    assert.equal((await getDailyTraffic("site-a"))[0].clicks, 10);
  });
}

test("no canonical property totals means no usable data or stored range", async (context) => {
  siteVersion(context, 2);
  intercept(context, db.gscDailyTotal, "findFirst", async () => null);
  assert.equal(await readers.getStoredGscRange("site-a", 28), null);
  assert.equal(await readers.hasGscData("site-a"), false);
  const metrics = await getSitePeriodMetrics("site-a");
  assert.equal(metrics.current.startDate, null);
  assert.equal(metrics.current.avgPosition, null);
  assert.equal(metrics.deltas.avgCtr, null);
  assert.deepEqual(await getTopKeywords("site-a"), []);
});

test("query details use scoped ranges and same-day leading pages, saved rows use one batch", async (context) => {
  siteVersion(context, 2);
  let queryCalls = 0;
  intercept(context, db.gscQueryDaily, "findMany", async (input: { where: { siteId: string; searchType: string; date: unknown; query: unknown } }) => {
    queryCalls += 1;
    assert.equal(input.where.siteId, "site-a"); assert.equal(input.where.searchType, "web");
    assert.deepEqual(input.where.date, { gte: new Date("2026-09-11"), lte: new Date("2026-09-12") });
    return [{ ...row, query: "shoe" }];
  });
  intercept(context, db.gscQueryDaily, "findFirst", async () => ({ ...row, query: "shoe" }));
  intercept(context, db.gscQueryPageDaily, "findFirst", async (input: { where: unknown; orderBy: unknown }) => {
    assert.deepEqual(input.where, { siteId: "site-a", searchType: "web", query: "shoe", date: row.date });
    assert.deepEqual(input.orderBy, [{ clicks: "desc" }, { impressions: "desc" }, { url: "asc" }]);
    return { url: "/leading" };
  });
  assert.equal((await readers.getGscQueryHistory("site-a", "shoe", scope.range))[0].position, 2);
  assert.equal((await readers.getGscLatestQueryMetric("site-a", "shoe", scope.range))?.page, "/leading");
  const saved = await readers.getGscSavedQueryMetrics("site-a", ["shoe", "missing"], scope.range);
  assert.equal(saved.get("shoe")?.clicks, 10);
  assert.equal(saved.has("missing"), false);
  assert.equal(queryCalls, 2);
});

test("formatters distinguish unavailable rates from genuine zero CTR", () => {
  assert.equal(formatPosition(null), "—");
  assert.equal(formatCtr(null), "—");
  assert.equal(formatCtr(0), "0.00%");
});

test("MCP overview omits unavailable deltas and preserves zero CTR", () => {
  const metrics = { current: { clicks: 0, impressions: 0, avgPosition: null, avgCtr: null, uniqueKeywords: 0 }, deltas: { clicks: 0, impressions: 0, avgPosition: null, avgCtr: null } };
  const output = formatSiteOverview({ id: "site-a", domain: "example.com", metrics });
  assert.match(output, /Avg Position: —\n/);
  assert.match(output, /Avg CTR:     —\n/);
  assert.doesNotMatch(output, /null|NaN/);
});

test("keyword filters exclude unknown positions and metric sorting keeps nulls last", () => {
  assert.equal(keywordTable.matchesPosition(null, "all"), true);
  assert.equal(keywordTable.matchesPosition(null, "top10"), false);
  assert.equal(keywordTable.matchesPosition(null, "20+"), false);
  assert.equal(keywordTable.compareNullableMetric(null, 3, "asc"), 1);
  assert.equal(keywordTable.compareNullableMetric(null, 3, "desc"), 1);
  assert.equal(keywordTable.compareNullableMetric(3, null, "desc"), -1);
  assert.equal(keywordTable.compareNullableMetric(null, null, "asc"), 0);
  assert.ok(keywordTable.compareNullableMetric(2, 3, "asc") < 0);
  assert.ok(keywordTable.compareNullableMetric(2, 3, "desc") > 0);
});

test("opportunity rules skip unavailable metrics and CSV exports use empty cells", async (context) => {
  siteVersion(context, 2);
  intercept(context, db.gscDailyTotal, "findFirst", async () => ({ date: row.date }));
  intercept(context, db.gscQueryDaily, "findMany", async () => [
    { ...row, query: "empty", clicks: 0, impressions: 0 },
    { ...row, query: "valid", clicks: 0, position: 5 },
  ]);
  intercept(context, db.gscPageDaily, "findMany", async () => [{ ...row, url: "/empty", clicks: 0, impressions: 0 }]);
  assert.deepEqual((await getStrikingDistance("site-a")).map((r) => r.query), ["valid"]);
  assert.deepEqual((await getLowCtrOpportunities("site-a")).map((r) => r.query), ["valid"]);
  assert.match(await exportKeywordsCsv("site-a"), /"empty",,0,0,(?:\n|$)/);
  assert.match(await exportPagesCsv("site-a"), /"\/empty",,0,0,$/);
});

test("V2 pages, daily traffic, counts and query-page reports use their own scoped canonical tables", async (context) => {
  siteVersion(context, 2);
  const expectedWhere = { siteId: "site-a", searchType: "web", date: { gte: new Date("2026-09-11"), lte: new Date("2026-09-12") } };
  intercept(context, db.gscDailyTotal, "findFirst", async () => ({ date: row.date }));
  intercept(context, db.gscDailyTotal, "findMany", async (input: { where: unknown; orderBy: unknown }) => {
    assert.deepEqual(input.where, expectedWhere);
    assert.deepEqual(input.orderBy, { date: "asc" });
    return [row];
  });
  intercept(context, db.gscPageDaily, "findMany", async (input: { where: unknown }) => {
    assert.deepEqual(input.where, expectedWhere);
    return [{ ...row, url: "/a", clicks: 999 }];
  });
  intercept(context, db.gscQueryDaily, "findMany", async (input: { where: unknown }) => {
    assert.deepEqual(input.where, { ...expectedWhere, query: undefined });
    return [{ ...row, query: "shoe", clicks: 500 }];
  });
  intercept(context, db.gscQueryPageDaily, "findMany", async (input: { where: unknown }) => {
    assert.deepEqual(input.where, expectedWhere);
    return [{ ...row, query: "shoe", url: "/a", clicks: 10000 }];
  });
  intercept(context, db.gscQueryDaily, "count", async (input: unknown) => { assert.deepEqual(input, { where: expectedWhere }); return 3; });
  intercept(context, db.gscPageDaily, "count", async (input: unknown) => { assert.deepEqual(input, { where: expectedWhere }); return 4; });
  assert.equal((await getTopKeywords("site-a", 2))[0].clicks, 500);
  assert.equal((await getTopPages("site-a", 2))[0].clicks, 999);
  assert.deepEqual(await getDailyTraffic("site-a", 2), [{ date: "2026-09-12", clicks: 10, impressions: 100 }]);
  assert.equal((await readers.getGscPageMetricsForRange("site-a", scope.range))[0].url, "/a");
  assert.equal((await readers.getGscQueryPageRows("site-a", scope.range))[0].clicks, 10000);
  assert.deepEqual(await readers.getGscStoredCounts("site-a", scope.range), { queries: 3, pages: 4 });
});

test("global rollback also selects legacy history, saved metrics, counts, and query-page rows", async (context) => {
  siteVersion(context, 2, "false");
  const expectedWhere = { siteId: "site-a", date: { gte: new Date("2026-09-11"), lte: new Date("2026-09-12T23:59:59.999Z") } };
  intercept(context, db.keyword, "findFirst", async (input: { where: { siteId: string } }) => {
    assert.equal(input.where.siteId, "site-a");
    return { ...row, query: "shoe", page: "/legacy" };
  });
  intercept(context, db.keyword, "findMany", async (input: { where: { siteId: string; date: unknown } }) => {
    assert.equal(input.where.siteId, "site-a");
    assert.deepEqual(input.where.date, expectedWhere.date);
    return [{ ...row, query: "shoe", page: "/legacy" }];
  });
  intercept(context, db.keyword, "count", async (input: unknown) => { assert.deepEqual(input, { where: expectedWhere }); return 8; });
  intercept(context, db.page, "count", async (input: unknown) => { assert.deepEqual(input, { where: expectedWhere }); return 9; });
  assert.equal(await readers.hasGscData("site-a"), true);
  assert.deepEqual(await readers.getStoredGscRange("site-a", 2), scope.range);
  assert.equal((await readers.getGscQueryHistory("site-a", "shoe", scope.range))[0].clicks, 10);
  assert.equal((await readers.getGscLatestQueryMetric("site-a", "shoe", scope.range))?.page, "/legacy");
  assert.equal((await readers.getGscSavedQueryMetrics("site-a", ["shoe"], scope.range)).get("shoe")?.clicks, 10);
  assert.equal((await readers.getGscQueryPageRows("site-a", scope.range))[0].url, "/legacy");
  assert.deepEqual(await readers.getGscStoredCounts("site-a", scope.range), { queries: 8, pages: 9 });
});
