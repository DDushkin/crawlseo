import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createGscSyncService } from "../lib/gsc/sync-service";
import type { GscSyncDependencies } from "../lib/gsc/sync-service";
import { prismaGscStore, type CreateGscRunInput, type FinishGscRunInput, type GscStore, type GscSyncTarget, type ReplaceGscReportInput } from "../lib/gsc/store";
import { Prisma } from "@prisma/client";
import { db } from "../lib/db";
import { GSC_REPORT_KINDS, type GscReportKind, type GscReportResult } from "../lib/gsc/types";
import { ReauthRequiredError } from "../lib/google/google-auth";

const target: GscSyncTarget = { siteId: "site-a", userId: "user-a", property: "sc-domain:example.com", searchType: "web", dataVersion: 1 };
const now = new Date("2026-09-15T12:00:00.000Z");

// Prisma delegates are proxies with synthetic property descriptors, so restore
// these low-level test interceptors explicitly instead of using mock.method().
function intercept(context: TestContext, object: object, method: string, implementation: (...args: never[]) => unknown) {
  const original: unknown = Reflect.get(object, method);
  Reflect.set(object, method, implementation);
  context.after(() => { Reflect.set(object, method, original); });
}

class FakeStore implements GscStore {
  leaseOwner: string | null = null;
  acquired: { siteId: string; ownerId: string; expiresAt: Date }[] = [];
  renewals: { siteId: string; ownerId: string; expiresAt: Date }[] = [];
  released: { siteId: string; ownerId: string }[] = [];
  runs: CreateGscRunInput[] = [];
  replacements: ReplaceGscReportInput[] = [];
  finished: FinishGscRunInput[] = [];
  ready: string[] = [];
  canonical = new Map<string, string[]>([["site-a:query", ["last-good"]], ["site-b:query", ["other-site"]]]);
  async resolveOwnedTarget() { return target; }
  async listScheduledTargets() { return [target]; }
  async acquireLease(siteId: string, ownerId: string, expiresAt: Date) {
    this.acquired.push({ siteId, ownerId, expiresAt });
    if (this.leaseOwner) return false;
    this.leaseOwner = ownerId;
    return true;
  }
  async releaseLease(siteId: string, ownerId: string) {
    this.released.push({ siteId, ownerId });
    if (this.leaseOwner === ownerId) this.leaseOwner = null;
  }
  async renewLease(siteId: string, ownerId: string, expiresAt: Date) {
    this.renewals.push({ siteId, ownerId, expiresAt });
    return this.leaseOwner === ownerId;
  }
  async createRun(input: CreateGscRunInput) { this.runs.push(input); return `run-${this.runs.length}`; }
  async replaceReport(input: ReplaceGscReportInput) {
    this.replacements.push(input);
    // Writes here deliberately do not protect against incomplete input: the service must skip it.
    this.canonical.set(`${input.siteId}:${input.kind}`, identities(input));
    return input.rows.length;
  }
  async finishRun(input: FinishGscRunInput) { this.finished.push(input); }
  async markSiteReady(siteId: string) { this.ready.push(siteId); }
}

function identities(input: ReplaceGscReportInput) {
  return input.rows.map((row) => JSON.stringify([row.siteId, input.searchType, row.date,
    ...({ dailyTotal: [], query: [row.query], page: [row.url], queryPage: [row.query, row.url], device: [row.device], country: [row.country] }[input.kind])])).sort();
}

function report(kind: GscReportKind): GscReportResult {
  return { kind, complete: true, pagesFetched: 1, truncatedAt: null, rows: [{
    date: "2026-09-12", clicks: kind === "query" ? 80 : 100, impressions: kind === "query" ? 700 : 1000,
    ctr: 0.1, position: 2.5,
    ...({ dailyTotal: {}, query: { query: "shoes" }, page: { url: "https://example.com/" }, queryPage: { query: "shoes", url: "https://example.com/" }, device: { device: "MOBILE" }, country: { country: "usa" } }[kind]),
  }] };
}

