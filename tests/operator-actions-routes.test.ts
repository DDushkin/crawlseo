import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createRequire } from "node:module";
import { db } from "../lib/db";

const require = createRequire(import.meta.url);
const authPath = require.resolve("../lib/auth");
require.cache[authPath] = { exports: { auth: async () => ({ user: { id: "owner" } }) } } as NodeModule;
const listRoute = require("../app/api/sites/[siteId]/actions/route") as typeof import("../app/api/sites/[siteId]/actions/route");
const itemRoute = require("../app/api/sites/[siteId]/actions/[actionId]/route") as typeof import("../app/api/sites/[siteId]/actions/[actionId]/route");

function intercept(t: TestContext, target: object, method: string, fn: (...args: never[]) => unknown) {
  const original = Object.getOwnPropertyDescriptor(target, method);
  Object.defineProperty(target, method, { configurable: true, value: fn });
  t.after(() => { if (original) Object.defineProperty(target, method, original); else Reflect.deleteProperty(target, method); });
}

test("action backlog reads only selected site without provider traffic", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ id: "site-1" }));
  intercept(t, db.seoAction, "findMany", async (args: { where: { siteId: string } }) => {
    assert.equal(args.where.siteId, "site-1");
    return [{ id: "action-1", title: "Refresh OVDP page", status: "NEW", priority: 60 }];
  });
  intercept(t, globalThis, "fetch", async () => { throw new Error("GET must not call providers"); });
  const response = await listRoute.GET(new Request("https://seo.example/api/sites/site-1/actions"), { params: Promise.resolve({ siteId: "site-1" }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).actions[0].id, "action-1");
});

test("foreign site action is not accessible", async (t) => {
  intercept(t, db.site, "findFirst", async () => null);
  const response = await itemRoute.PATCH(new Request("https://seo.example/api/sites/site-2/actions/action-2", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "PLANNED" }),
  }), { params: Promise.resolve({ siteId: "site-2", actionId: "action-2" }) });
  assert.equal(response.status, 404);
});

test("completed action cannot be silently reopened", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ id: "site-1" }));
  intercept(t, db.seoAction, "findFirst", async () => ({ id: "action-1", status: "COMPLETED" }));
  intercept(t, db.seoAction, "update", async () => { throw new Error("invalid transition wrote data"); });
  const response = await itemRoute.PATCH(new Request("https://seo.example/api/sites/site-1/actions/action-1", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "IN_PROGRESS" }),
  }), { params: Promise.resolve({ siteId: "site-1", actionId: "action-1" }) });
  assert.equal(response.status, 409);
});
