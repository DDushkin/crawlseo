import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createRequire } from "node:module";
import { db } from "../lib/db";
import { prismaCompletionStore, prismaEvaluationStore } from "../lib/operator/outcome-store";

const require = createRequire(import.meta.url);
const authPath = require.resolve("../lib/auth");
require.cache[authPath] = { exports: { auth: async () => ({ user: { id: "owner" } }) } } as NodeModule;
const completeRoute = require("../app/api/sites/[siteId]/actions/[actionId]/complete/route") as typeof import("../app/api/sites/[siteId]/actions/[actionId]/complete/route");
const outcomesRoute = require("../app/api/sites/[siteId]/outcomes/route") as typeof import("../app/api/sites/[siteId]/outcomes/route");

function intercept(t: TestContext, target: object, method: string, fn: (...args: never[]) => unknown) {
  const original = Object.getOwnPropertyDescriptor(target, method);
  Object.defineProperty(target, method, { configurable: true, value: fn });
  t.after(() => { if (original) Object.defineProperty(target, method, original); else Reflect.deleteProperty(target, method); });
}

test("complete route records a change only for an owned action", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ id: "site-1" }));
  intercept(t, prismaCompletionStore, "findAction", async () => ({ id: "action-1", siteId: "site-1", status: "IN_PROGRESS", pageUrl: null, query: "овдп" }));
  intercept(t, prismaCompletionStore, "readMetrics", async () => ({ clicks: 25, impressions: 200 }));
  intercept(t, prismaCompletionStore, "saveCompletion", async (input: { siteId: string; actionId: string; baselineClicks: number }) => {
    assert.deepEqual([input.siteId, input.actionId, input.baselineClicks], ["site-1", "action-1", 25]);
    return { id: "change-1" };
  });
  const response = await completeRoute.POST(new Request("https://seo.example/api/sites/site-1/actions/action-1/complete", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: "Added current examples", changedAt: "2026-09-23" }),
  }), { params: Promise.resolve({ siteId: "site-1", actionId: "action-1" }) });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).change.id, "change-1");
});

test("foreign site cannot read outcomes or complete an action", async (t) => {
  intercept(t, db.site, "findFirst", async () => null);
  const params = { params: Promise.resolve({ siteId: "foreign", actionId: "action-1" }) };
  const response = await completeRoute.POST(new Request("https://seo.example/api/sites/foreign/actions/action-1/complete", {
    method: "POST", body: JSON.stringify({ description: "Updated", changedAt: "2026-09-23" }),
  }), params);
  assert.equal(response.status, 404);
  const outcomeResponse = await outcomesRoute.GET(new Request("https://seo.example/api/sites/foreign/outcomes"), { params: Promise.resolve({ siteId: "foreign" }) });
  assert.equal(outcomeResponse.status, 404);
});

test("outcome evaluation never contacts a paid provider", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ id: "site-1" }));
  intercept(t, prismaEvaluationStore, "listPending", async () => []);
  intercept(t, globalThis, "fetch", async () => { throw new Error("evaluation called an external provider"); });
  const response = await outcomesRoute.POST(new Request("https://seo.example/api/sites/site-1/outcomes", { method: "POST" }), { params: Promise.resolve({ siteId: "site-1" }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { evaluated: 0, pending: 0 });
});
