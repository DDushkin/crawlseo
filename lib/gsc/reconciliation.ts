import type { GscReportKind, GscReportResult } from "./types";

type Traffic = { clicks: number; impressions: number };
type Breakdown = Traffic & { complete: boolean };
export type GscReportState = Pick<GscReportResult, "complete" | "pagesFetched" | "truncatedAt">;
export type GscReportStates = Partial<Record<GscReportKind, GscReportState>>;
export type GscWarning = { code: string; message: string };
export type GscReconciliation = {
  queryCoverage: { clicks: number | null; impressions: number | null; expectedPrivacyGap: boolean };
  pageCoverage: { clicks: number | null; impressions: number | null };
  warnings: GscWarning[];
};

function coverage(value: number, total: number): number | null {
  return total === 0 ? null : value / total;
}

function materiallyDifferent(value: number, total: number): boolean {
  return total === 0 ? value !== 0 : Math.abs(value - total) / total > 0.01;
}

export function reconcileGscReports(input: {
  totals: Traffic & { complete?: boolean };
  query: Breakdown;
  page: Breakdown;
  device: Breakdown;
  country: Breakdown;
  reportStates?: GscReportStates;
}): GscReconciliation {
  const warnings: GscWarning[] = [];
  for (const kind of ["device", "country"] as const) {
    const report = input[kind];
    if (input.totals.complete !== false && report.complete &&
      (materiallyDifferent(report.clicks, input.totals.clicks) || materiallyDifferent(report.impressions, input.totals.impressions))) {
      warnings.push({ code: `${kind.toUpperCase()}_TOTAL_MISMATCH`, message: `${kind} traffic differs from property totals by more than 1%.` });
    }
  }
  const states: GscReportStates = {
    query: { ...input.query, pagesFetched: 0, truncatedAt: null },
    page: { ...input.page, pagesFetched: 0, truncatedAt: null },
    device: { ...input.device, pagesFetched: 0, truncatedAt: null },
    country: { ...input.country, pagesFetched: 0, truncatedAt: null },
    ...input.reportStates,
  };
  for (const [kind, state] of Object.entries(states)) {
    if (!state.complete) {
      const label = kind.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
      warnings.push({ code: `${label}_TRUNCATED`, message: `${kind} report is incomplete; previously stored data was preserved.` });
    }
  }
  return {
    queryCoverage: {
      clicks: coverage(input.query.clicks, input.totals.clicks),
      impressions: coverage(input.query.impressions, input.totals.impressions),
      expectedPrivacyGap: input.query.complete && input.totals.complete !== false &&
        (input.query.clicks < input.totals.clicks || input.query.impressions < input.totals.impressions),
    },
    pageCoverage: {
      clicks: coverage(input.page.clicks, input.totals.clicks),
      impressions: coverage(input.page.impressions, input.totals.impressions),
    },
    warnings,
  };
}
