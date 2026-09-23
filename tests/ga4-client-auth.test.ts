import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test, { type TestContext } from "node:test";
import { db } from "../lib/db";
import { encrypt } from "../lib/encryption";
import { fetchGa4Report } from "../lib/google/ga4-client";
import { syncGa4Site } from "../lib/google/ga4-sync";

process.env.NEXTAUTH_SECRET = "ga4-client-auth-test-secret";
const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
  .export({ type: "pkcs8", format: "pem" }).toString();
const credentialJson = JSON.stringify({ type: "service_account", project_id: "crawlseo-internal",
  client_email: "reader@crawlseo-internal.iam.gserviceaccount.com", private_key: privateKey,
  token_uri: "https://oauth2.googleapis.com/token" });

function intercept(t: TestContext, target: object, method: string, fn: (...args: never[]) => unknown) {
  const original = Object.getOwnPropertyDescriptor(target, method);
  Object.defineProperty(target, method, { configurable: true, value: fn });
  t.after(() => { if (original) Object.defineProperty(target, method, original); else Reflect.deleteProperty(target, method); });
}

function connected(t: TestContext) {
  intercept(t, db.ga4Credential, "findUnique", async (args: { where: { userId: string } }) => {
    assert.equal(args.where.userId, "owner");
    return { encryptedJson: encrypt(credentialJson) };
  });
  intercept(t, db.user, "findUnique", async () => { throw new Error("legacy Google OAuth was used"); });
}

test("missing GA4 service account stops before Google reports and legacy OAuth", async (t) => {
  intercept(t, db.ga4Credential, "findUnique", async () => null);
  intercept(t, db.user, "findUnique", async () => { throw new Error("legacy Google OAuth was used"); });
  intercept(t, globalThis, "fetch", async () => { throw new Error("Google was contacted"); });
  await assert.rejects(fetchGa4Report("owner", "123456789", "2026-09-01", "2026-09-02"), /Connect a GA4 service account/i);
});

test("GA4 report uses the saved service account for the exact site property", async (t) => {
  connected(t);
  const calls: { url: string; authorization: string | undefined }[] = [];
  intercept(t, globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, authorization: (init.headers as Record<string, string>)?.Authorization });
    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "test-access-token", token_type: "Bearer", expires_in: 3600 });
    }
    return Response.json({ rows: [{ dimensionValues: [{ value: "20260901" }, { value: "google" },
      { value: "organic" }, { value: "Organic Search" }], metricValues: [{ value: "12" }, { value: "2" }] }], rowCount: 1 });
  });
  const report = await fetchGa4Report("owner", "123456789", "2026-09-01", "2026-09-02");
  assert.equal(report.rowCount, 1);
  assert.equal(calls[0].url, "https://oauth2.googleapis.com/token");
  assert.equal(calls[1].url, "https://analyticsdata.googleapis.com/v1beta/properties/123456789:runReport");
  assert.equal(calls[1].authorization, "Bearer test-access-token");
});

test("invalid GA4 property ID never contacts credentials or Google", async (t) => {
  intercept(t, db.ga4Credential, "findUnique", async () => { throw new Error("credential read"); });
  intercept(t, globalThis, "fetch", async () => { throw new Error("Google called"); });
  await assert.rejects(fetchGa4Report("owner", "properties/abc", "2026-09-01", "2026-09-02"), /numeric/i);
});

test("GA4 403 gives qualified access guidance without leaking provider content", async (t) => {
  connected(t);
  intercept(t, globalThis, "fetch", async (url: string) => url === "https://oauth2.googleapis.com/token"
    ? Response.json({ access_token: "test-access-token" })
    : new Response("private-key-sentinel", { status: 403 }));
  const error = await fetchGa4Report("owner", "123456789", "2026-09-01", "2026-09-02")
    .then(() => null, (reason: unknown) => reason);
  assert.match(String(error), /403.*Viewer.*Analytics Data API/i);
  assert.doesNotMatch(String(error), /private-key-sentinel/);
});

test("incomplete paginated GA4 response fails instead of reporting a partial result", async (t) => {
  connected(t);
  let reports = 0;
  intercept(t, globalThis, "fetch", async (url: string) => {
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "test-access-token" });
    reports++;
    return Response.json({ rows: reports === 1 ? [{ dimensionValues: [{ value: "20260901" }], metricValues: [{ value: "1" }, { value: "0" }] }] : [], rowCount: 2 });
  });
  await assert.rejects(fetchGa4Report("owner", "123456789", "2026-09-01", "2026-09-02"), /incomplete/i);
});

test("a failed GA4 report never starts daily-row replacement", async (t) => {
  connected(t);
  intercept(t, globalThis, "fetch", async (url: string) => url === "https://oauth2.googleapis.com/token"
    ? Response.json({ access_token: "test-access-token" })
    : new Response("denied", { status: 403 }));
  intercept(t, db, "$transaction", async () => { throw new Error("daily rows were replaced"); });
  await assert.rejects(syncGa4Site("site-1", "owner", "123456789", new Date("2026-09-23T12:00:00Z")), /HTTP 403/);
});