function setup(overrides: Partial<GscSyncDependencies> = {}) {
  const store = new FakeStore();
  const requests: { userId: string; property: string; range: { startDate: string; endDate: string }; kind: GscReportKind; options: unknown }[] = [];
  const probes: string[] = [];
  const service = createGscSyncService({ store,
    fetchReport: async (userId, property, range, kind, options) => { requests.push({ userId, property, range, kind, options }); return report(kind); },
    probeCoverage: async (requestedTarget) => { probes.push(requestedTarget.siteId); return { finalizedThrough: "2026-09-12", source: "metadata" }; },
    now: () => now, randomId: () => "lease-owner-1", ...overrides,
  });
  return { store, requests, probes, service };
}

test("a second lease attempt makes no Google calls or run changes", async () => {
  const fixture = setup();
  fixture.store.leaseOwner = "someone-else";
  const result = await fixture.service.syncTarget(target, "MANUAL");
  assert.equal(result.status, "already-running");
  assert.equal(result.runId, null);
  assert.deepEqual(fixture.requests, []);
  assert.deepEqual(fixture.probes, []);
  assert.deepEqual(fixture.store.runs, []);
  assert.deepEqual(fixture.store.released, []);
});

test("first sync requests 90 finalized dates and all six final web reports", async () => {
  const fixture = setup();
  const result = await fixture.service.syncTarget(target, "INITIAL");
  assert.equal(result.status, "completed");
  assert.deepEqual(result.warnings, []);
  assert.equal(result.startDate, "2026-06-15");
  assert.equal(result.endDate, "2026-09-12");
  assert.deepEqual(fixture.requests.map((request) => request.kind).sort(), ["country", "dailyTotal", "device", "page", "query", "queryPage"]);
  for (const request of fixture.requests) {
    assert.equal(request.userId, "user-a");
    assert.equal(request.property, "sc-domain:example.com");
    assert.deepEqual(request.range, { startDate: "2026-06-15", endDate: "2026-09-12" });
    assert.deepEqual(request.options, { type: "web", dataState: "final" });
  }
  assert.deepEqual(fixture.store.released, [{ siteId: "site-a", ownerId: "lease-owner-1" }]);
  assert.deepEqual(fixture.store.renewals, Array.from({ length: 4 }, () => ({ siteId: "site-a", ownerId: "lease-owner-1", expiresAt: new Date("2026-09-15T12:30:00.000Z") })));
  assert.deepEqual(fixture.store.ready, ["site-a"]);
  assert.equal(fixture.store.runs[0].property, "sc-domain:example.com");
  assert.ok(fixture.store.replacements.every((replacement) => replacement.property === "sc-domain:example.com"));
  assert.deepEqual(fixture.store.canonical.get("site-b:query"), ["other-site"]);
  assert.equal(fixture.store.finished[0].status, "COMPLETED");
});

for (const trigger of ["MANUAL", "SCHEDULED"] as const) {
  test(`ready-site ${trigger} auto sync requests seven dates`, async () => {
    const fixture = setup();
    await fixture.service.syncTarget({ ...target, dataVersion: 2 }, trigger);
    assert.equal(fixture.requests.length, 6);
    for (const request of fixture.requests) assert.deepEqual(request.range, { startDate: "2026-09-06", endDate: "2026-09-12" });
  });
}

test("explicit backfill requests 90 dates even for a ready site", async () => {
  const fixture = setup();
  await fixture.service.syncTarget({ ...target, dataVersion: 2 }, "CLI", "backfill");
  assert.deepEqual(fixture.requests[0].range, { startDate: "2026-06-15", endDate: "2026-09-12" });
});

