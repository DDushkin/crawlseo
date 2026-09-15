import assert from "node:assert/strict";
import test from "node:test";

import { emptyGscReportCounts } from "../lib/gsc/types";
import { GscSyncError } from "../lib/gsc/sync-service";
import { handleManualGscSync } from "../lib/gsc/manual-sync-handler";

const completed = {
  status: "completed" as const,
  runId: "run-1",
  startDate: "2026-09-01",
  endDate: "2026-09-07",
  reportCounts: emptyGscReportCounts(),
  warnings: [],
};

test("rejects a missing session before synchronization", async () => {
  const response = await handleManualGscSync({
    userId: null,
    body: { siteId: "site-1" },
    sync: async () => { throw new Error("sync must not run"); },
  });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { error: "Unauthorized" });
});

test("rejects a malformed site identifier", async () => {
  const response = await handleManualGscSync({
    userId: "user-1",
    body: { siteId: 12 },
    sync: async () => { throw new Error("sync must not run"); },
  });

  assert.equal(response.status, 400);
});

test("maps an ownership miss to 404", async () => {
  const response = await handleManualGscSync({
    userId: "user-1",
    body: { siteId: "site-2" },
    sync: async () => { throw new GscSyncError("NOT_FOUND", "Site not found"); },
  });

  assert.equal(response.status, 404);
});

test("maps a reconnect requirement to 401", async () => {
  const response = await handleManualGscSync({
    userId: "user-1",
    body: { siteId: "site-1" },
    sync: async () => { throw new GscSyncError("REAUTH_REQUIRED", "Reconnect"); },
  });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, {
    error: "Your Google connection has expired. Please reconnect your account.",
    code: "REAUTH_REQUIRED",
  });
});

test("maps a missing connected property to 400", async () => {
  const response = await handleManualGscSync({
    userId: "user-1",
    body: { siteId: "site-1" },
    sync: async () => { throw new GscSyncError("NO_PROPERTY", "No property"); },
  });

  assert.equal(response.status, 400);
});

test("maps an active lease to 409", async () => {
  const response = await handleManualGscSync({
    userId: "user-1",
    body: { siteId: "site-1" },
    sync: async () => ({
      status: "already-running",
      runId: null,
      startDate: null,
      endDate: null,
      reportCounts: emptyGscReportCounts(),
      warnings: [],
    }),
  });

  assert.equal(response.status, 409);
});

test("returns completed synchronization results", async () => {
  const response = await handleManualGscSync({
    userId: "user-1",
    body: { siteId: "site-1" },
    sync: async () => completed,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, completed);
});

test("returns completed synchronization results with warnings", async () => {
  const warningResult = { ...completed, status: "completed-with-warnings" as const, warnings: [{ code: "QUERY_TRUNCATED", message: "Query report was truncated." }] };
  const response = await handleManualGscSync({
    userId: "user-1",
    body: { siteId: "site-1" },
    sync: async () => warningResult,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, warningResult);
});

test("sanitizes a provider failure", async () => {
  const response = await handleManualGscSync({
    userId: "user-1",
    body: { siteId: "site-1" },
    sync: async () => ({ ...completed, status: "failed" as const, error: { code: "PROVIDER_ERROR", message: "Secret provider error" } }),
  });

  assert.equal(response.status, 502);
  assert.deepEqual(response.body, {
    error: "Search Console synchronization failed. Please try again.",
    code: "PROVIDER_ERROR",
  });
});

test("maps typed failed synchronization results", async () => {
  const response = await handleManualGscSync({
    userId: "user-1",
    body: { siteId: "site-1" },
    sync: async () => ({ ...completed, status: "failed" as const, error: { code: "NO_PROPERTY", message: "No property" } }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, {
    error: "Connect a Search Console property first.",
    code: "NO_PROPERTY",
  });
});
