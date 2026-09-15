import { pathToFileURL } from "node:url";

import { db } from "../lib/db";
import { aggregateGscMetrics } from "../lib/gsc/aggregate";
import { toDbDate } from "../lib/gsc/date-range";
import { getV2StoredGscRange } from "../lib/gsc/read-model";
import type {
  AggregatedGscMetrics,
  GscDateRange,
  GscMetricRow,
  GscReportResult,
} from "../lib/gsc/types";
import { fetchGscReportReadOnly, GscApiError } from "../lib/google/gsc-client";
import { ReauthRequiredError } from "../lib/google/google-auth";

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
type CanonicalScope = Omit<StoredScope, "range">;
type VerificationDependencies = {
  findSite(siteId: string): Promise<VerificationSite | null>;
  getCanonicalRange(scope: CanonicalScope, days: number): Promise<GscDateRange | null>;
  fetchReadOnlyReport(
    userId: string,
    property: string,
    range: GscDateRange,
    kind: "dailyTotal",
    options: { type: "web"; dataState: "final" }
  ): Promise<GscReportResult>;
  getStoredRows(scope: StoredScope): Promise<Array<Pick<GscMetricRow, "clicks" | "impressions" | "position">>>;
  writeLine(line: string): void;
};
type VerificationCliRuntime = {
  disconnect(): Promise<void>;
  writeError(message: string): void;
};

type VerificationErrorCode =
  | "ARGUMENT"
  | "NOT_FOUND"
  | "NO_PROPERTY"
  | "NO_CANONICAL_COVERAGE"
  | "INCOMPLETE"
  | "UNSUPPORTED_SEARCH_TYPE";

const CONTROLLED_ERROR_MESSAGES: Record<Exclude<VerificationErrorCode, "ARGUMENT">, string> = {
  NOT_FOUND: "The selected site was not found.",
  NO_PROPERTY: "The selected site has no connected GSC property.",
  NO_CANONICAL_COVERAGE: "No canonical finalized GSC coverage exists for the selected site.",
  INCOMPLETE: "The provider daily-total report was incomplete.",
  UNSUPPORTED_SEARCH_TYPE: "The selected site uses an unsupported GSC search type.",
};

class VerificationCliError extends Error {
  constructor(public readonly code: VerificationErrorCode, message: string) {
    super(message);
    this.name = "VerificationCliError";
  }
}

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
  if (!value || value.startsWith("--")) {
    throw new VerificationCliError("ARGUMENT", `${option} requires a value`);
  }
  return value;
}

export function parseVerificationArgs(args: string[]): VerificationArgs {
  let siteId: string | null = null;
  let days = 28;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--site") {
      if (siteId !== null) throw new VerificationCliError("ARGUMENT", "--site may only be provided once");
      siteId = optionValue(args, index, "--site");
      index += 1;
    } else if (argument === "--days") {
      const value = optionValue(args, index, "--days");
      if (!/^\d+$/.test(value)) {
        throw new VerificationCliError("ARGUMENT", "--days must be an integer between 1 and 180");
      }
      days = Number(value);
      index += 1;
    } else {
      throw new VerificationCliError("ARGUMENT", `Unknown argument: ${argument}`);
    }
  }
  if (!siteId) throw new VerificationCliError("ARGUMENT", "--site is required");
  if (days < 1 || days > 180) {
    throw new VerificationCliError("ARGUMENT", "--days must be between 1 and 180");
  }
  return { siteId, days };
}

const defaultDependencies: VerificationDependencies = {
  findSite: (siteId) => db.site.findUnique({
    where: { id: siteId },
    select: { id: true, userId: true, gscProperty: true, gscSearchType: true },
  }),
  getCanonicalRange: getV2StoredGscRange,
  fetchReadOnlyReport: fetchGscReportReadOnly,
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

const defaultRuntime: VerificationCliRuntime = {
  disconnect: () => db.$disconnect(),
  writeError: (message) => console.error(message),
};

export async function runVerification(
  args: string[],
  dependencies: VerificationDependencies = defaultDependencies
): Promise<number> {
  const { siteId, days } = parseVerificationArgs(args);
  const site = await dependencies.findSite(siteId);
  if (!site) throw new VerificationCliError("NOT_FOUND", CONTROLLED_ERROR_MESSAGES.NOT_FOUND);
  if (!site.gscProperty) {
    throw new VerificationCliError("NO_PROPERTY", CONTROLLED_ERROR_MESSAGES.NO_PROPERTY);
  }
  if (site.gscSearchType !== "web") {
    throw new VerificationCliError(
      "UNSUPPORTED_SEARCH_TYPE",
      CONTROLLED_ERROR_MESSAGES.UNSUPPORTED_SEARCH_TYPE
    );
  }

  const canonicalScope: CanonicalScope = {
    siteId: site.id,
    property: site.gscProperty,
    searchType: "web",
  };
  const range = await dependencies.getCanonicalRange(canonicalScope, days);
  if (!range) {
    throw new VerificationCliError(
      "NO_CANONICAL_COVERAGE",
      CONTROLLED_ERROR_MESSAGES.NO_CANONICAL_COVERAGE
    );
  }
  const scope: StoredScope = {
    ...canonicalScope,
    range,
  };
  const [sourceReport, storedRows] = await Promise.all([
    dependencies.fetchReadOnlyReport(site.userId, scope.property, range, "dailyTotal", {
      type: scope.searchType,
      dataState: "final",
    }),
    dependencies.getStoredRows(scope),
  ]);
  if (!sourceReport.complete) {
    throw new VerificationCliError("INCOMPLETE", CONTROLLED_ERROR_MESSAGES.INCOMPLETE);
  }

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

function controlledErrorMessage(error: unknown): string {
  if (error instanceof VerificationCliError) {
    return error.code === "ARGUMENT" ? error.message : CONTROLLED_ERROR_MESSAGES[error.code];
  }
  if (error instanceof ReauthRequiredError) {
    return "Google authorization has expired. Reconnect the account and retry.";
  }
  if (error instanceof GscApiError) return "Google Search Console verification failed.";
  return "GSC verification failed.";
}

export async function runVerificationCli(
  args: string[],
  dependencies: VerificationDependencies = defaultDependencies,
  runtime: VerificationCliRuntime = defaultRuntime
): Promise<number> {
  let exitCode = 1;
  try {
    exitCode = await runVerification(args, dependencies);
  } catch (error) {
    runtime.writeError(controlledErrorMessage(error));
  }
  try {
    await runtime.disconnect();
  } catch {
    runtime.writeError("Failed to close the database connection.");
    exitCode = 1;
  }
  return exitCode;
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  process.exitCode = await runVerificationCli(args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
