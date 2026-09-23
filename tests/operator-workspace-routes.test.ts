import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createRequire } from "node:module";
import { db } from "../lib/db";

const require = createRequire(import.meta.url);
const authPath = require.resolve("../lib/auth");
require.cache[authPath] = { exports: { auth: async () => ({ user: { id: "owner" } }) } } as NodeModule;
const pagesRoute = require("../app/api/sites/[siteId]/page-inventory/route") as typeof import("../app/api/sites/[siteId]/page-inventory/route");
const targetsRoute = require("../app/api/sites/[siteId]/keyword-targets/route") as typeof import("../app/api/sites/[siteId]/keyword-targets/route");
const briefsRoute = require("../app/api/sites/[siteId]/briefs/route") as typeof import("../app/api/sites/[siteId]/briefs/route");

function intercept(t: TestContext, target: object, method: string, fn: (...args: never[]) => unknown) {
  const original = Object.getOwnPropertyDescriptor(target, method);
  Object.defineProperty(target, method, { configurable: true, value: fn });
  t.after(() => { if (original) Object.defineProperty(target, method, original); else Reflect.deleteProperty(target, method); });
}

test("page inventory rejects a competitor URL before writing", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ id: "site-1", domain: "strum.capital" }));
  intercept(t, db.sitePage, "upsert", async () => { throw new Error("foreign URL was saved"); });
  const response = await pagesRoute.POST(new Request("https://seo.example/api/sites/site-1/page-inventory", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: "https://competitor.example/page" }),
  }), { params: Promise.resolve({ siteId: "site-1" }) });
  assert.equal(response.status, 400);
});

test("keyword mapping cannot attach a page from another site", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ id: "site-1", domain: "strum.capital" }));
  intercept(t, db.sitePage, "findFirst", async (args: { where: Record<string, unknown> }) => {
    assert.deepEqual(args.where, { id: "foreign-page", siteId: "site-1" });
    return null;
  });
  intercept(t, db.keywordTarget, "upsert", async () => { throw new Error("foreign page was mapped"); });
  const response = await targetsRoute.POST(new Request("https://seo.example/api/sites/site-1/keyword-targets", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "трекер овдп", decision: "OPTIMIZE_EXISTING", pageId: "foreign-page", country: "UA", language: "uk" }),
  }), { params: Promise.resolve({ siteId: "site-1" }) });
  assert.equal(response.status, 404);
});

test("strategic mapping is idempotent for one site's query and market", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ id: "site-1", domain: "strum.capital" }));
  intercept(t, db.sitePage, "findFirst", async () => ({ id: "page-1" }));
  intercept(t, db.keywordTarget, "upsert", async (args: { where: { siteId_query_country_language: Record<string, unknown> } }) => {
    assert.deepEqual(args.where.siteId_query_country_language, { siteId: "site-1", query: "трекер овдп", country: "UA", language: "uk" });
    return { id: "target-1", query: "трекер овдп", pageId: "page-1" };
  });
  const response = await targetsRoute.POST(new Request("https://seo.example/api/sites/site-1/keyword-targets", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "  Трекер ОВДП  ", decision: "OPTIMIZE_EXISTING", pageId: "page-1", country: "UA", language: "uk" }),
  }), { params: Promise.resolve({ siteId: "site-1" }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).target.id, "target-1");
});

test("brief creation rejects a keyword target from another site", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ id: "site-1", domain: "strum.capital", gscProperty: null }));
  intercept(t, db.keywordTarget, "findFirst", async (args: { where: Record<string, unknown> }) => {
    assert.deepEqual(args.where, { id: "foreign-target", siteId: "site-1" });
    return null;
  });
  intercept(t, db.contentBrief, "create", async () => { throw new Error("foreign brief was written"); });
  const response = await briefsRoute.POST(new Request("https://seo.example/api/sites/site-1/briefs", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetId: "foreign-target" }),
  }), { params: Promise.resolve({ siteId: "site-1" }) });
  assert.equal(response.status, 404);
});

test("brief without GSC or competitor data remains useful but clearly marks both unavailable", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ id: "site-1", domain: "strum.capital", gscProperty: null }));
  intercept(t, db.keywordTarget, "findFirst", async () => ({ id: "target-1", query: "трекер овдп", decision: "CREATE_PAGE", pageId: null, page: null }));
  intercept(t, db.dataForSeoRun, "findMany", async () => []);
  intercept(t, db.contentBrief, "create", async (args: { data: { content: { gscEvidence: unknown; competitorStatus: string } } }) => {
    assert.equal(args.data.content.gscEvidence, null);
    assert.equal(args.data.content.competitorStatus, "UNAVAILABLE");
    return { id: "brief-1" };
  });
  intercept(t, globalThis, "fetch", async () => { throw new Error("brief creation made a paid request"); });
  const response = await briefsRoute.POST(new Request("https://seo.example/api/sites/site-1/briefs", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetId: "target-1" }),
  }), { params: Promise.resolve({ siteId: "site-1" }) });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).brief.id, "brief-1");
});
