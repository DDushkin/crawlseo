import { randomUUID } from "node:crypto";
import { fetchGscReport, GscApiError, probeFinalizedCoverage, type GscCoverage } from "../google/gsc-client";
import { getAccessToken, ReauthRequiredError } from "../google/google-auth";
import { aggregateGscMetrics } from "./aggregate";
import { inclusiveRangeEnding, pacificDateLabel, shiftDateLabel } from "./date-range";
import { reconcileGscReports, type GscReconciliation, type GscReportStates, type GscWarning } from "./reconciliation";
import { GscSyncError, prismaGscStore, type GscStore, type GscSyncErrorCode, type GscSyncTarget, type GscSyncTrigger } from "./store";
import { emptyGscReportCounts, GSC_REPORT_KINDS, type GscDateRange, type GscReportKind, type GscReportResult } from "./types";

export { GscSyncError } from "./store";
export type { GscSyncErrorCode, GscSyncTrigger } from "./store";
export type GscSyncMode = "auto" | "backfill";
export type GscSyncResult = {
  status: "completed" | "completed-with-warnings" | "failed" | "already-running";
  runId: string | null;
  startDate: string | null;
  endDate: string | null;
  reportCounts: Record<GscReportKind, number>;
  warnings: GscWarning[];
  error?: { code: string; message: string };
};
export type GscSyncDependencies = {
  store: GscStore;
  fetchReport: typeof fetchGscReport;
  probeCoverage: (target: GscSyncTarget, now: Date) => Promise<GscCoverage>;
  now: () => Date;
  randomId: () => string;
};

const ERROR_MESSAGES: Record<GscSyncErrorCode, string> = {
  NOT_FOUND: "Site or synchronization run was not found.",
  UNAUTHORIZED: "You do not own this site.",
  NO_PROPERTY: "Connect a Search Console property first.",
  REAUTH_REQUIRED: "Your Google connection has expired. Please reconnect your account.",
  PROVIDER_ERROR: "Search Console synchronization failed. Please try again.",
};

function safeError(error: unknown): { code: GscSyncErrorCode; message: string } {
  const code = error instanceof ReauthRequiredError || (error instanceof GscApiError && error.status === 401)
    ? "REAUTH_REQUIRED"
    : error instanceof GscSyncError && Object.hasOwn(ERROR_MESSAGES, error.code) ? error.code : "PROVIDER_ERROR";
  return { code, message: ERROR_MESSAGES[code] };
}

function emptyResult(): GscSyncResult {
  return { status: "failed", runId: null, startDate: null, endDate: null, reportCounts: emptyGscReportCounts(), warnings: [] };
}

