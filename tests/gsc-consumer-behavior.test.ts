import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createRequire } from "node:module";
import { db } from "../lib/db";
import { getCannibalization, getContentDecay } from "../lib/seo-opportunities";
import { isValidElement, type ReactNode, type ReactElement } from "react";
import { evaluateAlertsForUser } from "../lib/alerts/evaluate";

const require = createRequire(import.meta.url);
// Authentication and provider calls are external boundaries; exercise real routes/readers.
const authPath = require.resolve("../lib/auth");
require.cache[authPath] = { exports: { auth: async () => ({ user: { id: "owner" } }) } } as NodeModule;
const providerPath = require.resolve("../lib/dataforseo/client");
require.cache[providerPath] = { exports: { domainOverview: async () => null, backlinksOverview: async () => null } } as NodeModule;
const historyRoute = require("../app/api/sites/[siteId]/rank-history/route") as typeof import("../app/api/sites/[siteId]/rank-history/route");
const savedRoute = require("../app/api/sites/[siteId]/saved-keywords/route") as typeof import("../app/api/sites/[siteId]/saved-keywords/route");
const overviewRoute = require("../app/api/sites/[siteId]/domain-overview/route") as typeof import("../app/api/sites/[siteId]/domain-overview/route");
const siteRoute = require("../app/api/sites/[siteId]/route") as typeof import("../app/api/sites/[siteId]/route");
const sitesRoute = require("../app/api/sites/route") as typeof import("../app/api/sites/route");
const dashboard = require("../app/(dashboard)/dashboard/page").default as typeof import("../app/(dashboard)/dashboard/page").default;
const savedPage = require("../app/(dashboard)/sites/[siteId]/saved-keywords/page").default as typeof import("../app/(dashboard)/sites/[siteId]/saved-keywords/page").default;
const opportunitiesPage = require("../app/(dashboard)/sites/[siteId]/opportunities/page").default as typeof import("../app/(dashboard)/sites/[siteId]/opportunities/page").default;

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

function intercept(t: TestContext, target: object, method: string, fn: (...args: never[]) => unknown) {
  const original = Object.getOwnPropertyDescriptor(target, method);
  Object.defineProperty(target, method, { configurable: true, value: fn });
  t.after(() => { if (original) Object.defineProperty(target, method, original); else Reflect.deleteProperty(target, method); });
}
const date = new Date("2026-09-12");
const row = { siteId: "site-a", searchType: "web", date, clicks: 10, impressions: 100, ctr: 0.1, position: 4 };
const params = { params: Promise.resolve({ siteId: "site-a" }) };
const request = new Request("https://example.com/api?query=shoe&days=28");

function setup(t: TestContext) {
  const flag = process.env.GSC_READ_MODEL_V2;
  delete process.env.GSC_READ_MODEL_V2;
  t.after(() => { if (flag === undefined) delete process.env.GSC_READ_MODEL_V2; else process.env.GSC_READ_MODEL_V2 = flag; });
  intercept(t, db.site, "findUnique", async () => ({ id: "site-a", userId: "owner", domain: "example.com", gscDataVersion: 2, gscSearchType: "web", gscProperty: "sc-domain:example.com", gscLegacyProperty: "sc-domain:example.com", _count: { keywords: 700, pages: 800, crawls: 3, vitals: 4 } }));
  intercept(t, db.gscDailyTotal, "findFirst", async () => ({ date }));
  intercept(t, db.gscSyncRun, "findFirst", async () => null);
  intercept(t, db.gscDailyTotal, "aggregate", async () => ({ _min: { date: null }, _max: { date: null } }));
  // Deliberately stale legacy fixtures expose consumers bypassing version selection.
  intercept(t, db.keyword, "findMany", async () => []);
  intercept(t, db.keyword, "findFirst", async () => null);
  intercept(t, db.keyword, "groupBy", async () => []);
  intercept(t, db.page, "findMany", async () => []);
}

