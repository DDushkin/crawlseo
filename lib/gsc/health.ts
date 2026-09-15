import { db } from "../db";
import { pacificDateLabel, shiftDateLabel } from "./date-range";
import type { DailyTraffic } from "../seo-metrics";

export type GscDataHealth = {
  state: "unavailable" | "syncing" | "fresh" | "stale" | "partial" | "failed" | "reauth-required";
  property: string | null;
  searchType: string;
  startDate: string | null;
  endDate: string | null;
  lastSuccessfulSync: string | null;
  queryClickCoverage: number | null;
  warnings: { code: string; message: string }[];
};
type HealthRun = { status: string; finishedAt: Date | null; reportStates: unknown; reconciliation: unknown; errorCode: string | null; errorMessage: string | null };
export type GscHealthInput = {
  property: string | null; searchType: string; startDate: string | null; endDate: string | null;
  lastSuccessfulRun: HealthRun | null; latestRun: HealthRun | null; leaseExpiresAt: Date | null; now: Date;
};
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function projectGscDataHealth(input: GscHealthInput): GscDataHealth {
  const latest = input.latestRun;
  const reconciliation = record(input.lastSuccessfulRun?.reconciliation);
  const coverage = record(reconciliation.queryCoverage).clicks;
  const latestReconciliation = record(latest?.reconciliation);
  const rawWarnings = latest?.status === "COMPLETED" || latest?.status === "COMPLETED_WITH_WARNINGS"
    ? latestReconciliation.warnings : reconciliation.warnings;
  const warnings: GscDataHealth["warnings"] = Array.isArray(rawWarnings) ? rawWarnings.flatMap((value) => {
    const warning = record(value);
    return typeof warning.code === "string" && typeof warning.message === "string" ? [{ code: warning.code, message: warning.message }] : [];
  }) : [];
  const incomplete = Object.values(record(latest?.reportStates)).some((value) => record(value).complete === false);
  let state: GscDataHealth["state"];
  if (!input.property) state = "unavailable";
  else if (latest?.status === "RUNNING" && input.leaseExpiresAt && input.leaseExpiresAt > input.now) state = "syncing";
  else if (latest?.errorCode === "REAUTH_REQUIRED") {
    state = "reauth-required";
    warnings.unshift({ code: "REAUTH_REQUIRED", message: "Your Google connection has expired. Reconnect your Google account, then sync again." });
  } else if (latest?.status === "FAILED" || latest?.status === "RUNNING") {
    state = "failed";
    warnings.unshift({ code: latest.errorCode ?? "SYNC_INTERRUPTED", message: latest.status === "RUNNING"
      ? "The previous sync was interrupted. Run sync again."
      : latest.errorMessage ?? "Search Console synchronization failed. Please try again." });
  } else if (!input.lastSuccessfulRun) state = "unavailable";
  else if (latest?.status === "COMPLETED_WITH_WARNINGS" || incomplete) {
    state = "partial";
    if (!warnings.length) warnings.push({ code: "INCOMPLETE_REPORT", message: "A report is incomplete or has data warnings. Run sync again to refresh it." });
  } else if (!input.endDate) state = "unavailable";
  else state = input.endDate >= shiftDateLabel(pacificDateLabel(input.now), -4) ? "fresh" : "stale";
  return { state, property: input.property, searchType: input.searchType, startDate: input.startDate, endDate: input.endDate,
    lastSuccessfulSync: input.lastSuccessfulRun?.finishedAt?.toISOString() ?? null,
    queryClickCoverage: typeof coverage === "number" && Number.isFinite(coverage) ? coverage : null, warnings };
}
export async function getGscDataHealth(siteId: string): Promise<GscDataHealth> {
  const site = await db.site.findUnique({ where: { id: siteId }, select: {
    gscProperty: true, gscSearchType: true, gscSyncLease: { select: { expiresAt: true } },
  } });
  const searchType = site?.gscSearchType ?? "web";
  const empty: GscHealthInput = { property: site?.gscProperty ?? null, searchType, startDate: null, endDate: null,
    lastSuccessfulRun: null, latestRun: null, leaseExpiresAt: site?.gscSyncLease?.expiresAt ?? null, now: new Date() };
  if (!site?.gscProperty) return projectGscDataHealth(empty);
  const where = { siteId, searchType, dataState: "final" };
  const select = { status: true, finishedAt: true, reportStates: true, reconciliation: true, errorCode: true, errorMessage: true } as const;
  const [latestRun, lastSuccessfulRun, dates] = await Promise.all([
    db.gscSyncRun.findFirst({ where, orderBy: { startedAt: "desc" }, select }),
    db.gscSyncRun.findFirst({ where: { ...where, status: { in: ["COMPLETED", "COMPLETED_WITH_WARNINGS"] } }, orderBy: { startedAt: "desc" }, select }),
    db.gscDailyTotal.aggregate({ where: { siteId, searchType }, _min: { date: true }, _max: { date: true } }),
  ]);
  return projectGscDataHealth({ ...empty, latestRun, lastSuccessfulRun,
    startDate: dates._min.date?.toISOString().slice(0, 10) ?? null, endDate: dates._max.date?.toISOString().slice(0, 10) ?? null });
}

export type TrafficResponse = { coverage: { startDate: string | null; endDate: string | null }; rows: DailyTraffic[] };

/** Coverage describes only the rows returned, including during legacy rollback. */
export function toTrafficResponse(rows: DailyTraffic[]): TrafficResponse {
  const dates = rows.map((row) => row.date).sort();
  return { coverage: { startDate: dates[0] ?? null, endDate: dates.at(-1) ?? null }, rows };
}
