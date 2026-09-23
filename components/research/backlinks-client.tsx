"use client";

import { useState } from "react";
import {
  Link as LinkIcon,
  Loader2,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { confirmDataForSeoRequest } from "./dataforseo-confirm";

type BacklinkItem = {
  referringDomain: string;
  sourceUrl: string;
  targetUrl: string;
  anchorText: string;
  dofollow: boolean | null;
  firstSeen: string | null;
  lastSeen: string | null;
};

type BacklinksOverview = {
  totalBacklinks: number;
  referringDomains: number;
  referringIps?: number;
  dofollow: number;
  nofollow: number;
};

export function BacklinksClient({
  siteId,
  domain,
  hasDataForSEO,
}: {
  siteId: string;
  domain: string;
  hasDataForSEO: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [overview, setOverview] = useState<BacklinksOverview | null>(null);
  const [backlinks, setBacklinks] = useState<BacklinkItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLoad() {
    setError(null);
    try {
      if (!await confirmDataForSeoRequest(siteId, "backlinks", domain, 50)) return;
      setLoading(true);
      const res = await fetch(`/api/sites/${siteId}/backlinks`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, limit: 50 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Backlink request failed");
      setSource(data.source);
      setOverview(data.overview);
      setBacklinks(data.backlinks ?? []);
      setLoaded(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Backlink request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {!hasDataForSEO && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="text-sm">
            <p className="font-medium text-foreground">
              Limited backlink data
            </p>
            <p className="mt-0.5 text-muted-foreground">
              Add a DataForSEO API key in{" "}
              <Link
                href={`/sites/${siteId}/settings`}
                className="text-primary underline underline-offset-2"
              >
                Settings
              </Link>{" "}
              for full backlink analysis with referring domains and anchor text.
            </p>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={handleLoad}
        disabled={loading || !hasDataForSEO}
        className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : loaded ? (
          <RefreshCw className="size-4" />
        ) : (
          <LinkIcon className="size-4" />
        )}
        {loaded ? "Refresh (preview cost)" : "Load inbound backlinks (preview cost)"}
      </button>
      {error && <p className="text-sm text-danger">{error}</p>}
      {source === "dataforseo-sandbox" && (
        <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning">Sandbox backlinks are dummy data, not real links to {domain}.</p>
      )}

      {/* Overview stats */}
      {overview && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Total Backlinks"
            value={overview.totalBacklinks.toLocaleString()}
          />
          <StatCard
            label="Referring Domains"
            value={overview.referringDomains.toLocaleString()}
          />
          <StatCard
            label="Not nofollow"
            value={overview.dofollow.toLocaleString()}
          />
          <StatCard
            label="Nofollow"
            value={overview.nofollow.toLocaleString()}
          />
        </div>
      )}

      {/* Backlinks table */}
      {loaded && backlinks.length > 0 && (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-3 font-medium text-muted-foreground">
                    Referring Domain
                  </th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">
                    Target URL
                  </th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">
                    Anchor Text
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Type
                  </th>
                </tr>
              </thead>
              <tbody>
                {backlinks.map((link, i) => (
                  <tr
                    key={`${link.sourceUrl}-${i}`}
                    className="border-b border-border/50 transition-colors hover:bg-muted/25"
                  >
                    <td className="max-w-[200px] px-4 py-3">
                      <span className="block truncate font-medium text-foreground">
                        {referringLabel(link)}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {link.sourceUrl}
                      </span>
                    </td>
                    <td className="max-w-[200px] px-4 py-3">
                      <span className="block truncate text-foreground">
                        {link.targetUrl}
                      </span>
                    </td>
                    <td className="max-w-[150px] px-4 py-3">
                      <span className="block truncate text-muted-foreground">
                        {link.anchorText || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          link.dofollow
                            ? "bg-signal/10 text-signal"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {link.dofollow == null ? "unknown" : link.dofollow ? "dofollow" : "nofollow"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-border bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
            {backlinks.length} backlink{backlinks.length !== 1 ? "s" : ""}
            {source === "dataforseo-sandbox" ? " via DataForSEO Sandbox (dummy)" : " via DataForSEO Live"}
          </div>
        </div>
      )}

      {/* Empty state */}
      {loaded && backlinks.length === 0 && (
        <div className="panel flex flex-col items-center py-12 text-center">
          <LinkIcon className="size-10 text-muted-foreground/30" />
          <p className="mt-3 font-medium text-foreground">No backlinks found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {source === "none"
              ? "Connect DataForSEO to check inbound backlinks. Site crawls only see outgoing links."
              : "No inbound backlink data available"}
          </p>
        </div>
      )}
    </div>
  );
}

function referringLabel(link: BacklinkItem) {
  if (link.referringDomain) return link.referringDomain;
  try { return new URL(link.sourceUrl).hostname; } catch { return "—"; }
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-data text-xl font-semibold text-foreground">
        {value}
      </p>
    </div>
  );
}
