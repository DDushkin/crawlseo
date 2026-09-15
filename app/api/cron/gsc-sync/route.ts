import { randomUUID } from "node:crypto";

import { isAuthorizedCronRequest } from "@/lib/gsc/cron-auth";
import { createGscSyncService, GscSyncError } from "@/lib/gsc/sync-service";
import { prismaGscStore, type GscSyncErrorCode } from "@/lib/gsc/store";
import { fetchGscReport, probeFinalizedCoverage } from "@/lib/google/gsc-client";
import { getAccessToken } from "@/lib/google/google-auth";

type SyncCounts = {
  completed: number;
  completedWithWarnings: number;
  alreadyRunning: number;
  failed: number;
};

function sanitizedErrorCode(error: unknown): GscSyncErrorCode {
  if (error instanceof GscSyncError) return error.code;
  return error === "NOT_FOUND" || error === "UNAUTHORIZED" || error === "NO_PROPERTY" ||
    error === "REAUTH_REQUIRED" || error === "PROVIDER_ERROR" ? error : "PROVIDER_ERROR";
}

export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createGscSyncService({
    store: prismaGscStore,
    fetchReport: fetchGscReport,
    probeCoverage: async (target, now) => probeFinalizedCoverage(
      await getAccessToken(target.userId),
      target.property,
      { now, type: target.searchType }
    ),
    now: () => new Date(),
    randomId: randomUUID,
  });
  const counts: SyncCounts = {
    completed: 0,
    completedWithWarnings: 0,
    alreadyRunning: 0,
    failed: 0,
  };
  const errors: Array<{ siteId: string; code: GscSyncErrorCode }> = [];
  const targets = await prismaGscStore.listScheduledTargets();

  for (const target of targets) {
    try {
      const result = await service.syncTarget(target, "SCHEDULED", "auto");
      if (result.status === "completed") counts.completed += 1;
      else if (result.status === "completed-with-warnings") counts.completedWithWarnings += 1;
      else if (result.status === "already-running") counts.alreadyRunning += 1;
      else {
        counts.failed += 1;
        errors.push({
          siteId: target.siteId,
          code: sanitizedErrorCode(result.error?.code),
        });
      }
    } catch (error) {
      counts.failed += 1;
      errors.push({ siteId: target.siteId, code: sanitizedErrorCode(error) });
    }
  }

  return Response.json({ counts, errors });
}
