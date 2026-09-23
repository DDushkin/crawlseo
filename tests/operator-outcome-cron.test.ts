import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { db } from "../lib/db";
import { prismaEvaluationStore } from "../lib/operator/outcome-store";
import { POST } from "../app/api/cron/seo-outcomes/route";

function intercept(t: TestContext, target: object, method: string, fn: (...args: never[]) => unknown) {
  const original = Object.getOwnPropertyDescriptor(target, method);
  Object.defineProperty(target, method, { configurable: true, value: fn });
  t.after(() => { if (original) Object.defineProperty(target, method, original); else Reflect.deleteProperty(target, method); });
}

test("outcome cron refuses unauthenticated calls before reading sites", async (t) => {
  intercept(t, db.site, "findMany", async () => { throw new Error("unauthorized cron listed sites"); });
  const response = await POST(new Request("https://seo.example/api/cron/seo-outcomes", { method: "POST" }));
  assert.equal(response.status, 401);
});

test("one site's evaluation failure does not stop the next site", async (t) => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-secret";
  t.after(() => { if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous; });
  intercept(t, db.site, "findMany", async () => [{ id: "broken" }, { id: "healthy" }]);
  intercept(t, prismaEvaluationStore, "listPending", async (siteId: string) => {
    if (siteId === "broken") throw new Error("database timeout");
    return [];
  });
  const response = await POST(new Request("https://seo.example/api/cron/seo-outcomes", {
    method: "POST", headers: { Authorization: "Bearer test-secret" },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sitesProcessed: 1, sitesFailed: 1, outcomesEvaluated: 0 });
});
