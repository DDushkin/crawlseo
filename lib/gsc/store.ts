import { Prisma, type GscSyncStatus, type GscSyncTrigger } from "@prisma/client";
import { db } from "../db";
import { toDbDate } from "./date-range";
import type { GscReconciliation, GscReportStates } from "./reconciliation";
import type { GscDateRange, GscMetricRow, GscReportKind } from "./types";
import { normalizeObservedSitePageUrls } from "../operator/pages";

export type { GscSyncTrigger } from "@prisma/client";
export type GscSyncErrorCode = "NOT_FOUND" | "UNAUTHORIZED" | "NO_PROPERTY" | "REAUTH_REQUIRED" | "PROVIDER_ERROR";
export class GscSyncError extends Error {
  constructor(public readonly code: GscSyncErrorCode, message: string) {
    super(message);
    this.name = "GscSyncError";
  }
}

export type GscSyncTarget = {
  siteId: string;
  userId: string;
  property: string;
  searchType: "web";
  dataVersion: number;
};

export type CreateGscRunInput = {
  siteId: string;
  property: string;
  trigger: GscSyncTrigger;
  searchType: "web";
  requestedRange: GscDateRange;
  startedAt: Date;
};
export type GscLeaseRenewal = { ownerId: string; expiresAt: Date };
export type ReplaceGscReportInput = {
  siteId: string;
  property: string;
  runId: string;
  searchType: "web";
  range: GscDateRange;
  kind: GscReportKind;
  rows: (GscMetricRow & { siteId: string })[];
  complete: boolean;
  pagesFetched: number;
  truncatedAt: number | null;
  lease: GscLeaseRenewal;
};
export type FinishGscRunInput = {
  siteId: string;
  runId: string;
  status: Exclude<GscSyncStatus, "RUNNING">;
  effectiveRange: GscDateRange | null;
  reportCounts: Record<GscReportKind, number>;
  reportStates: GscReportStates;
  reconciliation: GscReconciliation | null;
  error?: { code: GscSyncErrorCode; message: string };
  finishedAt: Date;
};

export interface GscStore {
  resolveOwnedTarget(userId: string, siteId: string): Promise<GscSyncTarget>;
  listScheduledTargets(): Promise<GscSyncTarget[]>;
  acquireLease(siteId: string, ownerId: string, expiresAt: Date): Promise<boolean>;
  renewLease(siteId: string, ownerId: string, expiresAt: Date): Promise<boolean>;
  releaseLease(siteId: string, ownerId: string): Promise<void>;
  createRun(input: CreateGscRunInput): Promise<string>;
  replaceReport(input: ReplaceGscReportInput): Promise<number>;
  finishRun(input: FinishGscRunInput): Promise<void>;
  markSiteReady(siteId: string, syncedAt: Date, lease: GscLeaseRenewal, property: string): Promise<void>;
}

function dimension(value: string | undefined): string {
  if (value === undefined) throw new GscSyncError("PROVIDER_ERROR", "A report dimension is missing.");
  return value;
}

async function renewCurrentLease(client: Pick<Prisma.TransactionClient, "gscSyncLease">, siteId: string, lease: GscLeaseRenewal): Promise<boolean> {
  const renewed = await client.gscSyncLease.updateMany({
    where: { siteId, ownerId: lease.ownerId, expiresAt: { gt: new Date() } },
    data: { expiresAt: lease.expiresAt },
  });
  return renewed.count === 1;
}

async function fenceCanonicalWrite(tx: Prisma.TransactionClient, siteId: string, lease: GscLeaseRenewal): Promise<void> {
  // The conditional UPDATE locks this lease row until the canonical transaction
  // commits, so an expired-lease takeover cannot slip between this check and write.
  if (!await renewCurrentLease(tx, siteId, lease)) {
    throw new GscSyncError("PROVIDER_ERROR", "The synchronization lease is no longer owned by this run.");
  }
}

