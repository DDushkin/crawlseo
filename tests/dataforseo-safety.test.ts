import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { db } from "../lib/db";
import { DataForSeoError, defaultDataForSeoMarket, executeDataForSeo, getDataForSeoAccountBalance, normalizeDataForSeoTarget, previewDataForSeo } from "../lib/dataforseo/gateway";
import { parseKeywordResults, parseDomainOverview, parseBacklinksOverview, parseBacklinksProfile } from "../lib/dataforseo/client";
import { encrypt } from "../lib/encryption";

function intercept(t: TestContext, target: object, method: string, fn: (...args: never[]) => unknown) {
  const original = Object.getOwnPropertyDescriptor(target, method);
  Object.defineProperty(target, method, { configurable: true, value: fn });
  t.after(() => { if (original) Object.defineProperty(target, method, original); else Reflect.deleteProperty(target, method); });
}

const sandboxSettings = { siteId: "strum", mode: "SANDBOX", locationCode: 2804, languageCode: "uk", spentUsd: 0, reservedUsd: 0 };

test("Strum defaults to Ukraine/Ukrainian without changing other sites", () => {
  assert.deepEqual(defaultDataForSeoMarket("strum.capital"), { locationCode: 2804, languageCode: "uk" });
  assert.deepEqual(defaultDataForSeoMarket("other.example"), { locationCode: 2840, languageCode: "en" });
  assert.equal(normalizeDataForSeoTarget("https://www.example.com/path", "domain"), "example.com");
  assert.throws(() => normalizeDataForSeoTarget("ab", "keywords"), /Keyword/);
  assert.throws(() => normalizeDataForSeoTarget("not-a-domain", "domain"), /valid domain/);
});

test("DataForSEO previews are free and disclose two billable domain requests", async (t) => {
  intercept(t, db.dataForSeoSettings, "upsert", async () => ({ ...sandboxSettings, mode: "LIVE" }));
  intercept(t, db.dataForSeoRun, "findMany", async () => []);
  const preview = await previewDataForSeo("strum", "strum.capital", "domain", "competitor.com");
  assert.equal(preview.mode, "LIVE");
  assert.equal(preview.uncachedRequests, 2);
  assert.equal(preview.estimatedUsd, 0.05);
  assert.equal(preview.locationCode, 2804);
  assert.equal(preview.languageCode, "uk");
});

test("Live budget stops a request before contacting DataForSEO", async (t) => {
  const settings = { ...sandboxSettings, mode: "LIVE", spentUsd: 0.14 };
  intercept(t, db.dataForSeoSettings, "upsert", async () => settings);
  intercept(t, db.dataForSeoRun, "findFirst", async () => null);
  intercept(t, db.apiKey, "findUnique", async () => ({ encryptedLogin: "ignored", encryptedPassword: "ignored" }));
  intercept(t, db, "$transaction", async (callback: (tx: object) => Promise<unknown>) => callback({
    dataForSeoSettings: { findUniqueOrThrow: async () => settings },
  }));
  intercept(t, globalThis, "fetch", async () => { throw new Error("provider must not be called"); });
  await assert.rejects(() => executeDataForSeo("strum", "owner", "strum.capital", "keywords", "інвестиційний трекер"),
    (error: unknown) => error instanceof DataForSeoError && error.status === 402);
});

test("Cached provider response does not require credentials or call the provider", async (t) => {
  intercept(t, db.dataForSeoSettings, "upsert", async () => sandboxSettings);
  intercept(t, db.dataForSeoRun, "findFirst", async () => ({ response: {
    status_code: 20000, tasks: [{ status_code: 20000, result: [{ items: [] }] }],
  } }));
  intercept(t, db.apiKey, "findUnique", async () => { throw new Error("credentials read despite cache"); });
  intercept(t, globalThis, "fetch", async () => { throw new Error("provider called despite cache"); });
  const result = await executeDataForSeo("strum", "owner", "strum.capital", "keywords", "інвестиційний трекер");
  assert.equal(result.cached, true);
  assert.equal(result.chargedUsd, 0);
});

