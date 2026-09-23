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
const briefEditRoute = require("../app/api/sites/[siteId]/briefs/[briefId]/route") as typeof import("../app/api/sites/[siteId]/briefs/[briefId]/route");
const briefSerpRoute = require("../app/api/sites/[siteId]/brief-serp/route") as typeof import("../app/api/sites/[siteId]/brief-serp/route");

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
  intercept(t, db.dataForSeoRun, "findFirst", async () => null);
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

test("brief snapshots only a live SERP observation matching the target market", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ id: "site-1", domain: "strum.capital", gscProperty: null }));
  intercept(t, db.keywordTarget, "findFirst", async () => ({ id: "target-1", query: "трекер овдп", country: "UA", language: "uk",
    decision: "CREATE_PAGE", pageId: null, page: null }));
  intercept(t, db.dataForSeoRun, "findMany", async () => []);
  intercept(t, db.dataForSeoRun, "findFirst", async ({ where }: { where: Record<string, unknown> }) => {
    assert.equal(where.mode, "LIVE");
    assert.equal(where.siteId, "site-1");
    return { response: { tasks: [{ result: [{ datetime: "2026-09-23 10:00:00 +00:00", location_code: 2804, language_code: "uk",
      items: [{ type: "organic", url: "https://example.ua/ovdp", title: "Guide" },
        { type: "related_searches", items: ["облік овдп"] }] }] }] } };
  });
  intercept(t, db.contentBrief, "create", async ({ data }: { data: { content: { serpStatus: string;
    serpEvidence: { relatedSearches: string[]; locationCode: number } } } }) => {
    assert.equal(data.content.serpStatus, "OBSERVED");
    assert.deepEqual(data.content.serpEvidence.relatedSearches, ["облік овдп"]);
    assert.equal(data.content.serpEvidence.locationCode, 2804);
    return { id: "brief-1" };
  });
  intercept(t, globalThis, "fetch", async () => { throw new Error("brief creation made a paid request"); });
  const response = await briefsRoute.POST(new Request("https://seo.example/api/sites/site-1/briefs", { method: "POST",
    body: JSON.stringify({ targetId: "target-1" }) }), { params: Promise.resolve({ siteId: "site-1" }) });
  assert.equal(response.status, 201);
});

test("brief plan edit rejects an ID belonging to another site", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ id: "site-1" }));
  intercept(t, db.contentBrief, "findFirst", async ({ where }: { where: Record<string, unknown> }) => {
    assert.deepEqual(where, { id: "foreign-brief", siteId: "site-1" });
    return null;
  });
  intercept(t, db.contentBrief, "update", async () => { throw new Error("foreign brief was edited"); });
  const response = await briefEditRoute.PATCH(new Request("https://seo.example/api/sites/site-1/briefs/foreign-brief", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: {}, status: "READY" }),
  }), { params: Promise.resolve({ siteId: "site-1", briefId: "foreign-brief" }) });
  assert.equal(response.status, 404);
});

test("SERP research refuses a foreign keyword target without a provider call", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ domain: "strum.capital" }));
  intercept(t, db.keywordTarget, "findFirst", async ({ where }: { where: Record<string, unknown> }) => {
    assert.deepEqual(where, { id: "foreign-target", siteId: "site-1" });
    return null;
  });
  intercept(t, globalThis, "fetch", async () => { throw new Error("foreign research contacted provider"); });
  const response = await briefSerpRoute.POST(new Request("https://seo.example/api/sites/site-1/brief-serp", { method: "POST",
    body: JSON.stringify({ targetId: "foreign-target", confirm: true, maxUsd: 1 }) }), { params: Promise.resolve({ siteId: "site-1" }) });
  assert.equal(response.status, 404);
});

test("SERP preview reports cost without using the provider or credentials", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ domain: "strum.capital" }));
  intercept(t, db.keywordTarget, "findFirst", async () => ({ query: "трекер овдп", country: "UA", language: "uk" }));
  intercept(t, db.dataForSeoSettings, "upsert", async () => ({ mode: "LIVE", locationCode: 2804, languageCode: "uk",
    spentUsd: 0, reservedUsd: 0 }));
  intercept(t, db.dataForSeoRun, "findMany", async () => []);
  intercept(t, db.apiKey, "findUnique", async () => { throw new Error("preview looked up paid credentials"); });
  intercept(t, globalThis, "fetch", async () => { throw new Error("preview contacted provider"); });
  const response = await briefSerpRoute.POST(new Request("https://seo.example/api/sites/site-1/brief-serp", { method: "POST",
    body: JSON.stringify({ targetId: "target-1" }) }), { params: Promise.resolve({ siteId: "site-1" }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).estimatedUsd, 0.002);
});

test("SERP research blocks mismatched keyword and provider markets before a paid call", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ domain: "strum.capital" }));
  intercept(t, db.keywordTarget, "findFirst", async () => ({ query: "трекер овдп", country: "US", language: "en" }));
  intercept(t, db.dataForSeoSettings, "upsert", async () => ({ mode: "LIVE", locationCode: 2804, languageCode: "uk" }));
  intercept(t, globalThis, "fetch", async () => { throw new Error("mismatched research contacted provider"); });
  const response = await briefSerpRoute.POST(new Request("https://seo.example/api/sites/site-1/brief-serp", { method: "POST",
    body: JSON.stringify({ targetId: "target-1", confirm: true, maxUsd: 1 }) }), { params: Promise.resolve({ siteId: "site-1" }) });
  assert.equal(response.status, 409);
});
