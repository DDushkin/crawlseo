"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GscSyncResult } from "@/lib/gsc/sync-service";

type SyncFeedback = { message: string; counts: string | null; tone: "success" | "warning" | "neutral" | "error"; refresh: boolean; reauthRequired: boolean };

export function projectSyncFeedback(body: unknown, httpStatus: number): SyncFeedback {
  const fallback: SyncFeedback = { message: "Search Console synchronization failed. Please try again.", counts: null, tone: "error", refresh: false, reauthRequired: false };
  if (!body || typeof body !== "object") return fallback;
  const data = body as Omit<Partial<GscSyncResult>, "error"> & { code?: string; error?: string | { code: string; message: string } };
  const error = typeof data.error === "object" ? data.error : undefined;
  if (data.code === "REAUTH_REQUIRED" || error?.code === "REAUTH_REQUIRED") return { ...fallback, reauthRequired: true, message: "Your Google connection expired. Reconnect to sync again." };
  if (data.status === "already-running") return { ...fallback, message: "A sync is already running", tone: "neutral" };
  if (httpStatus >= 400 || data.status === "failed") return { ...fallback,
    message: typeof data.error === "string" ? data.error : error?.message ?? fallback.message };
  if (data.status !== "completed" && data.status !== "completed-with-warnings") return fallback;
  const labels = { dailyTotal: "daily totals", query: "query rows", page: "page rows", queryPage: "query/page rows", device: "device rows", country: "country rows" } as const;
  const counts = data.reportCounts ? Object.entries(labels).map(([kind, label]) => {
    const count = data.reportCounts?.[kind as keyof typeof labels];
    return `${typeof count === "number" && Number.isFinite(count) ? count.toLocaleString() : "—"} ${label}`;
  }).join(" · ") : null;
  return { message: data.status === "completed-with-warnings" ? "Synced with data warnings"
    : data.endDate ? `Synced through ${data.endDate}` : "Sync completed; no finalized dates were returned.",
    counts, tone: data.status === "completed-with-warnings" ? "warning" : "success", refresh: true, reauthRequired: false };
}

export function SyncButton({
  siteId,
  className,
  fullWidth = false,
}: {
  siteId: string;
  className?: string;
  fullWidth?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<SyncFeedback | null>(null);

  const handleSync = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setLoading(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/gsc/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId }),
      });

      const data = await response.json();

      const next = projectSyncFeedback(data, response.status);
      setFeedback(next);
      if (next.refresh) router.refresh();
    } catch {
      setFeedback(projectSyncFeedback(null, 502));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={cn(fullWidth && "w-full", "min-w-0 space-y-2")}>
      <Button
        onClick={handleSync}
        disabled={loading}
        className={cn(fullWidth && "w-full", className)}
        size="sm"
      >
        {loading ? "Syncing…" : "Sync GSC"}
      </Button>
      <div aria-live="polite" aria-atomic="true">
      {feedback?.reauthRequired && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="text-sm">
            <p className="text-muted-foreground">
              Your Google connection expired.{" "}
              <button
                onClick={() => signIn("google")}
                className="rounded font-medium text-primary underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Reconnect &rarr;
              </button>
            </p>
          </div>
        </div>
      )}
      {feedback && !feedback.reauthRequired && (
        <p
          className={cn(
            "max-w-md text-atom-caption wrap-anywhere",
            feedback.tone === "error" ? "text-danger" : feedback.tone === "warning" ? "text-warning" : feedback.tone === "success" ? "text-signal" : "text-muted-foreground",
            fullWidth && "text-center"
          )}
        >
          {feedback.message}
          {feedback.counts && <span className="mt-1 block text-muted-foreground">{feedback.counts}</span>}
        </p>
      )}
      </div>
    </div>
  );
}
