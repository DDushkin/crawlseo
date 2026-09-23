import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";
import { getGa4ServiceAccountToken, parseGa4ServiceAccount } from "../lib/google/ga4-service-account";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const account = {
  type: "service_account",
  project_id: "crawlseo-internal",
  client_email: "reader@crawlseo-internal.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  token_uri: "https://oauth2.googleapis.com/token",
};

test("parses a genuine RSA service-account key without accepting arbitrary token endpoints", () => {
  assert.deepEqual(parseGa4ServiceAccount(JSON.stringify(account)), {
    projectId: "crawlseo-internal",
    clientEmail: "reader@crawlseo-internal.iam.gserviceaccount.com",
    privateKey: account.private_key,
  });
  assert.throws(() => parseGa4ServiceAccount(JSON.stringify({ ...account, token_uri: "https://example.com/token" })), /invalid|token/i);
  assert.throws(() => parseGa4ServiceAccount(JSON.stringify({ ...account, project_id: "other-project" })), /invalid/i);
  assert.throws(() => parseGa4ServiceAccount(JSON.stringify({ ...account, private_key: "not a key" })), /invalid/i);
  assert.throws(() => parseGa4ServiceAccount(JSON.stringify({ ...account, type: "authorized_user" })), /invalid/i);
  assert.throws(() => parseGa4ServiceAccount(JSON.stringify(account) + " ".repeat(16_385)), /size/i);
});

test("exchanges a signed, one-hour read-only JWT for an access token", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input, init) => {
    assert.equal(input, "https://oauth2.googleapis.com/token");
    assert.equal(init?.method, "POST");
    const form = new URLSearchParams(init?.body as URLSearchParams);
    assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [header, payload, signature] = (form.get("assertion") || "").split(".");
    assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "RS256", typ: "JWT" });
    assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url").toString()), {
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/analytics.readonly",
      aud: account.token_uri,
      iat: 1_790_164_800,
      exp: 1_790_168_400,
    });
    assert.equal(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url")), true);
    return Response.json({ access_token: "test-access-token", token_type: "Bearer", expires_in: 3600 });
  };
  const token = await getGa4ServiceAccountToken(parseGa4ServiceAccount(JSON.stringify(account)), new Date("2026-09-23T12:00:00Z"));
  assert.equal(token, "test-access-token");
});

test("token failures never disclose Google's response body", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response("private-key-sentinel", { status: 403 });
  const error = await getGa4ServiceAccountToken(parseGa4ServiceAccount(JSON.stringify(account)))
    .then(() => null, (reason: unknown) => reason);
  assert.match(String(error), /403/);
  assert.doesNotMatch(String(error), /private-key-sentinel/);
});
