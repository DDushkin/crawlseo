import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { db } from "../lib/db";
import { getAccessToken, getReadOnlyAccessToken } from "../lib/google/google-auth";

function intercept(
  t: TestContext,
  target: object,
  method: string,
  replacement: (...args: never[]) => unknown
) {
  const original = Object.getOwnPropertyDescriptor(target, method);
  Object.defineProperty(target, method, { configurable: true, value: replacement });
  t.after(() => {
    if (original) Object.defineProperty(target, method, original);
    else Reflect.deleteProperty(target, method);
  });
}

function expiredTokenFixture(t: TestContext) {
  let updates = 0;
  intercept(t, db.user, "findUnique", async () => ({
    googleTokens: {
      accessToken: "expired-token",
      refreshToken: "refresh-token",
      expiresAt: 1,
    },
  }));
  intercept(t, db.user, "update", async () => {
    updates += 1;
    return {};
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    access_token: "refreshed-token",
    expires_in: 3600,
  }), { status: 200 });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  return { updateCount: () => updates };
}

test("read-only access refreshes an expired token without a database update", async (t) => {
  const fixture = expiredTokenFixture(t);

  assert.equal(await getReadOnlyAccessToken("owner-a"), "refreshed-token");
  assert.equal(fixture.updateCount(), 0);
});

test("default access still persists an expired token refresh", async (t) => {
  const fixture = expiredTokenFixture(t);

  assert.equal(await getAccessToken("owner-a"), "refreshed-token");
  assert.equal(fixture.updateCount(), 1);
});
