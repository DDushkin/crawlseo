import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createRequire } from "node:module";
import { normalizeAiPrompt, promptFingerprint } from "../lib/operator/ai-prompts";
import { db } from "../lib/db";

const require = createRequire(import.meta.url);
const authPath = require.resolve("../lib/auth");
require.cache[authPath] = { exports: { auth: async () => ({ user: { id: "owner" } }) } } as NodeModule;
const prompts = require("../app/api/sites/[siteId]/ai-prompts/route") as typeof import("../app/api/sites/[siteId]/ai-prompts/route");
const research = require("../app/api/sites/[siteId]/operator-research/route") as typeof import("../app/api/sites/[siteId]/operator-research/route");
const promptRoute = require("../app/api/sites/[siteId]/ai-prompts/[promptId]/route") as typeof import("../app/api/sites/[siteId]/ai-prompts/[promptId]/route");

function intercept(t: TestContext, target: object, method: string, fn: (...args: never[]) => unknown) {
  const original = Object.getOwnPropertyDescriptor(target, method);
  Object.defineProperty(target, method, { configurable: true, value: fn });
  t.after(() => { if (original) Object.defineProperty(target, method, original); else Reflect.deleteProperty(target, method); });
}

test("AI prompt identity is stable across whitespace/case but market-specific", () => {
  const one = normalizeAiPrompt({ question: " Який  трекер  ОВДП? ", country: "UA", language: "uk" });
  const two = normalizeAiPrompt({ question: "який трекер овдп?", country: "UA", language: "uk" });
  assert.equal(promptFingerprint(one), promptFingerprint(two));
  assert.notEqual(promptFingerprint(one), promptFingerprint({ ...one, country: "PL" }));
});

test("AI prompt route refuses foreign site before saving", async (t) => {
  intercept(t, db.site, "findFirst", async () => null);
  intercept(t, db.aiPrompt, "upsert", async () => { throw new Error("foreign prompt saved"); });
  const response = await prompts.POST(new Request("https://seo.example/api/sites/foreign/ai-prompts", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "Який трекер ОВДП?", country: "UA", language: "uk" }) }),
    { params: Promise.resolve({ siteId: "foreign" }) });
  assert.equal(response.status, 404);
});

test("saving the same AI question uses one stable site-scoped key", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ id: "site-1" }));
  let key = "";
  intercept(t, db.aiPrompt, "upsert", async (args: { where: { siteId_fingerprint: { siteId: string; fingerprint: string } } }) => {
    assert.equal(args.where.siteId_fingerprint.siteId, "site-1");
    key = args.where.siteId_fingerprint.fingerprint;
    return { id: "prompt-1" };
  });
  const response = await prompts.POST(new Request("https://seo.example/api/sites/site-1/ai-prompts", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "Який трекер ОВДП?", country: "UA", language: "uk" }) }),
    { params: Promise.resolve({ siteId: "site-1" }) });
  assert.equal(response.status, 200);
  assert.equal(key.length, 64);
});

test("prompt editing rejects an ID from another site", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ id: "site-1" }));
  intercept(t, db.aiPrompt, "findFirst", async () => null);
  intercept(t, db.aiPrompt, "update", async () => { throw new Error("foreign prompt edited"); });
  const response = await promptRoute.PATCH(new Request("https://seo.example/api/sites/site-1/ai-prompts/foreign", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: false }),
  }), { params: Promise.resolve({ siteId: "site-1", promptId: "foreign" }) });
  assert.equal(response.status, 404);
});

test("research history filters to one workflow and makes no paid calls", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ domain: "strum.capital" }));
  intercept(t, db.dataForSeoRun, "findMany", async (args: { where: { operation: string; siteId: string } }) => {
    assert.equal(args.where.operation, "ai_citation");
    assert.equal(args.where.siteId, "site-1");
    return [];
  });
  intercept(t, globalThis, "fetch", async () => { throw new Error("GET contacted provider"); });
  const response = await research.GET(new Request("https://seo.example/api/sites/site-1/operator-research?kind=ai_citation"),
    { params: Promise.resolve({ siteId: "site-1" }) });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).history, []);
});
