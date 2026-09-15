import { db } from "../db";
import { aggregateGscMetrics, compareGscMetrics } from "./aggregate";
import { inclusiveRangeEnding, previousDateRange, toDbDate } from "./date-range";
import type { GscDateRange } from "./types";
import type { KeywordRow, PageRow, PeriodMetrics } from "../seo-metrics";

export function shouldUseGscV2(dataVersion: number, flag: string | undefined): boolean {
  return dataVersion === 2 && flag !== "false";
}

export function storedRangeEnding(latestDate: string, days: number): GscDateRange {
  return inclusiveRangeEnding(latestDate, days);
}

export type GscReadContext = { siteId: string; searchType: string; useV2: boolean };
type Scope = { siteId: string; searchType: string; range: GscDateRange };
type MetricRow = { siteId: string; searchType: string; date: Date; clicks: number; impressions: number; position: number };
type QueryMetricRow = MetricRow & { query: string };
type PageMetricRow = MetricRow & { url: string };

function inScope(row: MetricRow, scope: Scope): boolean {
  const date = row.date.toISOString().slice(0, 10);
  return row.siteId === scope.siteId && row.searchType === scope.searchType &&
    date >= scope.range.startDate && date <= scope.range.endDate;
}

function groupedMetrics<T extends MetricRow>(rows: T[], scope: Scope, key: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    if (!inScope(row, scope)) continue;
    const name = key(row);
    const group = groups.get(name) ?? [];
    group.push(row);
    groups.set(name, group);
  }
  return Array.from(groups, ([name, group]) => ({ name, ...aggregateGscMetrics(group) }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || a.name.localeCompare(b.name));
}

export function aggregateQueryRows(rows: QueryMetricRow[], scope: Scope): KeywordRow[] {
  return groupedMetrics(rows, scope, (row) => row.query).map(({ name, ...metrics }) => ({ query: name, ...metrics }));
}

export function aggregatePageRows(rows: PageMetricRow[], scope: Scope): PageRow[] {
  return groupedMetrics(rows, scope, (row) => row.url).map(({ name, ...metrics }) => ({ url: name, ...metrics }));
}

export function aggregatePeriodRows(input: { totals: MetricRow[]; queries: QueryMetricRow[] }, scope: Scope): PeriodMetrics {
  const metrics = aggregateGscMetrics(input.totals.filter((row) => inScope(row, scope)));
  return {
    clicks: metrics.clicks, impressions: metrics.impressions, avgPosition: metrics.position, avgCtr: metrics.ctr,
    uniqueKeywords: new Set(input.queries.filter((row) => inScope(row, scope)).map((row) => row.query)).size,
    ...scope.range,
  };
}

export async function getGscReadContext(siteId: string): Promise<GscReadContext> {
  const site = await db.site.findUnique({ where: { id: siteId }, select: { gscDataVersion: true, gscSearchType: true } });
  return { siteId, searchType: site?.gscSearchType ?? "web", useV2: shouldUseGscV2(site?.gscDataVersion ?? 1, process.env.GSC_READ_MODEL_V2) };
}

function dateFilter(range: GscDateRange) {
  if (range.startDate > range.endDate) throw new Error("GSC range start must precede end");
  return { gte: toDbDate(range.startDate), lte: toDbDate(range.endDate) };
}

function whereFor(context: GscReadContext, range: GscDateRange) {
  return { siteId: context.siteId, searchType: context.searchType, date: dateFilter(range) };
}

function legacyWhere(context: GscReadContext, range: GscDateRange) {
  const date = dateFilter(range);
  // Legacy DateTime rows can include a time component; canonical rows are dates.
  date.lte = new Date(date.lte.getTime() + 86_400_000 - 1);
  return { siteId: context.siteId, date };
}

export async function getStoredGscRange(siteId: string, days = 28): Promise<GscDateRange | null> {
  const context = await getGscReadContext(siteId);
  const latest = context.useV2
    ? await db.gscDailyTotal.findFirst({ where: { siteId, searchType: context.searchType }, orderBy: { date: "desc" }, select: { date: true } })
    : await db.keyword.findFirst({ where: { siteId }, orderBy: { date: "desc" }, select: { date: true } });
  // Canonical totals are replaced only after a complete, finalized report fetch.
  return latest ? storedRangeEnding(latest.date.toISOString().slice(0, 10), days) : null;
}

export async function hasGscData(siteId: string): Promise<boolean> {
  return (await getStoredGscRange(siteId, 1)) !== null;
}

export function comparePeriods(current: PeriodMetrics, previous: PeriodMetrics) {
  const deltas = compareGscMetrics(
    { clicks: current.clicks, impressions: current.impressions, ctr: current.avgCtr, position: current.avgPosition },
    { clicks: previous.clicks, impressions: previous.impressions, ctr: previous.avgCtr, position: previous.avgPosition },
  );
  return { current, previous, deltas: { clicks: deltas.clicks, impressions: deltas.impressions, avgPosition: deltas.position, avgCtr: deltas.ctr } };
}

export function emptyGscPeriodMetrics() {
  const empty: PeriodMetrics = { clicks: 0, impressions: 0, avgPosition: null, avgCtr: null, uniqueKeywords: 0, startDate: null, endDate: null };
  return comparePeriods({ ...empty }, { ...empty });
}

