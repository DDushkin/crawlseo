import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createRequire } from "node:module";
import { db } from "../lib/db";

const require = createRequire(import.meta.url);
const authPath = require.resolve("../lib/auth");
require.cache[authPath] = { exports: { auth: async () => ({ user: { id: "owner" } }) } } as NodeModule;
const manual = require("../app/api/sites/[siteId]/actions/detect/route") as typeof import("../app/api/sites/[siteId]/actions/detect/route");
const cron = require("../app/api/cron/seo-actions/route") as typeof import("../app/api/cron/seo-actions/route");

function intercept(t: TestContext, target: object, method: string, fn: (...args: never[]) => unknown) {
  const original = Object.getOwnPropertyDescriptor(target, method);
  Object.defineProperty(target, method, { configurable: true, value: fn });
  t.after(() => { if (original) Object.defineProperty(target, method, original); else Reflect.deleteProperty(target, method); });
}

test("foreign site cannot trigger action detection or paid calls", async (t) => {
  intercept(t, db.site, "findFirst", async () => null);
  intercept(t, globalThis, "fetch", async () => { throw new Error("foreign site sent a request"); });
  const response = await manual.POST(new Request("https://seo.example/api/sites/foreign/actions/detect", { method: "POST" }),
    { params: Promise.resolve({ siteId: "foreign" }) });
  assert.equal(response.status, 404);
});

test("action scheduler refuses missing secret before listing sites", async (t) => {
  intercept(t, db.site, "findMany", async () => { throw new Error("unauthorized site list"); });
  const response = await cron.POST(new Request("https://seo.example/api/cron/seo-actions", { method: "POST" }));
  assert.equal(response.status, 401);
});

test("action scheduler records each site failure independently", async (t) => {
  const prior = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "local-secret";
  t.after(() => { if (prior === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prior; });
  intercept(t, db.site, "findMany", async () => [{ id: "first" }, { id: "second" }]);
  intercept(t, db.site, "findUnique", async () => { throw new Error("temporary GSC database error"); });
  const response = await cron.POST(new Request("https://seo.example/api/cron/seo-actions", { method: "POST",
    headers: { authorization: "Bearer local-secret" } }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).results.map((item: { state: string }) => item.state), ["FAILED", "FAILED"]);
});