test("stored rows use the target site and repeated reports retain their unique identities", async () => {
  const fixture = setup({ fetchReport: async (...args) => ({ ...report(args[3]), rows: report(args[3]).rows.map((row) => ({ ...row, siteId: "attacker-site" })) }) });
  await fixture.service.syncTarget(target, "MANUAL");
  await fixture.service.syncTarget(target, "MANUAL");
  assert.equal(fixture.store.replacements.length, 12);
  for (const replacement of fixture.store.replacements) {
    assert.equal(replacement.siteId, "site-a");
    assert.ok(replacement.rows.every((row) => row.siteId === "site-a"));
  }
  for (const kind of GSC_REPORT_KINDS) {
    const replacements = fixture.store.replacements.filter((input) => input.kind === kind);
    assert.deepEqual(identities(replacements[0]), identities(replacements[1]));
    assert.equal(new Set(identities(replacements[0])).size, 1);
  }
});

test("truncated report records counts and state but preserves the last good scope", async () => {
  const fixture = setup({ fetchReport: async (...args) => ({ ...report(args[3]), ...(args[3] === "query" ? { complete: false, truncatedAt: 250000 } : {}) }) });
  const result = await fixture.service.syncTarget(target, "MANUAL");
  assert.equal(result.status, "completed-with-warnings");
  assert.equal(result.reportCounts.query, 1);
  assert.deepEqual(result.warnings.map((warning) => warning.code), ["QUERY_TRUNCATED"]);
  assert.equal(fixture.store.replacements.length, 5);
  assert.ok(fixture.store.replacements.every((input) => input.kind !== "query"));
  assert.deepEqual(fixture.store.canonical.get("site-a:query"), ["last-good"]);
  assert.deepEqual(fixture.store.ready, []);
  assert.equal(fixture.store.finished[0].reportStates.query?.complete, false);
  assert.equal(fixture.store.finished[0].reportCounts.query, 1);
  assert.equal(fixture.store.finished[0].status, "COMPLETED_WITH_WARNINGS");
});

test("provider exceptions finish failed and release the lease without leaking provider data", async () => {
  const fixture = setup({ fetchReport: async () => { throw new Error("access_token=secret private-provider-body"); } });
  const result = await fixture.service.syncTarget(target, "MANUAL");
  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "PROVIDER_ERROR");
  assert.doesNotMatch(JSON.stringify([result, fixture.store.finished]), /secret|private-provider-body/);
  assert.equal(fixture.store.finished[0].status, "FAILED");
  assert.equal(fixture.store.leaseOwner, null);
  assert.deepEqual(fixture.store.ready, []);
});

test("coverage probe failure still records requested Pacific dates and a failed run", async () => {
  const fixture = setup({ now: () => new Date("2026-09-15T01:00:00.000Z"), probeCoverage: async () => { throw new ReauthRequiredError(); } });
  const result = await fixture.service.syncTarget(target, "INITIAL");
  assert.equal(result.status, "failed");
  assert.equal(result.runId, "run-1");
  assert.equal(result.error?.code, "REAUTH_REQUIRED");
  assert.deepEqual(fixture.store.runs[0].requestedRange, { startDate: "2026-06-14", endDate: "2026-09-11" });
  assert.equal(fixture.store.finished[0].effectiveRange, null);
  assert.deepEqual(fixture.requests, []);
  assert.equal(fixture.store.leaseOwner, null);
});

test("valid empty reports complete and mark only the target site ready", async () => {
  const fixture = setup({ fetchReport: async (...args) => ({ ...report(args[3]), rows: [] }) });
  const result = await fixture.service.syncTarget(target, "INITIAL");
  assert.equal(result.status, "completed");
  assert.deepEqual(fixture.store.ready, ["site-a"]);
  assert.equal(fixture.store.replacements.length, 6);
  assert.ok(Object.values(result.reportCounts).every((count) => count === 0));
});

