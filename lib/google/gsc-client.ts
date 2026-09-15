import type {
  GscDataState,
  GscDateRange,
  GscMetricRow,
  GscReportKind,
  GscReportResult,
  GscSearchType,
} from "@/lib/gsc/types";
import { inclusiveRangeEnding, pacificDateLabel, shiftDateLabel } from "@/lib/gsc/date-range";

import { getAccessToken } from "./google-auth";

const GSC_API_BASE = "https://www.googleapis.com/webmasters/v3";
const DEFAULT_ROW_LIMIT = 25_000;
const DEFAULT_MAX_ROWS = 250_000;

interface GSCProperty {
  siteUrl: string;
  permissionLevel: string;
}

export type SearchAnalyticsRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type SearchAnalyticsResponse = {
  rows?: SearchAnalyticsRow[];
  responseAggregationType?: string;
  metadata?: {
    first_incomplete_date?: string;
    first_incomplete_hour?: string;
  };
};

export type GSCFilter = {
  dimension: "query" | "page" | "device" | "country";
  operator: "equals" | "notEquals" | "contains" | "notContains";
  expression: string;
};

/** @deprecated Use GscMetricRow through fetchGscReport instead. */
export interface KeywordData {
  query: string;
  page?: string;
  device?: string;
  country?: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  date: string;
}

const REPORT_DIMENSIONS = {
  dailyTotal: ["date"],
  query: ["date", "query"],
  page: ["date", "page"],
  queryPage: ["date", "query", "page"],
  device: ["date", "device"],
  country: ["date", "country"],
} as const satisfies Record<GscReportKind, readonly string[]>;

export type QuerySearchAnalyticsPageInput = {
  siteUrl: string;
  range: GscDateRange;
  dimensions: string[];
  type: GscSearchType;
  dataState: GscDataState;
  rowLimit: number;
  startRow: number;
};

export type PaginateGscReportOptions = {
  kind: GscReportKind;
  rowLimit?: number;
  maxRows?: number;
};

export type GscCoverage = {
  finalizedThrough: string;
  source: "metadata" | "observed-row" | "conservative-fallback";
};

export type ProbeFinalizedCoverageOptions = {
  now?: Date;
  type?: GscSearchType;
};

export class GscApiError extends Error {
  readonly status: number;
  readonly code: number | string | null;

  constructor(status: number, code: number | string | null) {
    super(`GSC Search Analytics request failed (status ${status}, code ${code ?? "unknown"})`);
    this.name = "GscApiError";
    this.status = status;
    this.code = code;
  }
}

export function dimensionsForReport(kind: GscReportKind): string[] {
  return [...REPORT_DIMENSIONS[kind]];
}

function normalizeRow(kind: GscReportKind, row: SearchAnalyticsRow): GscMetricRow {
  const keyed = Object.fromEntries(
    dimensionsForReport(kind).map((dimension, index) => [dimension, row.keys[index]])
  );
  if (!keyed.date) throw new Error(`GSC ${kind} row did not contain a date`);

  return {
    date: keyed.date,
    query: keyed.query,
    url: keyed.page,
    device: keyed.device,
    country: keyed.country,
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    position: row.position,
  };
}

export async function paginateGscReport(
  { kind, rowLimit = DEFAULT_ROW_LIMIT, maxRows = DEFAULT_MAX_ROWS }: PaginateGscReportOptions,
  requestPage: (startRow: number) => Promise<SearchAnalyticsResponse>
): Promise<GscReportResult> {
  const rows: GscMetricRow[] = [];
  let startRow = 0;
  let pagesFetched = 0;

  while (startRow < maxRows) {
    const response = await requestPage(startRow);
    pagesFetched += 1;
    const pageRows = response.rows ?? [];
    rows.push(...pageRows.map((row) => normalizeRow(kind, row)));

    if (pageRows.length < rowLimit) {
      return { kind, rows, complete: true, pagesFetched, truncatedAt: null };
    }

    startRow += rowLimit;
  }

  return { kind, rows, complete: false, pagesFetched, truncatedAt: maxRows };
}