test("Sandbox uses the non-billable host and records a zero charge", async (t) => {
  const oldSecret = process.env.NEXTAUTH_SECRET;
  process.env.NEXTAUTH_SECRET = "test-only-secret";
  t.after(() => { if (oldSecret === undefined) delete process.env.NEXTAUTH_SECRET; else process.env.NEXTAUTH_SECRET = oldSecret; });
  intercept(t, db.dataForSeoSettings, "upsert", async () => sandboxSettings);
  intercept(t, db.dataForSeoRun, "findFirst", async () => null);
  intercept(t, db.apiKey, "findUnique", async () => ({ encryptedLogin: encrypt("login"), encryptedPassword: encrypt("password") }));
  let completedCharge: number | undefined;
  let transactionCount = 0;
  intercept(t, db, "$transaction", async (callback: (tx: object) => Promise<unknown>) => {
    transactionCount++;
    if (transactionCount === 1) return callback({
      dataForSeoSettings: { findUniqueOrThrow: async () => sandboxSettings },
      dataForSeoRun: { create: async () => ({ id: "run-1" }) },
    });
    return callback({
      dataForSeoRun: { update: async (input: { data: { chargedUsd?: number } }) => { completedCharge = input.data.chargedUsd; } },
    });
  });
  let requestedUrl = "";
  intercept(t, globalThis, "fetch", async (url: string) => {
    requestedUrl = url;
    return Response.json({ status_code: 20000, cost: 0, tasks: [{ id: "task-1", status_code: 20000, result: [{ items: [] }] }] });
  });
  const result = await executeDataForSeo("strum", "owner", "strum.capital", "keywords", "інвестиційний трекер");
  assert.match(requestedUrl, /^https:\/\/sandbox\.dataforseo\.com\/v3\//);
  assert.equal(result.mode, "SANDBOX");
  assert.equal(result.chargedUsd, 0);
  assert.equal(completedCharge, 0);
});

test("Live records the provider-reported charge and releases its reservation", async (t) => {
  const oldSecret = process.env.NEXTAUTH_SECRET;
  process.env.NEXTAUTH_SECRET = "test-only-secret";
  t.after(() => { if (oldSecret === undefined) delete process.env.NEXTAUTH_SECRET; else process.env.NEXTAUTH_SECRET = oldSecret; });
  const settings = { ...sandboxSettings, mode: "LIVE" };
  intercept(t, db.dataForSeoSettings, "upsert", async () => settings);
  intercept(t, db.dataForSeoRun, "findFirst", async () => null);
  intercept(t, db.apiKey, "findUnique", async () => ({ encryptedLogin: encrypt("login"), encryptedPassword: encrypt("password") }));
  const settingsUpdates: unknown[] = [];
  let transactionCount = 0;
  intercept(t, db, "$transaction", async (callback: (tx: object) => Promise<unknown>) => {
    transactionCount++;
    return callback({
      dataForSeoSettings: {
        findUniqueOrThrow: async () => settings,
        update: async (input: { data: unknown }) => { settingsUpdates.push(input.data); },
      },
      dataForSeoRun: {
        create: async () => ({ id: "live-run" }),
        update: async () => ({}),
      },
    });
  });
  let requestedUrl = "";
  intercept(t, globalThis, "fetch", async (url: string) => {
    requestedUrl = url;
    return Response.json({ status_code: 20000, cost: 0.018, tasks: [{ id: "task", status_code: 20000, result: [{ items: [] }] }] });
  });
  const result = await executeDataForSeo("strum", "owner", "strum.capital", "keywords", "інвестиційний трекер");
  assert.match(requestedUrl, /^https:\/\/api\.dataforseo\.com\/v3\//);
  assert.equal(result.chargedUsd, 0.018);
  assert.equal(transactionCount, 2);
  assert.deepEqual(settingsUpdates, [
    { reservedUsd: { increment: 0.025 } },
    { reservedUsd: { decrement: 0.025 }, spentUsd: { increment: 0.018 } },
  ]);
});

test("Account balance check uses only the free User Data endpoint", async (t) => {
  const oldSecret = process.env.NEXTAUTH_SECRET;
  process.env.NEXTAUTH_SECRET = "test-only-secret";
  t.after(() => { if (oldSecret === undefined) delete process.env.NEXTAUTH_SECRET; else process.env.NEXTAUTH_SECRET = oldSecret; });
  intercept(t, db.apiKey, "findUnique", async () => ({ encryptedLogin: encrypt("login"), encryptedPassword: encrypt("password") }));
  let requestUrl = "";
  let method = "";
  intercept(t, globalThis, "fetch", async (url: string, init: { method: string }) => {
    requestUrl = url;
    method = init.method;
    return Response.json({ status_code: 20000, tasks: [{ result: [{ money: { balance: 0.95 } }] }] });
  });
  assert.equal(await getDataForSeoAccountBalance("owner"), 0.95);
  assert.equal(requestUrl, "https://api.dataforseo.com/v3/appendix/user_data");
  assert.equal(method, "GET");
});

test("Parser reads provider keyword difficulty and keeps backlink counts separate", () => {
  const response = { tasks: [{ result: [{ items: [{ keyword_data: {
    keyword: "трекер інвестицій", keyword_info: { search_volume: 90, cpc: 0.2 },
    keyword_properties: { keyword_difficulty: 17 },
  } }] }] }] };
  assert.equal(parseKeywordResults(response)[0].difficulty, 17);
  assert.equal(parseDomainOverview({ tasks: [{ result: [{ metrics: { organic: { count: 7, etv: 40 } } }] }] })?.backlinks, null);
  assert.deepEqual(parseBacklinksOverview({ tasks: [{ result: [{ backlinks: 12, referring_domains: 9, referring_links_attributes: { nofollow: 3 } }] }] }), {
    totalBacklinks: 12, referringDomains: 9, referringIps: 0, dofollow: 9, nofollow: 3,
  });
  assert.equal(parseBacklinksProfile({ tasks: [{ result: [{ items: [{ url_from: "https://source.example/a" }] }] }] })[0].dofollow, null);
});
