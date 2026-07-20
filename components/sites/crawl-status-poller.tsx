"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

interface CrawlStatusPollerProps {
  siteId: string;
  crawlId: string;
}

interface CrawlStatus {
  id: string;
  status: string;
  pagesFound: number;
  issuesFound: number;
  healthScore: number | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export function CrawlStatusPoller({ siteId, crawlId }: CrawlStatusPollerProps) {
  const router = useRouter();
  const [status, setStatus] = useState<CrawlStatus | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/sites/${siteId}/crawl/${crawlId}/status`);
      if (!res.ok) return;
      const data = (await res.json()) as CrawlStatus;
      setStatus(data);
      if (data.status === "COMPLETED" || data.status === "FAILED") {
        router.refresh();
      }
    } catch {
      // ignore
    }
  }, [siteId, crawlId, router]);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [poll]);

  const isRunning = !status || status.status === "RUNNING" || status.status === "PENDING";

  if (!isRunning) return null;

  return (
    <div className="panel mb-6 flex items-center gap-3 border-primary/30 bg-primary/5 px-5 py-4">
      <Loader2 className="size-5 animate-spin text-primary" />
      <div>
        <p className="text-sm font-medium text-foreground">
          Crawl in progress...
        </p>
        <p className="text-xs text-muted-foreground">
          {status?.pagesFound ?? 0} pages found · {status?.issuesFound ?? 0} issues
        </p>
      </div>
    </div>
  );
}
