import { db } from "@/lib/db";
import { getDateRange } from "@/lib/date-utils";
import * as v2 from "@/lib/gsc/read-model";
import { aggregatePageRows, aggregatePeriodRows, aggregateQueryRows, comparePeriods, emptyGscPeriodMetrics, shouldUseGscV2, storedRangeEnding } from "@/lib/gsc/read-model";
import { aggregateGscMetrics } from "@/lib/gsc/aggregate";
import { previousDateRange, toDbDate } from "@/lib/gsc/date-range";
import type { GscDateRange, GscReportKind } from "@/lib/gsc/types";
import type { DailyTraffic, GscReadScope, KeywordRow, PageRow, PeriodMetrics } from "@/lib/gsc/read-model";
export type { DailyTraffic, KeywordRow, PageRow, PeriodMetrics } from "@/lib/gsc/read-model";

function parseRange(days: number) {
  const { start, end } = getDateRange(days);
  return {
    start: new Date(`${start}T00:00:00.000Z`),
    end: new Date(`${end}T23:59:59.999Z`),
  };
}

function previousRange(days: number) {
  const current = parseRange(days);
  const start = new Date(current.start);
  start.setUTCDate(start.getUTCDate() - days);
  const end = new Date(current.start);
  end.setUTCMilliseconds(end.getUTCMilliseconds() - 1);
  return { start, end };
}

/** Impression-weighted average position */
function weightedPosition(
  rows: { position: number; impressions: number }[]
): number {
  let weighted = 0;
  let weight = 0;
  for (const row of rows) {
    const w = Math.max(row.impressions, 0);
    weighted += row.position * w;
    weight += w;
  }
  if (weight === 0) {
    if (rows.length === 0) return 0;
    return rows.reduce((s, r) => s + r.position, 0) / rows.length;
  }
  return weighted / weight;
}

function aggregatePeriod(
  rows: { clicks: number; impressions: number; position: number; query?: string }[]
): PeriodMetrics {
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const queries = new Set(rows.map((r) => r.query).filter(Boolean));
  return {
    clicks,
    impressions,
    avgPosition: impressions > 0 ? weightedPosition(rows) : null,
    avgCtr: impressions > 0 ? clicks / impressions : null,
    uniqueKeywords: queries.size,
    startDate: null,
    endDate: null,
  };
}

async function legacyGetSitePeriodMetrics(
  siteId: string,
  days = 28
): Promise<{
  current: PeriodMetrics;
  previous: PeriodMetrics;
  deltas: {
    clicks: number;
    impressions: number;
    avgPosition: number | null;
    avgCtr: number | null;
  };
}> {
  const currentRange = parseRange(days);
  const prevRange = previousRange(days);

  const [currentRows, previousRows] = await Promise.all([
    db.keyword.findMany({
      where: {
        siteId,
        date: { gte: currentRange.start, lte: currentRange.end },
      },
      select: {
        query: true,
        clicks: true,
        impressions: true,
        position: true,
      },
    }),
    db.keyword.findMany({
      where: {
        siteId,
        date: { gte: prevRange.start, lte: prevRange.end },
      },
      select: {
        query: true,
        clicks: true,
        impressions: true,
        position: true,
      },
    }),
  ]);

  const current = aggregatePeriod(currentRows);
  const previous = aggregatePeriod(previousRows);
  current.startDate = currentRange.start.toISOString().slice(0, 10);
  current.endDate = currentRange.end.toISOString().slice(0, 10);
  previous.startDate = prevRange.start.toISOString().slice(0, 10);
  previous.endDate = prevRange.end.toISOString().slice(0, 10);
  return comparePeriods(current, previous);
}

/** Aggregate keyword rows across the period (sum metrics, weighted position). */
async function legacyGetTopKeywords(
  siteId: string,
  days = 28,
  limit = 50
): Promise<KeywordRow[]> {
  const range = parseRange(days);
  const rows = await db.keyword.findMany({
    where: {
      siteId,
      date: { gte: range.start, lte: range.end },
    },
    select: {
      query: true,
      clicks: true,
      impressions: true,
      position: true,
    },
  });

  const byQuery = new Map<
    string,
    { clicks: number; impressions: number; weightedPos: number }
  >();

  for (const row of rows) {
    const existing = byQuery.get(row.query) ?? {
      clicks: 0,
      impressions: 0,
      weightedPos: 0,
    };
    existing.clicks += row.clicks;
    existing.impressions += row.impressions;
    existing.weightedPos += row.position * Math.max(row.impressions, 1);
    byQuery.set(row.query, existing);
  }

  return Array.from(byQuery.entries())
    .map(([query, data]) => {
      const weight = Math.max(data.impressions, 1);
      const position = data.impressions > 0 ? data.weightedPos / weight : null;
      const ctr = data.impressions > 0 ? data.clicks / data.impressions : null;
      return {
        query,
        clicks: data.clicks,
        impressions: data.impressions,
        position,
        ctr,
      };
    })
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, limit);
}