export async function querySearchAnalyticsPage(
  accessToken: string,
  { siteUrl, range, dimensions, type, dataState, rowLimit, startRow }: QuerySearchAnalyticsPageInput
): Promise<SearchAnalyticsResponse> {
  const response = await fetch(
    `${GSC_API_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: range.startDate,
        endDate: range.endDate,
        dimensions,
        type,
        dataState,
        rowLimit,
        startRow,
      }),
    }
  );

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: number | string };
    } | null;
    throw new GscApiError(response.status, body?.error?.code ?? null);
  }

  return response.json() as Promise<SearchAnalyticsResponse>;
}

export async function fetchGscReport(
  userId: string,
  siteUrl: string,
  range: GscDateRange,
  kind: GscReportKind,
  options: {
    type?: GscSearchType;
    dataState?: GscDataState;
    rowLimit?: number;
    maxRows?: number;
  } = {}
): Promise<GscReportResult> {
  const accessToken = await getAccessToken(userId);
  const rowLimit = options.rowLimit ?? DEFAULT_ROW_LIMIT;
  return paginateGscReport(
    { kind, rowLimit, maxRows: options.maxRows },
    (startRow) =>
      querySearchAnalyticsPage(accessToken, {
        siteUrl,
        range,
        dimensions: dimensionsForReport(kind),
        type: options.type ?? "web",
        dataState: options.dataState ?? "final",
        rowLimit,
        startRow,
      })
  );
}

export async function probeFinalizedCoverage(
  accessToken: string,
  siteUrl: string,
  { now = new Date(), type = "web" }: ProbeFinalizedCoverageOptions = {}
): Promise<GscCoverage> {
  const today = pacificDateLabel(now);
  const response = await querySearchAnalyticsPage(accessToken, {
    siteUrl,
    range: inclusiveRangeEnding(today, 14),
    dimensions: ["date"],
    type,
    dataState: "all",
    rowLimit: DEFAULT_ROW_LIMIT,
    startRow: 0,
  });

  const firstIncompleteDate = response.metadata?.first_incomplete_date;
  if (firstIncompleteDate) {
    return {
      finalizedThrough: shiftDateLabel(firstIncompleteDate, -1),
      source: "metadata",
    };
  }

  const observedDates = (response.rows ?? [])
    .map((row) => row.keys[0])
    .filter((date): date is string => Boolean(date));
  if (observedDates.length > 0) {
    return {
      finalizedThrough: observedDates.reduce((latest, date) => (date > latest ? date : latest)),
      source: "observed-row",
    };
  }

  return {
    finalizedThrough: shiftDateLabel(today, -3),
    source: "conservative-fallback",
  };
}

/** Lists all Google Search Console properties for a user. */
export async function listGSCProperties(userId: string): Promise<GSCProperty[]> {
  const accessToken = await getAccessToken(userId);

  const response = await fetch(`${GSC_API_BASE}/sites`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Failed to list GSC properties: ${response.status} ${response.statusText}${
        body ? ` — ${body.slice(0, 500)}` : ""
      }`
    );
  }

  const data = (await response.json()) as { siteEntry?: GSCProperty[] };
  return data.siteEntry || [];
}

/** @deprecated Use fetchGscReport instead. */
export async function fetchSearchAnalytics(
  userId: string,
  siteUrl: string,
  startDate: string,
  endDate: string,
  dimensions: string[] = ["query", "page", "date", "device", "country"],
  filters?: GSCFilter[]
): Promise<KeywordData[]> {
  const accessToken = await getAccessToken(userId);
  const results: KeywordData[] = [];
  let startRow = 0;
  const rowLimit = 25000;

  while (true) {
    const response = await fetch(
      `${GSC_API_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate,
          endDate,
          dimensions,
          rowLimit,
          startRow,
          ...(filters?.length && { dimensionFilterGroups: [{ filters }] }),
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch search analytics: ${response.statusText}`);
    }

    const data = (await response.json()) as { rows?: SearchAnalyticsRow[] };
    if (!data.rows || data.rows.length === 0) break;

    for (const row of data.rows) {
      const [query, page, date, device, country] = row.keys;
      results.push({
        query,
        page,
        device,
        country,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: Number(row.ctr.toFixed(4)),
        position: Number(row.position.toFixed(2)),
        date,
      });
    }

    if (data.rows.length < rowLimit) break;
    startRow += rowLimit;
  }

  return results;
}

/** @deprecated Use fetchGscReport instead. */
export async function fetchPageAnalytics(
  userId: string,
  siteUrl: string,
  startDate: string,
  endDate: string
): Promise<KeywordData[]> {
  const accessToken = await getAccessToken(userId);
  const response = await fetch(
    `${GSC_API_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ["page", "date"],
        rowLimit: 25000,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch page analytics: ${response.statusText}`);
  }

  const data = (await response.json()) as { rows?: SearchAnalyticsRow[] };
  return (data.rows ?? []).map((row) => {
    const [page, date] = row.keys;
    return {
      query: "",
      page,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: Number(row.ctr.toFixed(4)),
      position: Number(row.position.toFixed(2)),
      date,
    };
  });
}
