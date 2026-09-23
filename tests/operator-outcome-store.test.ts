import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { db } from "../lib/db";
import { prismaGscMetricReader, prismaCompletionStore, prismaEvaluationStore } from "../lib/operator/outcome-store";

function intercept(t: TestContext, target: object, method: string, fn: (...args: never[]) => unknown) {
  const original = Object.getOwnPropertyDescriptor(target, method);
  Object.defineProperty(target, method, { configurable: true, value: fn });
  t.after(() => { if (original) Object.defineProperty(target, method, original); else Reflect.deleteProperty(target, method); });
}

test("page outcome reads only that site's property, search type, URL and date range", async (t) => {
  intercept(t, db.gscPageDaily, "aggregate", async (args: { where: Record<string, unknown> }) => {
    assert.deepEqual(args.where, {
      siteId: "site-1", property: "sc-domain:strum.capital", searchType: "web",
      url: "https://www.strum.capital/features/ovdp-tracker/",
      date: { gte: new Date("2026-08-01T00:00:00.000Z"), lte: new Date("2026-08-28T00:00:00.000Z") },
    });
    return { _sum: { clicks: 40, impressions: 300 } };
  });
  const result = await prismaGscMetricReader.sumMetrics("PAGE", "site-1", "sc-domain:strum.capital", "web", "https://www.strum.capital/features/ovdp-tracker/", { startDate: "2026-08-01", endDate: "2026-08-28" });
  assert.deepEqual(result, { clicks: 40, impressions: 300 });
});

test("outcome reader refuses V2 metric reads during legacy rollback or before a V2 sync", async (t) => {
  let version = 1;
  intercept(t, db.site, "findUnique", async () => ({ gscProperty: "sc-domain:strum.capital", gscSearchType: "web", gscDataVersion: version }));
  assert.equal(await prismaGscMetricReader.siteScope("site-1"), null);
  version = 2;
  const previous = process.env.GSC_READ_MODEL_V2;
  process.env.GSC_READ_MODEL_V2 = "false";
  t.after(() => { if (previous === undefined) delete process.env.GSC_READ_MODEL_V2; else process.env.GSC_READ_MODEL_V2 = previous; });
  assert.equal(await prismaGscMetricReader.siteScope("site-1"), null);
});

test("completion refuses a stale status inside its transaction", async (t) => {
  intercept(t, db, "$transaction", async (fn: (tx: object) => Promise<unknown>) => fn({
    seoAction: { updateMany: async () => ({ count: 0 }) },
    seoChange: { create: async () => { throw new Error("stale action wrote a change"); } },
  }));
  await assert.rejects(prismaCompletionStore.saveCompletion({
    siteId: "site-1", actionId: "action-1", description: "Updated page", changedAt: "2026-09-23",
    metricScope: "PAGE", metricKey: "https://www.strum.capital/a",
    baselineStart: "2026-08-24", baselineEnd: "2026-09-20", afterStart: "2026-09-25", afterEnd: "2026-10-22",
    baselineClicks: 40, baselineImpressions: 300,
  }), /status changed/i);
});

test("evaluation selects only pending changes for the requested site", async (t) => {
  intercept(t, db.seoChange, "findMany", async (args: { where: Record<string, unknown> }) => {
    assert.deepEqual(args.where, { siteId: "site-1", outcome: { is: null } });
    assert.equal("take" in args, false, "missing old baselines must not starve later changes");
    return [{ id: "change-1", siteId: "site-1", actionId: "action-1", metricScope: "PAGE", metricKey: "https://www.strum.capital/a",
      baselineStart: new Date("2026-08-24T00:00:00.000Z"), baselineEnd: new Date("2026-09-20T00:00:00.000Z"),
      afterStart: new Date("2026-09-25T00:00:00.000Z"), afterEnd: new Date("2026-10-22T00:00:00.000Z"), baselineClicks: 40, baselineImpressions: 300 }];
  });
  const changes = await prismaEvaluationStore.listPending("site-1");
  assert.equal(changes[0].afterEnd, "2026-10-22");
});

test("outcome save is idempotent on change ID and site-scoped", async (t) => {
  intercept(t, db.seoChange, "findFirst", async (args: { where: Record<string, unknown> }) => {
    assert.deepEqual(args.where, { id: "change-1", siteId: "site-1", actionId: "action-1" });
    return { id: "change-1" };
  });
  intercept(t, db.seoOutcome, "upsert", async (args: { where: { changeId: string }; create: { siteId: string; actionId: string } }) => {
    assert.equal(args.where.changeId, "change-1");
    assert.deepEqual([args.create.siteId, args.create.actionId], ["site-1", "action-1"]);
    return { id: "outcome-1" };
  });
  const result = await prismaEvaluationStore.saveOutcome({
    siteId: "site-1", actionId: "action-1", changeId: "change-1", status: "OBSERVED",
    afterClicks: 50, afterImpressions: 350, clickDelta: 10, clickChangePct: 25,
    impressionDelta: 50, qualification: "The change preceded this difference; other factors may have contributed.",
  });
  assert.deepEqual(result, { id: "outcome-1" });
});
