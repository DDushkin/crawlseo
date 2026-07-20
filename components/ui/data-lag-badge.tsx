"use client";

import { Info } from "lucide-react";

export function DataLagBadge() {
  // GSC data is typically delayed 2-3 days
  const lagDate = new Date();
  lagDate.setDate(lagDate.getDate() - 3);
  const formatted = lagDate.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground">
      <Info className="size-3" />
      <span>GSC data through ~{formatted}</span>
    </div>
  );
}
