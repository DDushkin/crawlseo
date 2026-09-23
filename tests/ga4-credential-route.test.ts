import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createRequire } from "node:module";
import test, { type TestContext } from "node:test";
import { db } from "../lib/db";
import { decrypt } from "../lib/encryption";

const require = createRequire(import.meta.url);
let userId: string | null = "owner";
const authPath = require.resolve("../lib/auth");
require.cache[authPath] = { exports: { auth: async () => userId ? { user: { id: userId } } : null } } as NodeModule;
const route = require("../app/api/user/ga4-credential/route") as typeof import("../app/api/user/ga4-credential/route");

const priorSecret = process.env.NEXTAUTH_SECRET;
process.env.NEXTAUTH_SECRET = "ga4-credential-test-secret";
process.on("exit", () => { if (priorSecret === undefined) delete process.env.NEXTAUTH_SECRET; else process.env.NEXTAUTH_SECRET = priorSecret; });

const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
  .export({ type: "pkcs8", format: "pem" }).toString();
const clientEmail = "reader@crawlseo-internal.iam.gserviceaccount.com";
const projectId = "crawlseo-internal";
const credentialJson = JSON.stringify({ type: "service_account", project_id: projectId,
  client_email: clientEmail, private_key: privateKey, token_uri: "https://oauth2.googleapis.com/token" });

function intercept(t: TestContext, target: object, method: string, fn: (...args: never[]) => unknown) {
  const original = Object.getOwnPropertyDescriptor(target, method);
  Object.defineProperty(target, method, { configurable: true, value: fn });
  t.after(() => { if (original) Object.defineProperty(target, method, original); else Reflect.deleteProperty(target, method); });
}

function postCredential(raw = credentialJson) {
  return route.POST(new Request("https://seo.example/api/user/ga4-credential", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credentialJson: raw }) }));
}

test("unauthenticated GA4 credential requests make no database call", async (t) => {
  userId = null;
  t.after(() => { userId = "owner"; });
  intercept(t, db.ga4Credential, "findUnique", async () => { throw new Error("database read"); });
  intercept(t, db.ga4Credential, "upsert", async () => { throw new Error("database write"); });
  intercept(t, db, "$transaction", async () => { throw new Error("database transaction"); });
  assert.equal((await route.GET()).status, 401);
  assert.equal((await postCredential()).status, 401);
  assert.equal((await route.DELETE()).status, 401);
});

test("GA4 credential status returns only metadata", async (t) => {
  intercept(t, db.ga4Credential, "findUnique", async (args: { where: { userId: string }; select: Record<string, boolean> }) => {
    assert.equal(args.where.userId, "owner");
    assert.equal(args.select.encryptedJson, undefined);
    return { clientEmail, projectId };
  });
  const response = await route.GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { connected: true, clientEmail, projectId });
});

test("GA4 credential save tests Google before storing an encrypted key", async (t) => {
  let tested = false;
  let stored = "";
  intercept(t, globalThis, "fetch", async (url: string) => {
    assert.equal(url, "https://oauth2.googleapis.com/token");
    tested = true;
    return Response.json({ access_token: "test-access-token", token_type: "Bearer", expires_in: 3600 });
  });
  intercept(t, db.ga4Credential, "upsert", async (args: { where: { userId: string }; create: { encryptedJson: string }; update: { encryptedJson: string } }) => {
    assert.equal(tested, true);
    assert.equal(args.where.userId, "owner");
    assert.equal(args.create.encryptedJson, args.update.encryptedJson);
    stored = args.create.encryptedJson;
    return { clientEmail, projectId };
  });
  const response = await postCredential();
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { connected: true, clientEmail, projectId });
  assert.equal(stored.includes(privateKey), false);
  assert.equal(decrypt(stored), credentialJson);
});

test("failed replacement never overwrites a working credential or leaks provider data", async (t) => {
  intercept(t, globalThis, "fetch", async () => new Response("private-key-sentinel", { status: 403 }));
  intercept(t, db.ga4Credential, "upsert", async () => { throw new Error("old credential overwritten"); });
  const response = await postCredential();
  assert.equal(response.status, 400);
  assert.doesNotMatch(JSON.stringify(await response.json()), /private-key-sentinel|BEGIN PRIVATE KEY/);
});

test("a database outage is reported as a server error without echoing the key", async (t) => {
  intercept(t, globalThis, "fetch", async () => Response.json({ access_token: "test-access-token" }));
  intercept(t, db.ga4Credential, "upsert", async () => { throw new Error("database-failure-private-key-sentinel"); });
  const response = await postCredential();
  assert.equal(response.status, 500);
  assert.doesNotMatch(JSON.stringify(await response.json()), /private-key-sentinel|BEGIN PRIVATE KEY/);
});

test("malformed or oversized credential fails before contacting Google", async (t) => {
  intercept(t, globalThis, "fetch", async () => { throw new Error("unexpected Google request"); });
  intercept(t, db.ga4Credential, "upsert", async () => { throw new Error("unexpected save"); });
  assert.equal((await postCredential("{" )).status, 400);
  assert.equal((await postCredential(" ".repeat(16_385))).status, 400);
});

test("removing GA4 key invalidates sync freshness but preserves historical rows", async (t) => {
  const writes: string[] = [];
  intercept(t, db, "$transaction", async (fn: (tx: object) => Promise<void>) => fn({
    ga4Credential: { deleteMany: async (args: { where: { userId: string } }) => {
      assert.equal(args.where.userId, "owner"); writes.push("key");
    } },
    site: { updateMany: async (args: { where: { userId: string }; data: { lastGa4SyncAt: null } }) => {
      assert.equal(args.where.userId, "owner"); assert.equal(args.data.lastGa4SyncAt, null); writes.push("freshness");
    } },
    aiReferralDaily: { deleteMany: async () => { throw new Error("historical data erased"); } },
  }));
  const response = await route.DELETE();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { connected: false });
  assert.deepEqual(writes, ["key", "freshness"]);
});
