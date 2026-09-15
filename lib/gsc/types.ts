export const GSC_REPORT_KINDS = [
  "dailyTotal",
  "query",
  "page",
  "queryPage",
  "device",
  "country",
] as const;

export type GscReportKind = (typeof GSC_REPORT_KINDS)[number];
export type GscSearchType = "web";
export type GscDataState = "final" | "all";
export type GscDateRange = { startDate: string; endDate: string };

export type GscMetricRow = {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  query?: string;
  url?: string;
  device?: string;
  country?: string;
};

export type GscReportResult = {
  kind: GscReportKind;
  rows: GscMetricRow[];
  complete: boolean;
  pagesFetched: number;
  truncatedAt: number | null;
};

export type AggregatedGscMetrics = {
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
};

export function emptyGscReportCounts(): Record<GscReportKind, number> {
  return {
    dailyTotal: 0,
    query: 0,
    page: 0,
    queryPage: 0,
    device: 0,
    country: 0,
  };
}
