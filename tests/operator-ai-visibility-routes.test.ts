import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createRequire } from "node:module";
import { db } from "../lib/db";

const require = createRequire(import.meta.url);
const authPath = require.resolve("../lib/auth");
require.cache[authPath] = { exports: { auth: async () => ({ user: { id: "owner" } }) } } as NodeModule;
const aiImport = require("../app/api/sites/[siteId]/gsc-ai-import/route") as typeof import("../app/api/sites/[siteId]/gsc-ai-import/route");
const aiPanel = require("../app/api/sites/[siteId]/ai-visibility/route") as typeof import("../app/api/sites/[siteId]/ai-visibility/route");
const aiPanelCron = require("../app/api/cron/ai-panel/route") as typeof import("../app/api/cron/ai-panel/route");

function intercept(t: TestContext, target: object, method: string, fn: (...args: never[]) => unknown) {
  const original = Object.getOwnPropertyDescriptor(target, method);
  Object.defineProperty(target, method, { configurable: true, value: fn });
  t.after(() => { if (original) Object.defineProperty(target, method, original); else Reflect.deleteProperty(target, method); });
}

test("GSC AI import refuses property mismatch before writing", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ gscProperty: "sc-domain:strum.capital" }));
  intercept(t, db, "$transaction", async () => { throw new Error("mismatched export was written"); });
  const form = new FormData();
  form.set("file", new File(["Date,Impressions\n2026-09-01,3"], "Chart.csv"));
  form.set("property", "sc-domain:other.example");
  form.set("confirmedProperty", "true");
  const response = await aiImport.POST(new Request("https://seo.example/api/sites/site-1/gsc-ai-import", { method: "POST", body: form }),
    { params: Promise.resolve({ siteId: "site-1" }) });
  assert.equal(response.status, 400);
});

test("GSC AI import deduplicates within the selected property, not across property reconnects", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ gscProperty: "sc-domain:strum.capital" }));
  let key: Record<string, unknown> | null = null;
  intercept(t, db.gscAiImport, "findUnique", async (args: { where: Record<string, unknown> }) => { key = args.where; return { id: "existing" }; });
  const form = new FormData();
  form.set("file", new File(["Date,Impressions\n2026-09-01,3"], "Chart.csv"));
  form.set("property", "sc-domain:strum.capital"); form.set("confirmedProperty", "true");
  const response = await aiImport.POST(new Request("https://seo.example/api/sites/site-1/gsc-ai-import", { method: "POST", body: form }),
    { params: Promise.resolve({ siteId: "site-1" }) });
  assert.equal(response.status, 200);
  assert.equal((key as { siteId_property_fileHash?: { property?: string } } | null)?.siteId_property_fileHash?.property, "sc-domain:strum.capital");
});

test("AI visibility GET is site-scoped and does not contact paid provider", async (t) => {
  intercept(t, db.site, "findFirst", async () => null);
  intercept(t, globalThis, "fetch", async () => { throw new Error("GET contacted provider"); });
  const response = await aiPanel.GET(new Request("https://seo.example/api/sites/foreign/ai-visibility"), { params: Promise.resolve({ siteId: "foreign" }) });
  assert.equal(response.status, 404);
});

test("confirmed AI panel persists a resumable queue without charging on the browser request", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ domain: "strum.capital" }));
  intercept(t, db.apiKey, "findUnique", async () => ({ id: "connected-key" }));
  intercept(t, db.aiPrompt, "findMany", async () => [{ id: "p1", fingerprint: "fingerprint", question: "Який трекер інвестицій обрати?",
    country: "UA", language: "uk", platform: "CHATGPT_WEB" }]);
  intercept(t, db.dataForSeoSettings, "upsert", async () => ({ mode: "SANDBOX", locationCode: 2804, languageCode: "uk", spentUsd: 0, reservedUsd: 0 }));
  intercept(t, db.dataForSeoRun, "findMany", async () => []);
  const saved: Record<string, unknown> = {};
  intercept(t, db.aiVisibilityRun, "create", async (args: { data: Record<string, unknown> }) => { Object.assign(saved, args.data); return { id: "run-1" }; });
  intercept(t, globalThis, "fetch", async () => { throw new Error("confirmation unexpectedly contacted DataForSEO"); });
  const response = await aiPanel.POST(new Request("https://seo.example/api/sites/site-1/ai-visibility", { method: "POST",
    body: JSON.stringify({ confirm: true, promptIds: ["p1"], maxUsd: 0 }) }), { params: Promise.resolve({ siteId: "site-1" }) });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).status, "QUEUED");
  assert.equal(saved?.activeKey, "site-1");
  assert.deepEqual(saved?.promptSnapshots, [{ id: "p1", fingerprint: "fingerprint", question: "Який трекер інвестицій обрати?" }]);
});

test("AI panel scheduler refuses unauthenticated requests before reading queued runs", async (t) => {
  intercept(t, db.aiVisibilityRun, "findFirst", async () => { throw new Error("unauthorized read"); });
  const response = await aiPanelCron.POST(new Request("https://seo.example/api/cron/ai-panel", { method: "POST" }));
  assert.equal(response.status, 401);
});
