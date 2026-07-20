"use client";

import { Download } from "lucide-react";

interface CsvExportButtonProps {
  siteId: string;
  type: "keywords" | "pages";
  label?: string;
}

export function CsvExportButton({ siteId, type, label }: CsvExportButtonProps) {
  return (
    <a
      href={`/api/sites/${siteId}/export?type=${type}`}
      download
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-secondary"
    >
      <Download className="size-3" />
      {label ?? `Export ${type} CSV`}
    </a>
  );
}
