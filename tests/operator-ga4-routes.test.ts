import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createRequire } from "node:module";
import { db } from "../lib/db";

const require = createRequire(import.meta.url);
const authPath = require.resolve("../lib/auth");
require.cache[authPath] = { exports: { auth: async () => ({ user: { id: "owner" } }) } } as NodeModule;
const connect = require("../app/api/sites/[siteId]/ga4/connect/route") as typeof import("../app/api/sites/[siteId]/ga4/connect/route");
const sync = require("../app/api/sites/[siteId]/ga4/sync/route") as typeof import("../app/api/sites/[siteId]/ga4/sync/route");

function intercept(t: TestContext, target: object, method: string, fn: (...args: never[]) => unknown) {
  const original = Object.getOwnPropertyDescriptor(target, method);
  Object.defineProperty(target, method, { configurable: true, value: fn });
  t.after(() => { if (original) Object.defineProperty(target, method, original); else Reflect.deleteProperty(target, method); });
}

test("GA4 connection rejects foreign site before Google calls", async (t) => {
  intercept(t, db.site, "findFirst", async () => null);
  intercept(t, globalThis, "fetch", async () => { throw new Error("foreign property requested"); });
  const response = await connect.POST(new Request("https://seo.example/api/sites/foreign/ga4/connect", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ propertyId: "123456789" }) }),
    { params: Promise.resolve({ siteId: "foreign" }) });
  assert.equal(response.status, 404);
});

test("GA4 sync requires a connected property and does not replace data otherwise", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ ga4PropertyId: null }));
  intercept(t, db.aiReferralDaily, "deleteMany", async () => { throw new Error("existing data erased"); });
  const response = await sync.POST(new Request("https://seo.example/api/sites/site-1/ga4/sync", { method: "POST" }),
    { params: Promise.resolve({ siteId: "site-1" }) });
  assert.equal(response.status, 409);
});
