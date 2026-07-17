import { getSitePeriodMetrics, formatCompact, formatCtr } from "@/lib/seo-metrics";
import { formatDeltaPercent, formatDeltaPosition } from "@/lib/format";
import { cn } from "@/lib/utils";

interface MetricsProps {
  siteId: string;
  days?: number;
}

function MetricCard({
  label,
  value,
  delta,
  deltaLabel,
  hint,
}: {
  label: string;
  value: string;
  delta: number;
  deltaLabel: string;
  hint?: string;
}) {
  const isFlat = !Number.isFinite(delta) || Math.abs(delta) < 0.05;
  const good = delta > 0;

  return (
    <div className="panel relative p-5">
      <p className="text-atom-caption font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="font-heading text-atom-display1 font-semibold tracking-tight text-foreground">
          {value}
        </p>
        <div
          className={cn(
            "rounded-md px-2 py-1 font-data text-xs font-semibold",
            isFlat && "bg-muted text-muted-foreground",
            !isFlat && good && "bg-signal-muted text-signal",
            !isFlat && !good && "bg-[var(--a-danger-300)] text-[var(--a-danger-900)]"
          )}
        >
          {isFlat ? "—" : deltaLabel}
        </div>
      </div>
      <p className="mt-2 text-atom-caption text-muted-foreground">
        {hint ?? "vs previous period"}
      </p>
    </div>
  );
}

export async function DashboardMetrics({ siteId, days = 28 }: MetricsProps) {
  const { current, deltas } = await getSitePeriodMetrics(siteId, days);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        label="Clicks"
        value={formatCompact(current.clicks)}
        delta={deltas.clicks}
        deltaLabel={formatDeltaPercent(deltas.clicks)}
        hint={`Last ${days} days vs prior`}
      />
      <MetricCard
        label="Impressions"
        value={formatCompact(current.impressions)}
        delta={deltas.impressions}
        deltaLabel={formatDeltaPercent(deltas.impressions)}
        hint={`Last ${days} days vs prior`}
      />
      <MetricCard
        label="Avg position"
        value={current.avgPosition > 0 ? current.avgPosition.toFixed(1) : "—"}
        delta={deltas.avgPosition}
        deltaLabel={formatDeltaPosition(deltas.avgPosition)}
        hint="Weighted by impressions · lower is better"
      />
      <MetricCard
        label="Avg CTR"
        value={formatCtr(current.avgCtr)}
        delta={deltas.avgCtr}
        deltaLabel={formatDeltaPercent(deltas.avgCtr)}
        hint={`${current.uniqueKeywords.toLocaleString()} keywords with data`}
      />
    </div>
  );
}
