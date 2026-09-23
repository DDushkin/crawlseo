import { db } from "@/lib/db";
import { toDbDate } from "@/lib/gsc/date-range";
import { hasCompleteGscReportCoverage } from "@/lib/seo-metrics";
import {
  readGscMetricWindow,
  type CompletionStore,
  type EvaluationStore,
  type GscMetricReader,
  type MetricScope,
} from "./outcomes";

export const prismaGscMetricReader: GscMetricReader = {
  async siteScope(siteId) {
    const site = await db.site.findUnique({ where: { id: siteId }, select: { gscProperty: true, gscSearchType: true } });
    return site?.gscProperty ? { property: site.gscProperty, searchType: site.gscSearchType } : null;
  },
  completeCoverage(siteId, report, range) {
    return hasCompleteGscReportCoverage(siteId, report === "total" ? "dailyTotal" : report, range);
  },
  async sumMetrics(scope, siteId, property, searchType, key, range) {
    const common = {
      siteId, property, searchType,
      date: { gte: toDbDate(range.startDate), lte: toDbDate(range.endDate) },
    };
    if (scope === "PAGE") {
      const row = await db.gscPageDaily.aggregate({ where: { ...common, url: key! }, _sum: { clicks: true, impressions: true } });
      return row._sum;
    }
    if (scope === "QUERY") {
      const row = await db.gscQueryDaily.aggregate({ where: { ...common, query: key! }, _sum: { clicks: true, impressions: true } });
      return row._sum;
    }
    const row = await db.gscDailyTotal.aggregate({ where: common, _sum: { clicks: true, impressions: true } });
    return row._sum;
  },
};

export const prismaCompletionStore: CompletionStore = {
  findAction(siteId, actionId) {
    return db.seoAction.findFirst({
      where: { id: actionId, siteId },
      select: { id: true, siteId: true, status: true, pageUrl: true, query: true },
    });
  },
  readMetrics(siteId, scope, key, range) {
    return readGscMetricWindow(siteId, scope, key, range, prismaGscMetricReader);
  },
  saveCompletion(input) {
    return db.$transaction(async (tx) => {
      const updated = await tx.seoAction.updateMany({
        where: { id: input.actionId, siteId: input.siteId, status: { in: ["NEW", "PLANNED", "IN_PROGRESS"] } },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      if (updated.count !== 1) throw new Error("Action status changed during completion");
      return tx.seoChange.create({
        data: {
          siteId: input.siteId, actionId: input.actionId,
          description: input.description, changedAt: toDbDate(input.changedAt),
          metricScope: input.metricScope, metricKey: input.metricKey,
          baselineStart: toDbDate(input.baselineStart), baselineEnd: toDbDate(input.baselineEnd),
          afterStart: toDbDate(input.afterStart), afterEnd: toDbDate(input.afterEnd),
          baselineClicks: input.baselineClicks, baselineImpressions: input.baselineImpressions,
        },
        select: { id: true },
      });
    });
  },
};

export const prismaEvaluationStore: EvaluationStore = {
  async listPending(siteId) {
    const changes = await db.seoChange.findMany({
      where: { siteId, outcome: { is: null } },
      orderBy: { afterEnd: "asc" },
      take: 100,
      select: {
        id: true, siteId: true, actionId: true, metricScope: true, metricKey: true,
        afterStart: true, afterEnd: true, baselineClicks: true, baselineImpressions: true,
      },
    });
    return changes.map((change) => {
      if (!["PAGE", "QUERY", "PROPERTY"].includes(change.metricScope)) throw new Error("Unknown SEO change metric scope");
      return {
        ...change, metricScope: change.metricScope as MetricScope,
        afterStart: change.afterStart.toISOString().slice(0, 10),
        afterEnd: change.afterEnd.toISOString().slice(0, 10),
      };
    });
  },
  readMetrics(siteId, scope, key, range) {
    return readGscMetricWindow(siteId, scope, key, range, prismaGscMetricReader);
  },
  async saveOutcome(input) {
    const ownedChange = await db.seoChange.findFirst({
      where: { id: input.changeId, siteId: input.siteId, actionId: input.actionId },
      select: { id: true },
    });
    if (!ownedChange) throw new Error("SEO change not found");
    return db.seoOutcome.upsert({
      where: { changeId: input.changeId },
      create: {
        siteId: input.siteId, actionId: input.actionId, changeId: input.changeId,
        status: input.status, afterClicks: input.afterClicks, afterImpressions: input.afterImpressions,
        clickDelta: input.clickDelta, clickChangePct: input.clickChangePct,
        impressionDelta: input.impressionDelta, qualification: input.qualification,
      },
      update: {},
      select: { id: true },
    });
  },
};
