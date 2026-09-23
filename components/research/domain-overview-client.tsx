"use client";

import { useState } from "react";
import {
  Globe,
  Search,
  Loader2,
  AlertTriangle,
  ArrowRightLeft,
} from "lucide-react";
import Link from "next/link";
import { confirmDataForSeoRequest } from "./dataforseo-confirm";

type DomainData = {
  source: string;
  domain: string;
  overview: {
    organicKeywords: number;
    organicTraffic: number;
    organicCost: number | null;
    backlinks: number | null;
    referringDomains: number | null;
  } | null;
  backlinks: {
    totalBacklinks: number;
    referringDomains: number;
    dofollow: number;
    nofollow: number;
  } | null;
  metrics?: {
    current: { clicks: number; impressions: number; avgPosition: number | null };
    previous: { clicks: number; impressions: number; avgPosition: number | null };
    deltas: { clicks: number; impressions: number; avgPosition: number | null };
  };
};

export function DomainOverviewClient({
  siteId,
  domain,
  hasDataForSEO,
}: {
  siteId: string;
  domain: string;
  hasDataForSEO: boolean;
}) {
  const [ownData, setOwnData] = useState<DomainData | null>(null);
  const [competitorDomain, setCompetitorDomain] = useState("");
  const [competitorData, setCompetitorData] = useState<DomainData | null>(null);
  const [loadingOwn, setLoadingOwn] = useState(false);
  const [loadingCompetitor, setLoadingCompetitor] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadOwnDomain() {
    setLoadingOwn(true);
    setError(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/domain-overview`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "GSC request failed");
      setOwnData(data);
      setLoaded(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "GSC request failed");
    } finally {
      setLoadingOwn(false);
    }
  }

  async function loadProviderDomain(target: string, competitor: boolean) {
    setError(null);
    try {
      if (!await confirmDataForSeoRequest(siteId, "domain", target)) return;
      if (competitor) setLoadingCompetitor(true); else setLoadingOwn(true);
      const res = await fetch(`/api/sites/${siteId}/domain-overview`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "DataForSEO request failed");
      if (competitor) setCompetitorData(data); else { setOwnData(data); setLoaded(true); }
    } catch (error) {
      setError(error instanceof Error ? error.message : "DataForSEO request failed");
    } finally {
      if (competitor) setLoadingCompetitor(false); else setLoadingOwn(false);
    }
  }

  async function handleCompare(e: React.FormEvent) {
    e.preventDefault();
    if (!competitorDomain.trim()) return;

    if (!loaded) await loadOwnDomain();
    await loadProviderDomain(competitorDomain.trim(), true);
  }

  return (
    <div className="space-y-6">
      {!hasDataForSEO && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="text-sm">
            <p className="font-medium text-foreground">
              Limited data — GSC metrics only
            </p>
            <p className="mt-0.5 text-muted-foreground">
              Add a DataForSEO API key in{" "}
              <Link
                href={`/sites/${siteId}/settings`}
                className="text-primary underline underline-offset-2"
              >
                Settings
              </Link>{" "}
              for full domain analysis and competitor comparison.
            </p>
          </div>
        </div>
      )}

      {/* Load own domain / Compare competitor */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <button
          type="button"
          onClick={loadOwnDomain}
          disabled={loadingOwn}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
        >
          {loadingOwn ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Globe className="size-4" />
          )}
          View GSC {domain}
        </button>

        {hasDataForSEO && (
          <button type="button" onClick={() => loadProviderDomain(domain, false)} disabled={loadingOwn}
            className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted disabled:opacity-50">
            DataForSEO analysis (preview cost)
          </button>
        )}

        {hasDataForSEO && (
          <form onSubmit={handleCompare} className="flex flex-1 gap-2">
            <div className="relative flex-1">
              <ArrowRightLeft className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={competitorDomain}
                onChange={(e) => setCompetitorDomain(e.target.value)}
                placeholder="Enter competitor domain..."
                className="w-full rounded-lg border border-border bg-background py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <button
              type="submit"
              disabled={!competitorDomain.trim() || loadingCompetitor}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
            >
              {loadingCompetitor ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Search className="size-4" />
              )}
              Compare via DataForSEO
            </button>
          </form>
        )}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {(ownData?.source === "dataforseo-sandbox" || competitorData?.source === "dataforseo-sandbox") && (
        <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning">Sandbox values are synthetic and should not be used for decisions.</p>
      )}

      {/* Results - side by side */}
      {(ownData || competitorData) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {ownData && (
            <DomainCard data={ownData} label="Your Domain" />
          )}
          {competitorData && (
            <DomainCard data={competitorData} label="Competitor" />
          )}
        </div>
      )}
    </div>
  );
}

function DomainCard({ data, label }: { data: DomainData; label: string }) {
  return (
    <div className="panel p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
            {label}
          </p>
          <h3 className="font-heading text-lg font-semibold text-foreground">
            {data.domain}
          </h3>
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
          {data.source}
        </span>
      </div>

      {data.overview ? (
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            label={data.source === "gsc" ? "Observed GSC queries" : "Estimated organic keywords"}
            value={data.overview.organicKeywords.toLocaleString()}
          />
          <MetricCard
            label={data.source === "gsc" ? "GSC clicks (28 days)" : "Estimated monthly traffic"}
            value={data.overview.organicTraffic.toLocaleString()}
          />
          {data.overview.organicCost != null && (
            <MetricCard
              label="Traffic Cost"
              value={`$${data.overview.organicCost.toLocaleString()}`}
            />
          )}
          {data.overview.backlinks != null && (
            <MetricCard
              label="Backlinks"
              value={data.overview.backlinks.toLocaleString()}
            />
          )}
          {data.overview.referringDomains != null && (
            <MetricCard
              label="Referring Domains"
              value={data.overview.referringDomains.toLocaleString()}
            />
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center py-8 text-center">
          <Globe className="size-8 text-muted-foreground/30" />
          <p className="mt-2 text-sm text-muted-foreground">
            No data available for this domain
          </p>
        </div>
      )}

      {data.backlinks && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Backlink Summary
          </p>
          <div className="grid grid-cols-2 gap-3">
            <MetricCard
              label="Total Backlinks"
              value={data.backlinks.totalBacklinks.toLocaleString()}
            />
            <MetricCard
              label="Referring Domains"
              value={data.backlinks.referringDomains.toLocaleString()}
            />
            <MetricCard
              label="Not nofollow"
              value={data.backlinks.dofollow.toLocaleString()}
            />
            <MetricCard
              label="Nofollow"
              value={data.backlinks.nofollow.toLocaleString()}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-panel/80 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-data text-lg font-semibold text-foreground">
        {value}
      </p>
    </div>
  );
}