test("decay uses adjacent periods ending at the latest stored property date", async (t) => {
  setup(t);
  intercept(t, db.gscPageDaily, "findMany", async (input: { where: { siteId: string; searchType: string; date: { gte: Date; lte: Date } } }) => {
    assert.equal(input.where.siteId, "site-a");
    assert.equal(input.where.searchType, "web");
    const current = input.where.date.lte.toISOString().slice(0, 10) === "2026-09-12";
    assert.deepEqual(input.where.date, current
      ? { gte: new Date("2026-08-16"), lte: date }
      : { gte: new Date("2026-07-19"), lte: new Date("2026-08-15") });
    return [{ ...row, date: current ? date : new Date("2026-08-15"), url: "/decay", clicks: current ? 15 : 60 }];
  });
  assert.deepEqual(await getContentDecay("site-a"), [{ url: "/decay", currentClicks: 15, previousClicks: 60, changePct: -75 }]);
});

test("cannibalization reads query-page grain and ignores zero-impression position weight", async (t) => {
  setup(t);
  intercept(t, db.gscQueryPageDaily, "findMany", async (input: { where: { siteId: string; searchType: string } }) => {
    assert.equal(input.where.siteId, "site-a"); assert.equal(input.where.searchType, "web");
    return [
      { ...row, query: "shoe", url: "/a", impressions: 30, position: 2 },
      { ...row, query: "shoe", url: "/a", impressions: 10, position: 6 },
      { ...row, query: "shoe", url: "/a", clicks: 0, impressions: 0, position: 999 },
      { ...row, query: "shoe", url: "/b", clicks: 0, impressions: 0, position: 999 },
    ];
  });
  assert.deepEqual(await getCannibalization("site-a"), [{ query: "shoe", pages: [
    { url: "/a", clicks: 20, impressions: 40, position: 3 },
    { url: "/b", clicks: 0, impressions: 0, position: null },
  ] }]);
});

test("rank history preserves fields, unavailable position, ordering and snapshot precedence", async (t) => {
  setup(t);
  intercept(t, db.gscQueryDaily, "findMany", async () => [
    { ...row, query: "shoe" },
    { ...row, query: "shoe", date: new Date("2026-09-11"), impressions: 0, clicks: 0 },
    { ...row, query: "shoe", date: new Date("2026-09-11"), impressions: 0, clicks: 0 },
    { ...row, query: "shoe", date: new Date("2026-09-10"), impressions: 0, clicks: 0 },
    { ...row, query: "shoe", date: new Date("2026-09-10"), impressions: 30, position: 2 },
    { ...row, query: "shoe", date: new Date("2026-09-10"), impressions: 10, position: 6 },
  ]);
  intercept(t, db.rankSnapshot, "findMany", async () => [{ date, position: 2, clicks: 7, impressions: 70 }]);
  const response = await historyRoute.GET(request, params);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [
    { date: "2026-09-10", position: 3, clicks: 20, impressions: 40 },
    { date: "2026-09-11", position: null, clicks: 0, impressions: 0 },
    { date: "2026-09-12", position: 2, clicks: 7, impressions: 70 },
  ]);
});

test("saved keyword API retains latestRank shape and nulls with a V2 leading page", async (t) => {
  setup(t);
  intercept(t, db.savedKeyword, "findMany", async () => [{ id: "saved", query: "shoe", notes: null, createdAt: date }]);
  intercept(t, db.gscQueryDaily, "findFirst", async () => ({ ...row, query: "shoe", clicks: 0, impressions: 0 }));
  intercept(t, db.gscQueryPageDaily, "findFirst", async () => ({ url: "/shoe" }));
  const response = await savedRoute.GET(request, params);
  assert.deepEqual(await response.json(), [{ id: "saved", query: "shoe", notes: null, createdAt: date.toISOString(), latestRank: {
    clicks: 0, impressions: 0, ctr: null, position: null, page: "/shoe", date: date.toISOString(),
  } }]);
});

test("GSC overview uses property traffic and the canonical unique query count", async (t) => {
  setup(t);
  intercept(t, db.gscDailyTotal, "findMany", async () => [row]);
  intercept(t, db.gscQueryDaily, "findMany", async () => [{ ...row, query: "shoe", clicks: 999 }, { ...row, query: "boot", clicks: 888 }]);
  const response = await overviewRoute.GET(request, params);
  const body = await response.json();
  assert.equal(body.source, "gsc");
  assert.deepEqual(body.overview, { organicKeywords: 2, organicTraffic: 10, organicCost: null, backlinks: null, referringDomains: null });
});

