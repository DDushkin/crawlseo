import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createRequire } from "node:module";
import { db } from "../lib/db";

const require = createRequire(import.meta.url);
const authPath = require.resolve("../lib/auth");
require.cache[authPath] = { exports: { auth: async () => ({ user: { id: "owner" } }) } } as NodeModule;
const route = require("../app/api/sites/[siteId]/page-map-import/route") as typeof import("../app/api/sites/[siteId]/page-map-import/route");
const preview = require("../app/api/sites/[siteId]/page-map-import/preview/route") as typeof import("../app/api/sites/[siteId]/page-map-import/preview/route");

function intercept(t: TestContext, target: object, method: string, fn: (...args: never[]) => unknown) {
  const original = Object.getOwnPropertyDescriptor(target, method);
  Object.defineProperty(target, method, { configurable: true, value: fn });
  t.after(() => { if (original) Object.defineProperty(target, method, original); else Reflect.deleteProperty(target, method); });
}

test("page map import refuses foreign site before parsing or writing", async (t) => {
  intercept(t, db.site, "findFirst", async () => null);
  intercept(t, db, "$transaction", async () => { throw new Error("foreign site was written"); });
  const response = await route.POST(new Request("https://seo.example/api/sites/foreign/page-map-import", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: [{ url: "https://strum.capital/" }] }),
  }), { params: Promise.resolve({ siteId: "foreign" }) });
  assert.equal(response.status, 404);
});

test("page map import rejects one foreign URL before the transaction", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ domain: "strum.capital" }));
  intercept(t, db, "$transaction", async () => { throw new Error("invalid rows were written"); });
  const response = await route.POST(new Request("https://seo.example/api/sites/site-1/page-map-import", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows: [{ url: "https://strum.capital/" }, { url: "https://other.example/" }] }),
  }), { params: Promise.resolve({ siteId: "site-1" }) });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Row 2/);
});

test("CSV preview performs no database writes", async (t) => {
  intercept(t, db.site, "findFirst", async () => ({ id: "site-1" }));
  intercept(t, db, "$transaction", async () => { throw new Error("preview wrote data"); });
  const form = new FormData();
  form.set("file", new File(["URL,Keyword\nhttps://strum.capital/,трекер"], "map.csv", { type: "text/csv" }));
  const response = await preview.POST(new Request("https://seo.example/api/sites/site-1/page-map-import/preview", { method: "POST", body: form }), { params: Promise.resolve({ siteId: "site-1" }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).rows.length, 1);
});
