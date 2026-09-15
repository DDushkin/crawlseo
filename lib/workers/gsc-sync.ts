import { syncGscSite, type GscSyncMode } from "@/lib/gsc/sync-service";

/**
 * Backwards-compatible entry point for callers that predate the GSC V2 service.
 */
export function syncGSCDataForSite(
  userId: string,
  siteId: string,
  mode: GscSyncMode = "auto"
) {
  return syncGscSite(
    userId,
    siteId,
    mode === "backfill" ? "INITIAL" : "SCHEDULED",
    mode
  );
}