export function createGscSyncService(deps: GscSyncDependencies): {
  syncTarget(target: GscSyncTarget, trigger: GscSyncTrigger, mode?: GscSyncMode): Promise<GscSyncResult>;
} {
  return {
    async syncTarget(target, trigger, mode = "auto") {
      const result = emptyResult();
      const reportStates: GscReportStates = {};
      let effectiveRange: GscDateRange | null = null;
      let reconciliation: GscReconciliation | null = null;
      let acquired = false;
      const ownerId = deps.randomId();
      const leaseRenewal = () => ({ ownerId, expiresAt: new Date(deps.now().getTime() + 30 * 60 * 1000) });
      const renewLease = async () => {
        if (!await deps.store.renewLease(target.siteId, ownerId, leaseRenewal().expiresAt)) {
          throw new GscSyncError("PROVIDER_ERROR", "The synchronization lease is no longer owned by this run.");
        }
      };
      try {
        const startedAt = deps.now();
        acquired = await deps.store.acquireLease(target.siteId, ownerId, new Date(startedAt.getTime() + 30 * 60 * 1000));
        if (!acquired) return { ...result, status: "already-running" };
        const days = mode === "backfill" || target.dataVersion < 2 ? 90 : 7;
        const requestedRange = inclusiveRangeEnding(shiftDateLabel(pacificDateLabel(startedAt), -3), days);
        result.runId = await deps.store.createRun({ siteId: target.siteId, searchType: target.searchType, trigger, requestedRange, startedAt });
        const coverage = await deps.probeCoverage(target, startedAt);
        effectiveRange = inclusiveRangeEnding(coverage.finalizedThrough, days);
        result.startDate = effectiveRange.startDate;
        result.endDate = effectiveRange.endDate;
        const reports: Partial<Record<GscReportKind, GscReportResult>> = {};
        for (let offset = 0; offset < GSC_REPORT_KINDS.length; offset += 2) {
          await renewLease();
          const kinds = GSC_REPORT_KINDS.slice(offset, offset + 2);
          // Drain both requests on failure before releasing the lease.
          const settled = await Promise.allSettled(kinds.map((kind) => deps.fetchReport(
            target.userId, target.property, effectiveRange!, kind, { type: target.searchType, dataState: "final" }
          )));
          for (const [index, response] of settled.entries()) {
            if (response.status === "fulfilled") {
              const kind = kinds[index];
              const report = response.value;
              reports[kind] = report;
              result.reportCounts[kind] = report.rows.length;
              reportStates[kind] = { complete: report.complete, pagesFetched: report.pagesFetched, truncatedAt: report.truncatedAt };
            }
          }
          for (const response of settled) if (response.status === "rejected") throw response.reason;
        }
        // Incomplete-only results also need to detect lease loss in the final batch.
        await renewLease();
        for (const kind of GSC_REPORT_KINDS) {
          const report = reports[kind]!;
          if (!report.complete) continue;
          await deps.store.replaceReport({ siteId: target.siteId, runId: result.runId, searchType: target.searchType,
            range: effectiveRange, kind, complete: true, pagesFetched: report.pagesFetched, truncatedAt: report.truncatedAt,
            lease: leaseRenewal(),
            rows: report.rows.map((row) => ({ ...row, siteId: target.siteId })),
          });
        }
        const metrics = (kind: GscReportKind) => ({ ...aggregateGscMetrics(reports[kind]!.rows), complete: reports[kind]!.complete });
        reconciliation = reconcileGscReports({ totals: metrics("dailyTotal"), query: metrics("query"), page: metrics("page"), device: metrics("device"), country: metrics("country"), reportStates });
        result.warnings = reconciliation.warnings;
        result.status = result.warnings.length ? "completed-with-warnings" : "completed";
        if (GSC_REPORT_KINDS.every((kind) => reports[kind]!.complete)) await deps.store.markSiteReady(target.siteId, deps.now(), leaseRenewal());
        await deps.store.finishRun({ siteId: target.siteId, runId: result.runId,
          status: result.status === "completed" ? "COMPLETED" : "COMPLETED_WITH_WARNINGS",
          effectiveRange, reportCounts: result.reportCounts, reportStates, reconciliation, finishedAt: deps.now(),
        });
      } catch (error) {
        result.status = "failed";
        const sanitized = safeError(error);
        result.error = sanitized;
        if (result.runId) {
          try {
            await deps.store.finishRun({ siteId: target.siteId, runId: result.runId, status: "FAILED", effectiveRange,
              reportCounts: result.reportCounts, reportStates, reconciliation, error: sanitized, finishedAt: deps.now(),
            });
          } catch {
            // A database outage may also prevent failure recording; never expose its details.
          }
        }
      } finally {
        if (acquired) {
          try { await deps.store.releaseLease(target.siteId, ownerId); }
          catch (error) { result.status = "failed"; result.error = safeError(error); }
        }
      }
      return result;
    },
  };
}

export async function syncGscSite(userId: string, siteId: string, trigger: GscSyncTrigger, mode: GscSyncMode = "auto"): Promise<GscSyncResult> {
  const target = await prismaGscStore.resolveOwnedTarget(userId, siteId);
  return createGscSyncService({
    store: prismaGscStore, fetchReport: fetchGscReport,
    probeCoverage: async (resolvedTarget, now) => probeFinalizedCoverage(await getAccessToken(resolvedTarget.userId), resolvedTarget.property, { now, type: resolvedTarget.searchType }),
    now: () => new Date(), randomId: randomUUID,
  }).syncTarget(target, trigger, mode);
}
