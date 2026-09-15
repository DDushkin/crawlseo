import { db } from "../db";
import { aggregateGscMetrics, compareGscMetrics } from "./aggregate";
import { inclusiveRangeEnding, previousDateRange, toDbDate } from "./date-range";
import type { GscDateRange } from "./types";

export type PeriodMetrics = {
  clicks: number;
  impressions: number;
  avgPosition: number | null;
  avgCtr: number | null;
  uniqueKeywords: number;
  startDate: string | null;
  endDate: string | null;
};
export type KeywordRow = { query: string; clicks: number; impressions: number; position: number | null; ctr: number | null };
export type PageRow = { url: string; clicks: number; impressions: number; position: number | null; ctr: number | null };
export type DailyTraffic = { date: string; clicks: number; impressions: number };

export function shouldUseGscV2(dataVersion: number, flag: string | undefined): boolean {
  return dataVersion === 2 && flag !== "false";
}

export function storedRangeEnding(latestDate: string, days: number): GscDateRange {
  return inclusiveRangeEnding(latestDate, days);
}

export type GscReadScope = { siteId: string; property: string; searchType: string };
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

function dateFilter(range: GscDateRange) {
  if (range.startDate > range.endDate) throw new Error("GSC range start must precede end");
  return { gte: toDbDate(range.startDate), lte: toDbDate(range.endDate) };
}

function propertyScope(context: GscReadScope) {
  return { siteId: context.siteId, property: context.property, searchType: context.searchType, syncRun: { property: context.property } };
}

function whereFor(context: GscReadScope, range: GscDateRange) {
  return { ...propertyScope(context), date: dateFilter(range) };
}

export async function getV2StoredGscRange(scope: GscReadScope, days: number): Promise<GscDateRange | null> {
  const latest = await db.gscDailyTotal.findFirst({ where: propertyScope(scope), orderBy: { date: "desc" }, select: { date: true } });
  // Canonical totals are replaced only after a complete, finalized report fetch.
  return latest ? storedRangeEnding(latest.date.toISOString().slice(0, 10), days) : null;
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

export async function getV2GscPeriodMetrics(context: GscReadScope, range: GscDateRange) {
  const previous = previousDateRange(range);
  async function period(selectedRange: GscDateRange) {
    const scope = { ...context, range: selectedRange };
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

async function queryRows(context: GscReadScope, range: GscDateRange, query?: string | { in: string[] }) {
  return db.gscQueryDaily.findMany({ where: { ...whereFor(context, range), query }, orderBy: { date: "asc" } });
}

export async function getV2GscTopQueries(context: GscReadScope, range: GscDateRange, limit = 50): Promise<KeywordRow[]> {
  return aggregateQueryRows(await queryRows(context, range), { ...context, range }).slice(0, limit);
}

export async function getV2GscPageMetricsForRange(context: GscReadScope, range: GscDateRange): Promise<PageRow[]> {
  const rows = await db.gscPageDaily.findMany({ where: whereFor(context, range) });
  return aggregatePageRows(rows, { ...context, range });
}

export async function getV2GscTopPages(context: GscReadScope, range: GscDateRange, limit = 50): Promise<PageRow[]> {
  return (await getV2GscPageMetricsForRange(context, range)).slice(0, limit);
}

export async function getV2GscDailyTraffic(context: GscReadScope, range: GscDateRange) {
  const rows = await db.gscDailyTotal.findMany({ where: whereFor(context, range), orderBy: { date: "asc" } });
  return rows.map((row) => ({ date: row.date.toISOString().slice(0, 10), clicks: row.clicks, impressions: row.impressions }));
}

export async function getV2GscQueryHistory(context: GscReadScope, query: string, range: GscDateRange) {
  const rows = await queryRows(context, range, query);
  return rows.map((row) => ({ date: row.date, query: row.query, ...aggregateGscMetrics([row]) }));
}

export async function getV2GscLatestQueryMetric(context: GscReadScope, query: string) {
  const row = await db.gscQueryDaily.findFirst({ where: { ...propertyScope(context), query }, orderBy: { date: "desc" } });
  if (!row) return null;
  const leading = await db.gscQueryPageDaily.findFirst({
    where: { ...propertyScope(context), query, date: row.date },
    orderBy: [{ clicks: "desc" }, { impressions: "desc" }, { url: "asc" }], select: { url: true },
  });
  return { date: row.date, query: row.query, page: leading?.url ?? null, ...aggregateGscMetrics([row]) };
}

export async function getV2GscSavedQueryMetrics(context: GscReadScope, queries: string[], range: GscDateRange): Promise<Map<string, KeywordRow>> {
  if (queries.length === 0) return new Map();
  const rows = await queryRows(context, range, { in: queries });
  return new Map(aggregateQueryRows(rows, { ...context, range }).map((row) => [row.query, row]));
}

export async function getV2GscQueryPageRows(context: GscReadScope, range: GscDateRange) {
  const rows = await db.gscQueryPageDaily.findMany({ where: whereFor(context, range), orderBy: { date: "asc" } });
  return rows.map((row) => ({ date: row.date, query: row.query, url: row.url, ...aggregateGscMetrics([row]) }));
}

export async function getV2GscStoredCounts(context: GscReadScope) {
  const [queries, pages] = await Promise.all([db.gscQueryDaily.count({ where: propertyScope(context) }), db.gscPageDaily.count({ where: propertyScope(context) })]);
  return { queries, pages };
}