test("site detail and list preserve count field names while selecting V2 stored counts", async (t) => {
  setup(t);
  intercept(t, db.site, "findMany", async () => [{ id: "site-a", _count: { keywords: 700, crawls: 3 } }]);
  intercept(t, db.gscQueryDaily, "count", async (input: unknown) => { assert.deepEqual(input, { where: { siteId: "site-a", property: "sc-domain:example.com", searchType: "web", syncRun: { property: "sc-domain:example.com" } } }); return 12; });
  intercept(t, db.gscPageDaily, "count", async () => 13);
  const detail = await (await siteRoute.GET(request, params)).json();
  assert.equal("userId" in detail, false);
  assert.deepEqual(detail._count, { keywords: 12, pages: 13, crawls: 3, vitals: 4 });
  const list = await (await sitesRoute.GET()).json();
  assert.deepEqual(list[0]._count, { keywords: 12, crawls: 3 });
});

test("dashboard readiness follows canonical property dates even with no legacy keyword rows", async (t) => {
  setup(t);
  intercept(t, db.site, "findMany", async () => [{ id: "site-a", domain: "example.com", gscProperty: "sc-domain:example.com", _count: { keywords: 0, crawls: 0 } }]);
  intercept(t, db.gscDailyTotal, "findMany", async () => [row]);
  intercept(t, db.gscQueryDaily, "findMany", async () => []);
  const tree = elements(await dashboard());
  const checklist = tree.find((element) => "hasSyncedData" in element.props);
  assert.equal(checklist?.props.hasSyncedData, true);
});

test("saved keyword page uses weighted V2 query metrics and preserves unavailable CTR", async (t) => {
  setup(t);
  intercept(t, db.savedKeyword, "findMany", async () => [{ id: "saved", query: "shoe", notes: null }, { id: "empty", query: "empty", notes: null }]);
  let reads = 0;
  intercept(t, db.gscQueryDaily, "findMany", async (input: { where: { query: unknown } }) => {
    reads++;
    assert.deepEqual(input.where.query, { in: ["shoe", "empty"] });
    return [{ ...row, query: "shoe", position: 2 }, { ...row, query: "shoe", impressions: 300, position: 6 }, { ...row, query: "empty", clicks: 0, impressions: 0 }];
  });
  const tree = elements(await savedPage(params));
  assert.deepEqual(tree.filter((e) => "position" in e.props).map((e) => e.props.position), [5, null]);
  assert.deepEqual(tree.filter((e) => "ctr" in e.props).map((e) => e.props.ctr), [0.05, null]);
  assert.equal(reads, 1);
});

test("opportunities onboarding uses property readiness when legacy rows are absent", async (t) => {
  setup(t);
  intercept(t, db.site, "findUnique", async () => ({ userId: "owner", domain: "example.com", gscDataVersion: 2, gscSearchType: "web", gscProperty: "sc-domain:example.com", gscLegacyProperty: "sc-domain:example.com", _count: { keywords: 0 } }));
  intercept(t, db.gscQueryDaily, "findMany", async () => []);
  intercept(t, db.gscPageDaily, "findMany", async () => []);
  intercept(t, db.gscQueryPageDaily, "findMany", async () => []);
  const tree = elements(await opportunitiesPage(params));
  assert.equal(tree.some((e) => e.props.title === "Sync GSC first"), false);
});

test("traffic alerts require an available comparison metric even with a permissive threshold", async (t) => {
  setup(t);
  intercept(t, db.alert, "findMany", async () => [{ id: "alert", siteId: "site-a", type: "TRAFFIC_DROP", config: { thresholdPct: 200 }, site: { id: "site-a", domain: "example.com" } }]);
  intercept(t, db.alert, "update", async () => ({}));
  intercept(t, db.gscDailyTotal, "findMany", async (input: { where: { date: { lte: Date } } }) => input.where.date.lte.getTime() === date.getTime() ? [row] : []);
  intercept(t, db.gscQueryDaily, "findMany", async () => []);
  intercept(t, db.gscPageDaily, "findMany", async () => []);
  assert.deepEqual(await evaluateAlertsForUser("owner"), []);
});