test("report concurrency is two and in-flight failures settle before the lease releases", async () => {
  let active = 0;
  let peak = 0;
  let calls = 0;
  const fixture = setup({ fetchReport: async (...args) => {
    active += 1; calls += 1; peak = Math.max(peak, active);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    assert.equal(fixture.store.leaseOwner, "lease-owner-1");
    active -= 1;
    return report(args[3]);
  } });
  assert.equal((await fixture.service.syncTarget(target, "MANUAL")).status, "completed");
  assert.equal(peak, 2);
  assert.equal(calls, 6);
  assert.equal(active, 0);

  const failing = setup({ fetchReport: async (...args) => {
    if (args[3] === "dailyTotal") throw new Error("provider failure");
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    assert.equal(failing.store.leaseOwner, "lease-owner-1");
    return report(args[3]);
  } });
  assert.equal((await failing.service.syncTarget(target, "MANUAL")).status, "failed");
  assert.equal(failing.store.leaseOwner, null);
});

test("store failures also release leases and return sanitized errors", async () => {
  const fixture = setup();
  fixture.store.replaceReport = async () => { throw new Error("database-secret"); };
  const result = await fixture.service.syncTarget(target, "MANUAL");
  assert.equal(result.status, "failed");
  assert.equal(fixture.store.finished[0].status, "FAILED");
  assert.equal(fixture.store.leaseOwner, null);
  assert.doesNotMatch(JSON.stringify(result), /database-secret/);
});

test("run creation and failure-recording errors cannot skip lease release", async () => {
  const createFailure = setup();
  createFailure.store.createRun = async () => { throw new Error("database-secret"); };
  assert.equal((await createFailure.service.syncTarget(target, "INITIAL")).status, "failed");
  assert.equal(createFailure.store.leaseOwner, null);
  assert.deepEqual(createFailure.requests, []);
  const finishFailure = setup({ probeCoverage: async () => { throw new Error("provider-secret"); } });
  finishFailure.store.finishRun = async () => { throw new Error("database-secret"); };
  const result = await finishFailure.service.syncTarget(target, "INITIAL");
  assert.equal(result.status, "failed");
  assert.equal(finishFailure.store.leaseOwner, null);
  assert.doesNotMatch(JSON.stringify(result), /provider-secret|database-secret/);
});

test("expired owner cannot overwrite a newer completed import after lease takeover", async () => {
  let clock = new Date("2026-09-15T12:00:00.000Z");
  class TakeoverStore extends FakeStore {
    expiresAt = new Date(0);
    clicks = 0;
    async acquireLease(siteId: string, ownerId: string, expiresAt: Date) {
      if (this.expiresAt <= clock) this.leaseOwner = null;
      const acquired = await super.acquireLease(siteId, ownerId, expiresAt);
      if (acquired) this.expiresAt = expiresAt;
      return acquired;
    }
    async renewLease(_siteId: string, ownerId: string, expiresAt: Date) {
      if (this.leaseOwner !== ownerId || this.expiresAt <= clock) return false;
      this.expiresAt = expiresAt;
      return true;
    }
    async replaceReport(input: ReplaceGscReportInput) {
      this.clicks = input.rows[0]?.clicks ?? 0;
      return super.replaceReport(input);
    }
  }
  const store = new TakeoverStore();
  let signalPaused = () => {};
  let resumeOld = () => {};
  const paused = new Promise<void>((resolve) => { signalPaused = resolve; });
  const resume = new Promise<void>((resolve) => { resumeOld = resolve; });
  const makeService = (ownerId: string, clicks: number) => createGscSyncService({
    store, now: () => clock, randomId: () => ownerId,
    probeCoverage: async () => ({ finalizedThrough: "2026-09-12", source: "metadata" }),
    fetchReport: async (...args) => {
      if (ownerId === "old-owner" && args[3] === "dailyTotal") { signalPaused(); await resume; }
      return { ...report(args[3]), rows: report(args[3]).rows.map((row) => ({ ...row, clicks, impressions: 10 })) };
    },
  });
  const older = makeService("old-owner", 1).syncTarget(target, "INITIAL");
  await paused;
  clock = new Date("2026-09-15T12:31:00.000Z");
  const newer = await makeService("new-owner", 2).syncTarget(target, "INITIAL");
  assert.equal(newer.status, "completed");
  assert.equal(store.clicks, 2);
  resumeOld();
  const stale = await older;
  assert.equal(store.clicks, 2, "stale owner must preserve the newer canonical clicks");
  assert.equal(stale.status, "failed");
  assert.equal(stale.error?.code, "PROVIDER_ERROR");
  assert.deepEqual(store.ready, ["site-a"]);
  assert.equal(store.finished.find((run) => run.runId === "run-1")?.status, "FAILED");
  assert.equal(store.replacements.length, 6);
  assert.deepEqual(store.released.map((lease) => lease.ownerId), ["new-owner", "old-owner"]);
  assert.doesNotMatch(JSON.stringify(stale), /old-owner|new-owner/);
});

