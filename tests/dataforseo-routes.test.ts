import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createRequire } from "node:module";
import { db } from "../lib/db";

const require = createRequire(import.meta.url);
const authPath = require.resolve("../lib/auth");
require.cache[authPath] = { exports: { auth: async () => ({ user: { id: "owner" } }) } } as NodeModule;
const backlinksRoute = require("../app/api/sites/[siteId]/backlinks/route") as typeof import("../app/api/sites/[siteId]/backlinks/route");
const params = { params: Promise.resolve({ siteId: "strum" }) };

function intercept(t: TestContext, target: object, method: string, fn: (...args: never[]) => unknown) {
  const original = Object.getOwnPropertyDescriptor(target, method);
  Object.defineProperty(target, method, { configurable: true, value: fn });
  t.after(() => { if (original) Object.defineProperty(target, method, original); else Reflect.deleteProperty(target, method); });
}

test("GET backlinks never treats outbound crawl links as inbound backlinks", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ domain: "strum.capital" }));
  intercept(t, db.crawl, "findFirst", async () => { throw new Error("crawl is not an inbound backlink source"); });
  intercept(t, globalThis, "fetch", async () => { throw new Error("GET must not contact DataForSEO"); });
  const response = await backlinksRoute.GET(new Request("https://example.com/api/sites/strum/backlinks"), params);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { source: "none", overview: null, backlinks: [] });
});

test("POST backlinks requires explicit confirmation before any provider call", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ domain: "strum.capital" }));
  intercept(t, globalThis, "fetch", async () => { throw new Error("provider called without confirmation"); });
  const response = await backlinksRoute.POST(new Request("https://example.com/api/sites/strum/backlinks", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: 50 }),
  }), params);
  assert.equal(response.status, 400);
});