async function legacyGetTopPages(
  siteId: string,
  days = 28,
  limit = 50
): Promise<PageRow[]> {
  const range = parseRange(days);
  const rows = await db.page.findMany({
    where: {
      siteId,
      date: { gte: range.start, lte: range.end },
    },
    select: {
      url: true,
      clicks: true,
      impressions: true,
      position: true,
    },
  });

  const byUrl = new Map<
    string,
    { clicks: number; impressions: number; weightedPos: number }
  >();

  for (const row of rows) {
    const existing = byUrl.get(row.url) ?? {
      clicks: 0,
      impressions: 0,
      weightedPos: 0,
    };
    existing.clicks += row.clicks;
    existing.impressions += row.impressions;
    existing.weightedPos += row.position * Math.max(row.impressions, 1);
    byUrl.set(row.url, existing);
  }

  return Array.from(byUrl.entries())
    .map(([url, data]) => {
      const weight = Math.max(data.impressions, 1);
      const position = data.impressions > 0 ? data.weightedPos / weight : null;
      const ctr = data.impressions > 0 ? data.clicks / data.impressions : null;
      return {
        url,
        clicks: data.clicks,
        impressions: data.impressions,
        position,
        ctr,
      };
    })
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, limit);
}

async function legacyGetDailyTraffic(
  siteId: string,
  days = 90
): Promise<DailyTraffic[]> {
  const range = parseRange(days);

  // Prefer page-level rows when present (cleaner site totals);
  // fall back to keyword rows.
  const pages = await db.page.findMany({
    where: {
      siteId,
      date: { gte: range.start, lte: range.end },
    },
    select: { date: true, clicks: true, impressions: true },
    orderBy: { date: "asc" },
  });

  const source =
    pages.length > 0
      ? pages
      : await db.keyword.findMany({
          where: {
            siteId,
            date: { gte: range.start, lte: range.end },
          },
          select: { date: true, clicks: true, impressions: true },
          orderBy: { date: "asc" },
        });

  const aggregated = new Map<string, { clicks: number; impressions: number }>();

  for (const row of source) {
    const dateStr = row.date.toISOString().slice(0, 10);
    const current = aggregated.get(dateStr) ?? { clicks: 0, impressions: 0 };
    current.clicks += row.clicks;
    current.impressions += row.impressions;
    aggregated.set(dateStr, current);
  }

  return Array.from(aggregated.entries())
    .map(([date, metrics]) => ({ date, ...metrics }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getSitePeriodMetrics(siteId: string, days = 28) {
  const context = await getGscReadContext(siteId);
  if (!context.available) return emptyGscPeriodMetrics();
  if (!context.useV2) return legacyGetSitePeriodMetrics(siteId, days);
  const range = await storedRangeFor(context, days);
  return range ? v2.getV2GscPeriodMetrics(context.scope, range) : emptyGscPeriodMetrics();
}

export async function getTopKeywords(siteId: string, days = 28, limit = 50): Promise<KeywordRow[]> {
  const context = await getGscReadContext(siteId);
  if (!context.available) return [];
  if (!context.useV2) return legacyGetTopKeywords(siteId, days, limit);
  const range = await storedRangeFor(context, days);
  return range ? v2.getV2GscTopQueries(context.scope, range, limit) : [];
}

export async function getTopPages(siteId: string, days = 28, limit = 50): Promise<PageRow[]> {
  const context = await getGscReadContext(siteId);
  if (!context.available) return [];
  if (!context.useV2) return legacyGetTopPages(siteId, days, limit);
  const range = await storedRangeFor(context, days);
  return range ? v2.getV2GscTopPages(context.scope, range, limit) : [];
}

export async function getDailyTraffic(siteId: string, days = 90): Promise<DailyTraffic[]> {
  const context = await getGscReadContext(siteId);
  if (!context.available) return [];
  if (!context.useV2) return legacyGetDailyTraffic(siteId, days);
  const range = await storedRangeFor(context, days);
  return range ? v2.getV2GscDailyTraffic(context.scope, range) : [];
}

type ReadContext = { scope: GscReadScope; useV2: boolean; available: boolean };

async function getGscReadContext(siteId: string): Promise<ReadContext> {
  const site = await db.site.findUnique({ where: { id: siteId }, select: { gscDataVersion: true, gscSearchType: true, gscProperty: true, gscLegacyProperty: true } });
  const useV2 = shouldUseGscV2(site?.gscDataVersion ?? 1, process.env.GSC_READ_MODEL_V2);
  return {
    scope: { siteId, property: site?.gscProperty ?? "", searchType: site?.gscSearchType ?? "web" },
    useV2,
    available: Boolean(site?.gscProperty) && (useV2 || site?.gscProperty === site?.gscLegacyProperty),
  };
}

function legacyWhere(siteId: string, range: GscDateRange) {
  if (range.startDate > range.endDate) throw new Error("GSC range start must precede end");
  return { siteId, date: { gte: toDbDate(range.startDate), lte: new Date(toDbDate(range.endDate).getTime() + 86_400_000 - 1) } };
}

async function storedRangeFor(context: ReadContext, days: number): Promise<GscDateRange | null> {
  if (!context.available) return null;
  if (context.useV2) return v2.getV2StoredGscRange(context.scope, days);
  const latest = await db.keyword.findFirst({ where: { siteId: context.scope.siteId }, orderBy: { date: "desc" }, select: { date: true } });
  return latest ? storedRangeEnding(latest.date.toISOString().slice(0, 10), days) : null;
}

export async function getStoredGscRange(siteId: string, days = 28): Promise<GscDateRange | null> {
  return storedRangeFor(await getGscReadContext(siteId), days);
}

export async function hasGscData(siteId: string): Promise<boolean> {
  return (await getStoredGscRange(siteId, 1)) !== null;
}

/** V2 recommendations require complete evidence; legacy rollback has no coverage records. */
export async function hasCompleteGscReportCoverage(siteId: string, kind: GscReportKind, range: GscDateRange): Promise<boolean> {
  const context = await getGscReadContext(siteId);
  if (!context.available) return false;
  return !context.useV2 || v2.hasV2CompleteGscReportCoverage(context.scope, kind, range);
}

export async function getGscPeriodMetrics(siteId: string, range: GscDateRange) {
  const context = await getGscReadContext(siteId);
  if (!context.available) return emptyGscPeriodMetrics();
  if (context.useV2) return v2.getV2GscPeriodMetrics(context.scope, range);
  async function period(selectedRange: GscDateRange) {
    const rows = await db.keyword.findMany({ where: legacyWhere(siteId, selectedRange) });
    const normalized = rows.map((row) => ({ ...row, searchType: context.scope.searchType }));
    return aggregatePeriodRows({ totals: normalized, queries: normalized }, { ...context.scope, range: selectedRange });
  }
  const [current, previous] = await Promise.all([period(range), period(previousDateRange(range))]);
  return comparePeriods(current, previous);
}

export async function getGscTopQueries(siteId: string, range: GscDateRange, limit = 50): Promise<KeywordRow[]> {
  const context = await getGscReadContext(siteId);
  if (!context.available) return [];
  if (context.useV2) return v2.getV2GscTopQueries(context.scope, range, limit);
  const rows = await db.keyword.findMany({ where: legacyWhere(siteId, range) });
  return aggregateQueryRows(rows.map((row) => ({ ...row, searchType: context.scope.searchType })), { ...context.scope, range }).slice(0, limit);
}

export async function getGscPageMetricsForRange(siteId: string, range: GscDateRange): Promise<PageRow[]> {
  const context = await getGscReadContext(siteId);
  if (!context.available) return [];
  if (context.useV2) return v2.getV2GscPageMetricsForRange(context.scope, range);
  const rows = await db.page.findMany({ where: legacyWhere(siteId, range) });
  return aggregatePageRows(rows.map((row) => ({ ...row, searchType: context.scope.searchType })), { ...context.scope, range });
}

export async function getGscTopPages(siteId: string, range: GscDateRange, limit = 50): Promise<PageRow[]> {
  return (await getGscPageMetricsForRange(siteId, range)).slice(0, limit);
}

export async function getGscDailyTraffic(siteId: string, range: GscDateRange): Promise<DailyTraffic[]> {
  const context = await getGscReadContext(siteId);
  if (!context.available) return [];
  if (context.useV2) return v2.getV2GscDailyTraffic(context.scope, range);
  const pages = await db.page.findMany({ where: legacyWhere(siteId, range), orderBy: { date: "asc" } });
  const rows = pages.length ? pages : await db.keyword.findMany({ where: legacyWhere(siteId, range), orderBy: { date: "asc" } });
  const days = new Map<string, DailyTraffic>();
  for (const row of rows) {
    const date = row.date.toISOString().slice(0, 10);
    const day = days.get(date) ?? { date, clicks: 0, impressions: 0 };
    day.clicks += row.clicks;
    day.impressions += row.impressions;
    days.set(date, day);
  }
  return Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export async function getGscQueryHistory(siteId: string, query: string, days: number) {
  const context = await getGscReadContext(siteId);
  const range = await storedRangeFor(context, days);
  if (!range) return [];
  if (context.useV2) return v2.getV2GscQueryHistory(context.scope, query, range);
  const rows = await db.keyword.findMany({ where: { ...legacyWhere(siteId, range), query }, orderBy: { date: "asc" } });
  return rows.map((row) => ({ date: row.date, query: row.query, ...aggregateGscMetrics([row]) }));
}

export async function getGscLatestQueryMetric(siteId: string, query: string) {
  const context = await getGscReadContext(siteId);
  if (!context.available) return null;
  if (context.useV2) return v2.getV2GscLatestQueryMetric(context.scope, query);
  const row = await db.keyword.findFirst({ where: { siteId, query }, orderBy: { date: "desc" } });
  return row ? { date: row.date, query: row.query, page: row.page, ...aggregateGscMetrics([row]) } : null;
}

export async function getGscSavedQueryMetrics(siteId: string, queries: string[], days: number): Promise<Map<string, KeywordRow>> {
  if (queries.length === 0) return new Map();
  const context = await getGscReadContext(siteId);
  const range = await storedRangeFor(context, days);
  if (!range) return new Map();
  if (context.useV2) return v2.getV2GscSavedQueryMetrics(context.scope, queries, range);
  const rows = await db.keyword.findMany({ where: { ...legacyWhere(siteId, range), query: { in: queries } }, orderBy: { date: "asc" } });
  const normalized = rows.map((row) => ({ ...row, searchType: context.scope.searchType }));
  return new Map(aggregateQueryRows(normalized, { ...context.scope, range }).map((row) => [row.query, row]));
}

export async function getGscQueryPageRows(siteId: string, range: GscDateRange) {
  const context = await getGscReadContext(siteId);
  if (!context.available) return [];
  if (context.useV2) return v2.getV2GscQueryPageRows(context.scope, range);
  const rows = await db.keyword.findMany({ where: { ...legacyWhere(siteId, range), page: { not: null } }, orderBy: { date: "asc" } });
  return rows.flatMap((row) => row.page === null ? [] : [{ date: row.date, query: row.query, url: row.page, ...aggregateGscMetrics([row]) }]);
}

export async function getGscStoredCounts(siteId: string) {
  const context = await getGscReadContext(siteId);
  if (!context.available) return { queries: 0, pages: 0 };
  if (context.useV2) return v2.getV2GscStoredCounts(context.scope);
  const [queries, pages] = await Promise.all([db.keyword.count({ where: { siteId } }), db.page.count({ where: { siteId } })]);
  return { queries, pages };
}

export function formatPosition(position: number | null): string {
  if (position === null || !Number.isFinite(position) || position <= 0) return "—";
  return position.toFixed(1);
}

export function formatCtr(ctr: number | null): string {
  if (ctr === null) return "—";
  return `${(ctr * 100).toFixed(2)}%`;
}

export function formatCompact(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

export function positionBand(position: number): "top3" | "top10" | "top20" | "deep" {
  if (position > 0 && position <= 3) return "top3";
  if (position <= 10) return "top10";
  if (position <= 20) return "top20";
  return "deep";
}