test("lease expiry during the final fetch fails even when every report is incomplete", async () => {
  let clock = now;
  const fixture = setup({ now: () => clock, fetchReport: async (...args) => {
    if (args[3] === "country") clock = new Date("2026-09-15T12:31:00.000Z");
    return { ...report(args[3]), complete: false, truncatedAt: 250000 };
  } });
  fixture.store.renewLease = async () => clock < new Date("2026-09-15T12:30:00.000Z");
  const result = await fixture.service.syncTarget(target, "MANUAL");
  assert.equal(result.status, "failed");
  assert.equal(fixture.store.finished[0].status, "FAILED");
  assert.equal(result.error?.code, "PROVIDER_ERROR");
  assert.deepEqual(fixture.store.replacements, []);
  assert.deepEqual(fixture.store.ready, []);
  assert.equal(fixture.store.leaseOwner, null);
});

test("Prisma canonical replacement and readiness atomically fence and renew the current unexpired owner", async (context) => {
  const events: string[] = [];
  let transactionActive = false;
  let activeOwner = "current-owner";
  let activeExpiry = new Date(Date.now() + 60_000);
  const proposedExpiry = new Date(Date.now() + 30 * 60_000);
  const lease = { ownerId: "current-owner", expiresAt: proposedExpiry };
  intercept(context, db, "$transaction", async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    events.push("begin"); transactionActive = true;
    try { const result = await callback(db); events.push("commit"); return result; }
    finally { transactionActive = false; }
  });
  intercept(context, db.gscSyncLease, "updateMany", async (input: { where: { siteId: string; ownerId: string; expiresAt: { gt: Date } }; data: { expiresAt: Date } }) => {
    assert.equal(transactionActive, true, "renewal must share the canonical write transaction");
    assert.equal(input.where.siteId, "site-a");
    assert.equal(input.where.ownerId, "current-owner");
    assert.ok(input.where.expiresAt.gt instanceof Date);
    assert.ok(Math.abs(Date.now() - input.where.expiresAt.gt.getTime()) < 1000);
    assert.deepEqual(input.data, { expiresAt: proposedExpiry });
    events.push("renew");
    if (activeOwner !== input.where.ownerId || activeExpiry <= input.where.expiresAt.gt) return { count: 0 };
    activeExpiry = input.data.expiresAt;
    return { count: 1 };
  });
  intercept(context, db.gscSyncRun, "findFirst", async () => ({ reportCounts: {}, reportStates: {} }));
  intercept(context, db.gscSyncRun, "update", async () => { events.push("run"); return {}; });
  intercept(context, db.gscDailyTotal, "deleteMany", async () => { events.push("delete"); return { count: 1 }; });
  intercept(context, db.gscDailyTotal, "createMany", async () => { events.push("insert"); return { count: 1 }; });
  intercept(context, db.site, "update", async () => { events.push("ready"); return {}; });
  const input = { ...report("dailyTotal"), siteId: "site-a", property: target.property, runId: "run-a", searchType: "web" as const, range: { startDate: "2026-09-06", endDate: "2026-09-12" }, rows: report("dailyTotal").rows.map((row) => ({ ...row, siteId: "site-a" })), lease };
  await prismaGscStore.replaceReport(input);
  assert.deepEqual(events, ["begin", "renew", "delete", "insert", "run", "commit"]);
  events.length = 0;
  await prismaGscStore.markSiteReady("site-a", now, lease, target.property);
  assert.deepEqual(events, ["begin", "renew", "ready", "commit"]);
  for (const invalidLease of ["different-owner", "expired"]) {
    activeOwner = invalidLease === "different-owner" ? "new-owner" : "current-owner";
    activeExpiry = invalidLease === "expired" ? new Date(0) : proposedExpiry;
    events.length = 0;
    await assert.rejects(prismaGscStore.replaceReport(input), { code: "PROVIDER_ERROR" });
    assert.deepEqual(events, ["begin", "renew"]);
    events.length = 0;
    await assert.rejects(prismaGscStore.markSiteReady("site-a", now, lease, target.property), { code: "PROVIDER_ERROR" });
    assert.deepEqual(events, ["begin", "renew"]);
  }
});