export async function getGscPeriodMetrics(siteId: string, range: GscDateRange) {
  const context = await getGscReadContext(siteId);
  const previous = previousDateRange(range);
  async function period(selectedRange: GscDateRange) {
    const scope = { ...context, range: selectedRange };
    if (!context.useV2) {
      const rows = await db.keyword.findMany({ where: legacyWhere(context, selectedRange) });
      const normalized = rows.map((row) => ({ ...row, searchType: context.searchType }));
      return aggregatePeriodRows({ totals: normalized, queries: normalized }, scope);
    }
    const where = whereFor(context, selectedRange);
    const [totals, queries] = await Promise.all([
      db.gscDailyTotal.findMany({ where }),
      db.gscQueryDaily.findMany({ where }),
    ]);
    return aggregatePeriodRows({ totals, queries }, scope);
  }
  const [current, prior] = await Promise.all([period(range), period(previous)]);
  return comparePeriods(current, prior);
}

async function queryRows(context: GscReadContext, range: GscDateRange, query?: string | { in: string[] }) {
  if (context.useV2) return db.gscQueryDaily.findMany({ where: { ...whereFor(context, range), query }, orderBy: { date: "asc" } });
  const rows = await db.keyword.findMany({ where: { ...legacyWhere(context, range), query }, orderBy: { date: "asc" } });
  return rows.map((row) => ({ ...row, searchType: context.searchType }));
}

export async function getGscTopQueries(siteId: string, range: GscDateRange, limit = 50): Promise<KeywordRow[]> {
  const context = await getGscReadContext(siteId);
  return aggregateQueryRows(await queryRows(context, range), { ...context, range }).slice(0, limit);
}

export async function getGscPageMetricsForRange(siteId: string, range: GscDateRange): Promise<PageRow[]> {
  const context = await getGscReadContext(siteId);
  const rows = context.useV2
    ? await db.gscPageDaily.findMany({ where: whereFor(context, range) })
    : (await db.page.findMany({ where: legacyWhere(context, range) })).map((row) => ({ ...row, searchType: context.searchType }));
  return aggregatePageRows(rows, { ...context, range });
}

export async function getGscTopPages(siteId: string, range: GscDateRange, limit = 50): Promise<PageRow[]> {
  return (await getGscPageMetricsForRange(siteId, range)).slice(0, limit);
}

export async function getGscDailyTraffic(siteId: string, range: GscDateRange) {
  const context = await getGscReadContext(siteId);
  if (context.useV2) {
    const rows = await db.gscDailyTotal.findMany({ where: whereFor(context, range), orderBy: { date: "asc" } });
    return rows.map((row) => ({ date: row.date.toISOString().slice(0, 10), clicks: row.clicks, impressions: row.impressions }));
  }
  const pages = await db.page.findMany({ where: legacyWhere(context, range), orderBy: { date: "asc" } });
  const rows = pages.length ? pages : await db.keyword.findMany({ where: legacyWhere(context, range), orderBy: { date: "asc" } });
  const days = new Map<string, { date: string; clicks: number; impressions: number }>();
  for (const row of rows) {
    const date = row.date.toISOString().slice(0, 10);
    const day = days.get(date) ?? { date, clicks: 0, impressions: 0 };
    day.clicks += row.clicks; day.impressions += row.impressions;
    days.set(date, day);
  }
  return Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export async function getGscQueryHistory(siteId: string, query: string, range: GscDateRange) {
  const context = await getGscReadContext(siteId);
  const rows = await queryRows(context, range, query);
  return rows.map((row) => ({ date: row.date, query: row.query, ...aggregateGscMetrics([row]) }));
}

export async function getGscLatestQueryMetric(siteId: string, query: string, range: GscDateRange) {
  const context = await getGscReadContext(siteId);
  if (!context.useV2) {
    const row = await db.keyword.findFirst({ where: { ...legacyWhere(context, range), query }, orderBy: { date: "desc" } });
    return row ? { date: row.date, query: row.query, page: row.page, ...aggregateGscMetrics([row]) } : null;
  }
  const row = await db.gscQueryDaily.findFirst({ where: { ...whereFor(context, range), query }, orderBy: { date: "desc" } });
  if (!row) return null;
  const leading = await db.gscQueryPageDaily.findFirst({
    where: { siteId, searchType: context.searchType, query, date: row.date },
    orderBy: [{ clicks: "desc" }, { impressions: "desc" }, { url: "asc" }], select: { url: true },
  });
  return { date: row.date, query: row.query, page: leading?.url ?? null, ...aggregateGscMetrics([row]) };
}

export async function getGscSavedQueryMetrics(siteId: string, queries: string[], range: GscDateRange): Promise<Map<string, KeywordRow>> {
  if (queries.length === 0) return new Map();
  const context = await getGscReadContext(siteId);
  const rows = await queryRows(context, range, { in: queries });
  return new Map(aggregateQueryRows(rows, { ...context, range }).map((row) => [row.query, row]));
}

export async function getGscQueryPageRows(siteId: string, range: GscDateRange) {
  const context = await getGscReadContext(siteId);
  if (context.useV2) {
    const rows = await db.gscQueryPageDaily.findMany({ where: whereFor(context, range), orderBy: { date: "asc" } });
    return rows.map((row) => ({ date: row.date, query: row.query, url: row.url, ...aggregateGscMetrics([row]) }));
  }
  const rows = await db.keyword.findMany({ where: { ...legacyWhere(context, range), page: { not: null } }, orderBy: { date: "asc" } });
  return rows.flatMap((row) => row.page === null ? [] : [{ date: row.date, query: row.query, url: row.page, ...aggregateGscMetrics([row]) }]);
}

export async function getGscStoredCounts(siteId: string, range: GscDateRange) {
  const context = await getGscReadContext(siteId);
  const [queries, pages] = context.useV2
    ? await Promise.all([db.gscQueryDaily.count({ where: whereFor(context, range) }), db.gscPageDaily.count({ where: whereFor(context, range) })])
    : await Promise.all([db.keyword.count({ where: legacyWhere(context, range) }), db.page.count({ where: legacyWhere(context, range) })]);
  return { queries, pages };
}
