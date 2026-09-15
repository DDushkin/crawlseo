import type { GscDataHealth } from "@/lib/gsc/health";
import { GscHealthStatus } from "@/components/sites/gsc-data-health";

export function DataLagBadge({ health }: { health?: GscDataHealth }) {
  // Older call sites have no observed coverage to display.
  if (!health) return null;
  return (
    <div className="inline-flex flex-wrap items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
      <GscHealthStatus health={health} />
      <span>{health.endDate ? `Covered through ${health.endDate}` : "No covered dates"}</span>
    </div>
  );
}