test("Prisma replacement confines all six tables to the target scope and one transaction", async (context) => {
  let transactionActive = false;
  let transactions = 0;
  const deletes: unknown[] = [];
  const writes: { data: Prisma.GscDailyTotalCreateManyInput[] }[] = [];
  const updates: unknown[] = [];
  intercept(context, db, "$transaction", async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    transactions += 1; transactionActive = true;
    try { return await callback(db); } finally { transactionActive = false; }
  });
  intercept(context, db.gscSyncRun, "findFirst", async (input: unknown) => {
    assert.equal(transactionActive, true);
    assert.deepEqual(input, { where: { id: "run-a", siteId: "site-a", property: target.property, searchType: "web" }, select: { reportCounts: true, reportStates: true } });
    return { reportCounts: null, reportStates: null };
  });
  intercept(context, db.gscSyncRun, "update", async (input: unknown) => { updates.push(input); return {}; });
  intercept(context, db.gscSyncLease, "updateMany", async () => ({ count: 1 }));
  for (const delegate of [db.gscDailyTotal, db.gscQueryDaily, db.gscPageDaily, db.gscQueryPageDaily, db.gscDeviceDaily, db.gscCountryDaily]) {
    intercept(context, delegate, "deleteMany", async (input: unknown) => {
      assert.equal(transactionActive, true); deletes.push(input); return { count: 1 };
    });
    intercept(context, delegate, "createMany", async (input: { data: Prisma.GscDailyTotalCreateManyInput[] }) => {
      assert.equal(transactionActive, true); writes.push(input); return { count: input.data.length };
    });
  }
  for (const kind of GSC_REPORT_KINDS) {
    assert.equal(await prismaGscStore.replaceReport({ siteId: "site-a", property: target.property, runId: "run-a", searchType: "web", lease: { ownerId: "owner-a", expiresAt: now }, range: { startDate: "2026-09-06", endDate: "2026-09-12" }, ...report(kind), rows: report(kind).rows.map((row) => ({ ...row, siteId: "attacker-site" })) }), 1);
  }
  assert.equal(transactions, 6);
  assert.equal(deletes.length, 6);
  assert.equal(writes.length, 6);
  assert.equal(updates.length, 6);
  for (const input of deletes) assert.deepEqual(input, { where: { siteId: "site-a", property: target.property, searchType: "web", date: { gte: new Date("2026-09-06T00:00:00.000Z"), lte: new Date("2026-09-12T00:00:00.000Z") } } });
  for (const write of writes) {
    assert.equal(write.data[0].siteId, "site-a");
    assert.equal(write.data[0].syncRunId, "run-a");
    assert.equal(write.data[0].searchType, "web");
    assert.deepEqual(write.data[0].date, new Date("2026-09-12T00:00:00.000Z"));
  }
});

