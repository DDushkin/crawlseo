import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createRequire } from "node:module";
import { db } from "../lib/db";

const require = createRequire(import.meta.url);
const authPath = require.resolve("../lib/auth");
require.cache[authPath] = { exports: { auth: async () => ({ user: { id: "owner" } }) } } as NodeModule;
const weekly = require("../app/api/sites/[siteId]/weekly-report/route") as typeof import("../app/api/sites/[siteId]/weekly-report/route");

function intercept(t: TestContext, target: object, method: string, fn: (...args: never[]) => unknown) {
  const original = Object.getOwnPropertyDescriptor(target, method);
  Object.defineProperty(target, method, { configurable: true, value: fn });
  t.after(() => { if (original) Object.defineProperty(target, method, original); else Reflect.deleteProperty(target, method); });
}

test("weekly report rejects a foreign site before reading report data", async (t) => {
  intercept(t, db.site, "findFirst", async () => null);
  intercept(t, db.site, "findUnique", async () => { throw new Error("foreign report read"); });
  const response = await weekly.GET(new Request("https://seo.example/api/sites/foreign/weekly-report"),
    { params: Promise.resolve({ siteId: "foreign" }) });
  assert.equal(response.status, 404);
});