async function recordReportCoverage(tx: Prisma.TransactionClient, input: ReplaceGscReportInput): Promise<void> {
  const key = { siteId: input.siteId, property: input.property, searchType: input.searchType, reportKind: input.kind };
  const previous = await tx.gscReportCoverage.findFirst({
    where: { ...key, syncRun: { property: input.property } },
    select: { startDate: true, endDate: true },
  });
  let startDate = toDbDate(input.range.startDate);
  let endDate = toDbDate(input.range.endDate);
  if (startDate > endDate) throw new GscSyncError("PROVIDER_ERROR", "A report range is invalid.");
  if (previous) {
    const adjacent = startDate.getTime() <= previous.endDate.getTime() + 86_400_000 &&
      endDate.getTime() >= previous.startDate.getTime() - 86_400_000;
    if (adjacent) {
      if (previous.startDate < startDate) startDate = previous.startDate;
      if (previous.endDate > endDate) endDate = previous.endDate;
    } else if (endDate < previous.endDate) {
      // Keep the newer continuous interval and its originating run.
      return;
    }
  }
  const data = { startDate, endDate, syncRunId: input.runId };
  await tx.gscReportCoverage.upsert({
    where: { siteId_property_searchType_reportKind: key },
    create: { ...key, ...data }, update: data,
  });
}