test("Prisma incomplete replacement writes only run count/state and preserves canonical tables", async (context) => {
  const updates: unknown[] = [];
  intercept(context, db, "$transaction", async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => callback(db));
  intercept(context, db.gscSyncRun, "findFirst", async () => ({ reportCounts: { page: 3 }, reportStates: {} }));
  intercept(context, db.gscSyncRun, "update", async (input: unknown) => { updates.push(input); return {}; });
  for (const delegate of [db.gscDailyTotal, db.gscQueryDaily, db.gscPageDaily, db.gscQueryPageDaily, db.gscDeviceDaily, db.gscCountryDaily]) {
    intercept(context, delegate, "deleteMany", async () => assert.fail("Incomplete reports must not delete canonical rows"));
    intercept(context, delegate, "createMany", async () => assert.fail("Incomplete reports must not insert canonical rows"));
  }
  const count = await prismaGscStore.replaceReport({ ...report("query"), siteId: "site-a", property: target.property, runId: "run-a", searchType: "web", lease: { ownerId: "owner-a", expiresAt: now }, range: { startDate: "2026-09-06", endDate: "2026-09-12" }, rows: report("query").rows.map((row) => ({ ...row, siteId: "attacker-site" })), complete: false, truncatedAt: 250000 });
  assert.equal(count, 0);
  assert.deepEqual(updates, [{ where: { id: "run-a", siteId: "site-a" }, data: { reportCounts: { page: 3, query: 1 }, reportStates: { query: { complete: false, pagesFetched: 1, truncatedAt: 250000 } } } }]);
});

test("Prisma leases expire only the target lease and release only its matching owner", async (context) => {
  const events: { action: string; input: unknown }[] = [];
  intercept(context, db, "$transaction", async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => { events.push({ action: "transaction", input: null }); return callback(db); });
  intercept(context, db.gscSyncLease, "deleteMany", async (input: unknown) => { events.push({ action: "delete", input }); return { count: 0 }; });
  let duplicate = false;
  intercept(context, db.gscSyncLease, "create", async (input: unknown) => {
    if (duplicate) throw new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "6.19.3" });
    events.push({ action: "create", input }); return {};
  });
  assert.equal(await prismaGscStore.acquireLease("site-a", "owner-a", now), true);
  await prismaGscStore.releaseLease("site-a", "owner-a");
  assert.deepEqual(events.map((event) => event.action), ["transaction", "delete", "create", "delete"]);
  assert.equal(JSON.stringify(events[1].input).includes('"siteId":"site-a"'), true);
  assert.match(JSON.stringify(events[1].input), /"expiresAt":\{"lte":/);
  assert.deepEqual(events[2].input, { data: { siteId: "site-a", ownerId: "owner-a", expiresAt: now } });
  assert.deepEqual(events[3].input, { where: { siteId: "site-a", ownerId: "owner-a" } });
  duplicate = true;
  assert.equal(await prismaGscStore.acquireLease("site-a", "owner-b", now), false);
});

test("Prisma ownership resolution rejects foreign sites and readiness updates one site", async (context) => {
  const updates: unknown[] = [];
  intercept(context, db, "$transaction", async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => callback(db));
  intercept(context, db.gscSyncLease, "updateMany", async () => ({ count: 1 }));
  intercept(context, db.site, "findUnique", async () => ({ id: "site-a", userId: "user-a", gscProperty: target.property, gscSearchType: "web", gscDataVersion: 1 }));
  intercept(context, db.site, "update", async (input: unknown) => { updates.push(input); return {}; });
  await assert.rejects(prismaGscStore.resolveOwnedTarget("user-b", "site-a"), { code: "UNAUTHORIZED" });
  assert.deepEqual(await prismaGscStore.resolveOwnedTarget("user-a", "site-a"), target);
  await prismaGscStore.markSiteReady("site-a", now, { ownerId: "owner-a", expiresAt: now }, target.property);
  assert.deepEqual(updates, [{ where: { id: "site-a", gscProperty: target.property }, data: { gscDataVersion: 2, lastGscSyncAt: now } }]);
});
