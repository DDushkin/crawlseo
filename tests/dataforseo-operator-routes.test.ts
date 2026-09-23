import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createRequire } from "node:module";
import { db } from "../lib/db";

const require = createRequire(import.meta.url);
const authPath = require.resolve("../lib/auth");
require.cache[authPath] = { exports: { auth: async () => ({ user: { id: "owner" } }) } } as NodeModule;
const route = require("../app/api/sites/[siteId]/operator-research/route") as typeof import("../app/api/sites/[siteId]/operator-research/route");
const params = { params: Promise.resolve({ siteId: "strum" }) };

function intercept(t: TestContext, target: object, method: string, fn: (...args: never[]) => unknown) {
  const original = Object.getOwnPropertyDescriptor(target, method);
  Object.defineProperty(target, method, { configurable: true, value: fn });
  t.after(() => { if (original) Object.defineProperty(target, method, original); else Reflect.deleteProperty(target, method); });
}

test("research history is site scoped and never contacts DataForSEO", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ domain: "strum.capital" }));
  intercept(t, db.dataForSeoRun, "findMany", async (query: { where: { siteId: string } }) => {
    assert.equal(query.where.siteId, "strum");
    return [{ operation: "placement_check", target: "https://delo.ua/story", mode: "LIVE", chargedUsd: 0.01,
      createdAt: new Date("2026-09-23T10:00:00Z"), response: { tasks: [{ result: [{ items: [] }] }] } }];
  });
  intercept(t, globalThis, "fetch", async () => { throw new Error("GET must not call a provider"); });
  const response = await route.GET(new Request("https://seo.example/api/sites/strum/operator-research"), params);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.history[0].kind, "placement");
  assert.equal(body.history[0].evidence.observed, false);
  assert.match(body.history[0].nextStep, /verify|check|publisher/i);
});

test("operator research POST needs explicit confirmation", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ domain: "strum.capital" }));
  intercept(t, globalThis, "fetch", async () => { throw new Error("provider called without confirmation"); });
  const response = await route.POST(new Request("https://seo.example/api/sites/strum/operator-research", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "ai_citation", target: "Який сервіс обліку інвестицій?" }),
  }), params);
  assert.equal(response.status, 400);
});

test("foreign site is not readable through research history", async (t) => {
  intercept(t, db.site, "findFirst", async () => null);
  const response = await route.GET(new Request("https://seo.example/api/sites/strum/operator-research"), params);
  assert.equal(response.status, 404);
});