export const prismaGscStore: GscStore = {
  async resolveOwnedTarget(userId, siteId) {
    const site = await db.site.findUnique({ where: { id: siteId }, select: {
      id: true, userId: true, gscProperty: true, gscSearchType: true, gscDataVersion: true,
    } });
    if (!site) throw new GscSyncError("NOT_FOUND", "Site was not found.");
    if (site.userId !== userId) throw new GscSyncError("UNAUTHORIZED", "You do not own this site.");
    if (!site.gscProperty) throw new GscSyncError("NO_PROPERTY", "Connect a Search Console property first.");
    if (site.gscSearchType !== "web") throw new GscSyncError("PROVIDER_ERROR", "Only web search is supported.");
    return { siteId: site.id, userId: site.userId, property: site.gscProperty, searchType: "web", dataVersion: site.gscDataVersion };
  },

  async listScheduledTargets() {
    const sites = await db.site.findMany({ where: { gscProperty: { not: null }, gscSearchType: "web" }, select: {
      id: true, userId: true, gscProperty: true, gscDataVersion: true,
    } });
    return sites.flatMap((site) => site.gscProperty ? [{ siteId: site.id, userId: site.userId, property: site.gscProperty, searchType: "web" as const, dataVersion: site.gscDataVersion }] : []);
  },

  async acquireLease(siteId, ownerId, expiresAt) {
    try {
      await db.$transaction(async (tx) => {
        await tx.gscSyncLease.deleteMany({ where: { siteId, expiresAt: { lte: new Date() } } });
        await tx.gscSyncLease.create({ data: { siteId, ownerId, expiresAt } });
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
      throw error;
    }
  },

  async releaseLease(siteId, ownerId) {
    await db.gscSyncLease.deleteMany({ where: { siteId, ownerId } });
  },

  async renewLease(siteId, ownerId, expiresAt) {
    return renewCurrentLease(db, siteId, { ownerId, expiresAt });
  },

  async createRun(input) {
    const run = await db.gscSyncRun.create({ data: {
      siteId: input.siteId, property: input.property, trigger: input.trigger, searchType: input.searchType,
      requestedStart: toDbDate(input.requestedRange.startDate), requestedEnd: toDbDate(input.requestedRange.endDate),
      dataState: "final", startedAt: input.startedAt,
    }, select: { id: true } });
    return run.id;
  },

  async replaceReport(input) {
    return db.$transaction(async (tx) => {
      if (input.complete) await fenceCanonicalWrite(tx, input.siteId, input.lease);
      const run = await tx.gscSyncRun.findFirst({ where: { id: input.runId, siteId: input.siteId, property: input.property, searchType: input.searchType }, select: { reportCounts: true, reportStates: true } });
      if (!run) throw new GscSyncError("NOT_FOUND", "Sync run was not found for this site.");
      if (input.complete) {
        const where = { siteId: input.siteId, property: input.property, searchType: input.searchType, date: { gte: toDbDate(input.range.startDate), lte: toDbDate(input.range.endDate) } };
        const rows = input.rows.map((row) => {
          if (row.date < input.range.startDate || row.date > input.range.endDate) throw new GscSyncError("PROVIDER_ERROR", "A report date is outside the requested range.");
          return { siteId: input.siteId, property: input.property, searchType: input.searchType, syncRunId: input.runId, date: toDbDate(row.date), clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position };
        });
        // Keep each delegate concrete so generated Prisma types validate every table's dimensions.
        switch (input.kind) {
          case "dailyTotal":
            await tx.gscDailyTotal.deleteMany({ where });
            if (rows.length) await tx.gscDailyTotal.createMany({ data: rows });
            break;
          case "query":
            await tx.gscQueryDaily.deleteMany({ where });
            if (rows.length) await tx.gscQueryDaily.createMany({ data: rows.map((row, i) => ({ ...row, query: dimension(input.rows[i].query) })) });
            break;
          case "page":
            await tx.gscPageDaily.deleteMany({ where });
            if (rows.length) await tx.gscPageDaily.createMany({ data: rows.map((row, i) => ({ ...row, url: dimension(input.rows[i].url) })) });
            if (input.rows.some((row) => row.url?.startsWith("https://"))) {
              const site = await tx.site.findUniqueOrThrow({ where: { id: input.siteId }, select: { domain: true } });
              const urls = normalizeObservedSitePageUrls(site.domain, input.rows.map((row) => dimension(row.url)));
              if (urls.length) await tx.sitePage.createMany({ data: urls.map((url) => ({ siteId: input.siteId, url })), skipDuplicates: true });
            }
            break;
          case "queryPage":
            await tx.gscQueryPageDaily.deleteMany({ where });
            if (rows.length) await tx.gscQueryPageDaily.createMany({ data: rows.map((row, i) => ({ ...row, query: dimension(input.rows[i].query), url: dimension(input.rows[i].url) })) });
            break;
          case "device":
            await tx.gscDeviceDaily.deleteMany({ where });
            if (rows.length) await tx.gscDeviceDaily.createMany({ data: rows.map((row, i) => ({ ...row, device: dimension(input.rows[i].device) })) });
            break;
          case "country":
            await tx.gscCountryDaily.deleteMany({ where });
            if (rows.length) await tx.gscCountryDaily.createMany({ data: rows.map((row, i) => ({ ...row, country: dimension(input.rows[i].country) })) });
            break;
        }
        await recordReportCoverage(tx, input);
      }
      const oldCounts = run.reportCounts && typeof run.reportCounts === "object" && !Array.isArray(run.reportCounts) ? run.reportCounts : {};
      const oldStates = run.reportStates && typeof run.reportStates === "object" && !Array.isArray(run.reportStates) ? run.reportStates : {};
      await tx.gscSyncRun.update({ where: { id: input.runId, siteId: input.siteId }, data: {
        reportCounts: { ...oldCounts, [input.kind]: input.rows.length },
        reportStates: { ...oldStates, [input.kind]: { complete: input.complete, pagesFetched: input.pagesFetched, truncatedAt: input.truncatedAt } },
      } });
      return input.complete ? input.rows.length : 0;
    });
  },

  async finishRun(input) {
    await db.gscSyncRun.update({ where: { id: input.runId, siteId: input.siteId }, data: {
      status: input.status,
      effectiveStart: input.effectiveRange ? toDbDate(input.effectiveRange.startDate) : null,
      effectiveEnd: input.effectiveRange ? toDbDate(input.effectiveRange.endDate) : null,
      reportCounts: input.reportCounts, reportStates: input.reportStates,
      reconciliation: input.reconciliation ?? Prisma.DbNull,
      errorCode: input.error?.code ?? null, errorMessage: input.error?.message ?? null,
      finishedAt: input.finishedAt,
    } });
  },

  async markSiteReady(siteId, syncedAt, lease, property) {
    await db.$transaction(async (tx) => {
      await fenceCanonicalWrite(tx, siteId, lease);
      await tx.site.update({ where: { id: siteId, gscProperty: property }, data: { gscDataVersion: 2, lastGscSyncAt: syncedAt } });
    });
  },
};
