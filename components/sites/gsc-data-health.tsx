import { AlertTriangle, CheckCircle2, Clock3, Info, RefreshCw } from "lucide-react";
import type { GscDataHealth } from "@/lib/gsc/health";
import { cn } from "@/lib/utils";

const states = {
  unavailable: { label: "Data unavailable", color: "text-muted-foreground", icon: Info },
  syncing: { label: "Syncing", color: "text-muted-foreground", icon: RefreshCw },
  fresh: { label: "Up to date", color: "text-signal", icon: CheckCircle2 },
  stale: { label: "Data is stale", color: "text-warning", icon: Clock3 },
  partial: { label: "Data warnings", color: "text-warning", icon: AlertTriangle },
  failed: { label: "Sync failed", color: "text-danger", icon: AlertTriangle },
  "reauth-required": { label: "Reconnect Google", color: "text-warning", icon: AlertTriangle },
} as const;

export function GscHealthStatus({ health }: { health: GscDataHealth }) {
  const { label, color, icon: Icon } = states[health.state];
  return <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", color)}>
    <Icon aria-hidden="true" className="size-3.5 shrink-0" />{label}
  </span>;
}

export function GscDataHealthPanel({ health }: { health: GscDataHealth }) {
  const warning = health.warnings[0];
  return (
    <section aria-label="Search Console data health" className="panel mb-6 min-w-0 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-base font-semibold">Search Console data health</h2>
        <GscHealthStatus health={health} />
      </div>
      <dl className="mt-4 grid min-w-0 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <div className="min-w-0 sm:col-span-2 xl:col-span-1">
          <dt className="text-muted-foreground">Property · {health.searchType}</dt>
          <dd className="mt-1 wrap-anywhere">{health.property ?? "No property connected"}</dd>
        </div>
        <div><dt className="text-muted-foreground">Stored date range</dt>
          <dd className="mt-1 font-data">{health.startDate && health.endDate ? `${health.startDate} – ${health.endDate}` : "No covered dates"}</dd></div>
        <div><dt className="text-muted-foreground">Last successful sync</dt>
          <dd className="mt-1">{health.lastSuccessfulSync ? <time dateTime={health.lastSuccessfulSync}>{new Date(health.lastSuccessfulSync).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC</time> : "No successful sync yet"}</dd></div>
        <div><dt className="text-muted-foreground">Query click coverage</dt>
          <dd className="mt-1 font-data">{health.queryClickCoverage === null ? "Not available" : health.queryClickCoverage.toLocaleString(undefined, { style: "percent", maximumFractionDigits: 1 })}</dd></div>
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">Query coverage is from the last successful run. Search Console may omit anonymized queries.</p>
      {warning ? <p className="mt-3 text-sm wrap-anywhere">{warning.message}{health.state === "partial" && " Run sync again to refresh the reports."}</p>
        : health.state === "stale" ? <p className="mt-3 text-sm">Run sync to check for newer finalized data.</p>
        : health.state === "unavailable" ? <p className="mt-3 text-sm">{health.property ? "Run sync to load finalized Search Console data." : "Connect a Search Console property in site settings."}</p> : null}
    </section>
  );
}
