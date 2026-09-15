import { pathToFileURL } from "node:url";

import { db } from "../lib/db";
import { aggregateGscMetrics } from "../lib/gsc/aggregate";
import { toDbDate } from "../lib/gsc/date-range";
import type {
  AggregatedGscMetrics,
  GscDateRange,
  GscMetricRow,
  GscReportResult,
} from "../lib/gsc/types";
import { fetchGscReport } from "../lib/google/gsc-client";
import { getStoredGscRange } from "../lib/seo-metrics";

export type VerificationDifferences = {
  matches: boolean;
  clicksDifference: number;
  impressionsDifference: number;
  ctrDifference: number | null;
  positionDifference: number | null;
};

const FLOAT_TOLERANCE = 0.000001;

type VerificationArgs = { siteId: string; days: number };
type VerificationSite = {
  id: string;
  userId: string;
  gscProperty: string | null;
  gscSearchType: string;
};
type StoredScope = {
  siteId: string;
  property: string;
  searchType: "web";
  range: GscDateRange;
};
type VerificationDependencies = {
  findSite(siteId: string): Promise<VerificationSite | null>;
  getStoredRange(siteId: string, days: number): Promise<GscDateRange | null>;
  fetchReport(
    userId: string,
    property: string,
    range: GscDateRange,
    kind: "dailyTotal",
    options: { type: "web"; dataState: "final" }
  ): Promise<GscReportResult>;
  getStoredRows(scope: StoredScope): Promise<Array<Pick<GscMetricRow, "clicks" | "impressions" | "position">>>;
  writeLine(line: string): void;
};

function floatingMetricMatches(
  source: number | null,
  stored: number | null,
  difference: number | null
): boolean {
  if (source === null || stored === null) return source === stored;
  const roundingAllowance = Number.EPSILON * Math.max(1, Math.abs(source), Math.abs(stored));
  return difference !== null && Math.abs(difference) <= FLOAT_TOLERANCE + roundingAllowance;
}

export function compareVerificationMetrics(
  source: AggregatedGscMetrics,
  stored: AggregatedGscMetrics
): VerificationDifferences {
  const clicksDifference = source.clicks - stored.clicks;
  const impressionsDifference = source.impressions - stored.impressions;
  const ctrDifference = source.ctr === null || stored.ctr === null
    ? null
    : source.ctr - stored.ctr;
  const positionDifference = source.position === null || stored.position === null
    ? null
    : source.position - stored.position;

  return {
    matches: clicksDifference === 0 && impressionsDifference === 0 &&
      floatingMetricMatches(source.ctr, stored.ctr, ctrDifference) &&
      floatingMetricMatches(source.position, stored.position, positionDifference),
    clicksDifference,
    impressionsDifference,
    ctrDifference,
    positionDifference,
  };
}

function optionValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

export function parseVerificationArgs(args: string[]): VerificationArgs {
  let siteId: string | null = null;
  let days = 28;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--site") {
      if (siteId !== null) throw new Error("--site may only be provided once");
      siteId = optionValue(args, index, "--site");
      index += 1;
    } else if (argument === "--days") {
      const value = optionValue(args, index, "--days");
      if (!/^\d+$/.test(value)) throw new Error("--days must be an integer between 1 and 180");
      days = Number(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!siteId) throw new Error("--site is required");
  if (days < 1 || days > 180) throw new Error("--days must be between 1 and 180");
  return { siteId, days };
}

const defaultDependencies: VerificationDependencies = {
  findSite: (siteId) => db.site.findUnique({
    where: { id: siteId },
    select: { id: true, userId: true, gscProperty: true, gscSearchType: true },
  }),
  getStoredRange: getStoredGscRange,
  fetchReport: fetchGscReport,
  getStoredRows: ({ siteId, property, searchType, range }) => db.gscDailyTotal.findMany({
    where: {
      siteId,
      property,
      searchType,
      syncRun: { property },
      date: { gte: toDbDate(range.startDate), lte: toDbDate(range.endDate) },
    },
    select: { clicks: true, impressions: true, position: true },
  }),
  writeLine: (line) => console.log(line),
};

export async function runVerification(
  args: string[],
  dependencies: VerificationDependencies = defaultDependencies
): Promise<number> {
  const { siteId, days } = parseVerificationArgs(args);
  const site = await dependencies.findSite(siteId);
  if (!site) throw new Error(`Site not found: ${siteId}`);
  if (!site.gscProperty) throw new Error(`Site has no connected GSC property: ${siteId}`);
  if (site.gscSearchType !== "web") throw new Error(`Unsupported GSC search type: ${site.gscSearchType}`);

  const range = await dependencies.getStoredRange(site.id, days);
  if (!range) throw new Error(`No finalized stored GSC coverage exists for site: ${site.id}`);
  const scope: StoredScope = {
    siteId: site.id,
    property: site.gscProperty,
    searchType: "web",
    range,
  };
  const [sourceReport, storedRows] = await Promise.all([
    dependencies.fetchReport(site.userId, scope.property, range, "dailyTotal", {
      type: scope.searchType,
      dataState: "final",
    }),
    dependencies.getStoredRows(scope),
  ]);
  if (!sourceReport.complete) throw new Error("Provider dailyTotal report was incomplete");

  const sourceMetrics = aggregateGscMetrics(sourceReport.rows);
  const storedMetrics = aggregateGscMetrics(storedRows);
  const comparison = compareVerificationMetrics(sourceMetrics, storedMetrics);
  dependencies.writeLine(JSON.stringify({
    siteId: site.id,
    property: scope.property,
    searchType: scope.searchType,
    dates: range,
    sourceMetrics,
    storedMetrics,
    differences: {
      clicks: comparison.clicksDifference,
      impressions: comparison.impressionsDifference,
      ctr: comparison.ctrDifference,
      position: comparison.positionDifference,
    },
    matches: comparison.matches,
  }));
  return comparison.matches ? 0 : 1;
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  try {
    process.exitCode = await runVerification(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "GSC verification failed");
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
