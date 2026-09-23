import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createRequire } from "node:module";
import { db } from "../lib/db";

const require = createRequire(import.meta.url);
const authPath = require.resolve("../lib/auth");
require.cache[authPath] = { exports: { auth: async () => ({ user: { id: "owner" } }) } } as NodeModule;
const placements = require("../app/api/sites/[siteId]/placements/route") as typeof import("../app/api/sites/[siteId]/placements/route");
const checks = require("../app/api/sites/[siteId]/placements/[placementId]/check/route") as typeof import("../app/api/sites/[siteId]/placements/[placementId]/check/route");
const crawl = require("../app/api/sites/[siteId]/crawl-comparisons/route") as typeof import("../app/api/sites/[siteId]/crawl-comparisons/route");
const outcome = require("../app/api/sites/[siteId]/placements/[placementId]/outcome/route") as typeof import("../app/api/sites/[siteId]/placements/[placementId]/outcome/route");

function intercept(t: TestContext, target: object, method: string, fn: (...args: never[]) => unknown) {
  const original = Object.getOwnPropertyDescriptor(target, method);
  Object.defineProperty(target, method, { configurable: true, value: fn });
  t.after(() => { if (original) Object.defineProperty(target, method, original); else Reflect.deleteProperty(target, method); });
}

test("foreign site cannot list placement spend or crawl comparisons", async (t) => {
  intercept(t, db.site, "findFirst", async () => null);
  intercept(t, db.placement, "findMany", async () => { throw new Error("foreign spend leaked"); });
  intercept(t, db.crawlComparison, "findMany", async () => { throw new Error("foreign crawl leaked"); });
  assert.equal((await placements.GET(new Request("https://seo.example/api/sites/foreign/placements"), { params: Promise.resolve({ siteId: "foreign" }) })).status, 404);
  assert.equal((await crawl.GET(new Request("https://seo.example/api/sites/foreign/crawl-comparisons"), { params: Promise.resolve({ siteId: "foreign" }) })).status, 404);
});

test("placement check rejects foreign placement before network access", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ domain: "strum.capital" }));
  intercept(t, db.placement, "findFirst", async () => null);
  intercept(t, globalThis, "fetch", async () => { throw new Error("network should not be called"); });
  const response = await checks.POST(new Request("https://seo.example/api/sites/site-1/placements/foreign/check", { method: "POST" }),
    { params: Promise.resolve({ siteId: "site-1", placementId: "foreign" }) });
  assert.equal(response.status, 404);
});

test("placement outcome rejects foreign placement without reading GSC", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ id: "site-1" }));
  intercept(t, db.placement, "findFirst", async () => null);
  intercept(t, db.gscPageDaily, "aggregate", async () => { throw new Error("foreign metrics leaked"); });
  const response = await outcome.GET(new Request("https://seo.example/api/sites/site-1/placements/foreign/outcome"),
    { params: Promise.resolve({ siteId: "site-1", placementId: "foreign" }) });
  assert.equal(response.status, 404);
});
