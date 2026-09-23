"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const field = "mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm";

export function PlacementForm({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [articleUrl, setArticleUrl] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [articleTitle, setArticleTitle] = useState("");
  const [anchorText, setAnchorText] = useState("");
  const [publishedAt, setPublishedAt] = useState("");
  const [costUah, setCostUah] = useState("");
  const [feeUah, setFeeUah] = useState("0");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <form className="panel mb-5 grid gap-3 p-5 sm:grid-cols-2" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch(`/api/sites/${siteId}/placements`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleUrl, targetUrl, articleTitle, anchorText, publishedAt,
          status: publishedAt ? "PUBLISHED" : "PLANNED", costUah: Number(costUah), feeUah: Number(feeUah) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save placement");
      setArticleUrl(""); setTargetUrl(""); setArticleTitle(""); setAnchorText(""); setPublishedAt(""); setCostUah(""); setFeeUah("0"); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save placement"); }
    finally { setBusy(false); }
  }}>
    <label className="text-xs text-muted-foreground">Published article URL<input required type="url" value={articleUrl} onChange={(event) => setArticleUrl(event.target.value)} className={field} placeholder="https://publisher.example/article" /></label>
    <label className="text-xs text-muted-foreground">Linked Strum page<input required type="url" value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} className={field} placeholder="https://www.strum.capital/features/" /></label>
    <label className="text-xs text-muted-foreground">Article title<input value={articleTitle} onChange={(event) => setArticleTitle(event.target.value)} className={field} /></label>
    <label className="text-xs text-muted-foreground">Expected anchor<input value={anchorText} onChange={(event) => setAnchorText(event.target.value)} className={field} /></label>
    <label className="text-xs text-muted-foreground">Publication date (leave empty if planned)<input type="date" value={publishedAt} onChange={(event) => setPublishedAt(event.target.value)} className={field} /></label>
    <div className="grid grid-cols-2 gap-2"><label className="text-xs text-muted-foreground">Placement (UAH)<input required type="number" min="0" step="0.01" value={costUah} onChange={(event) => setCostUah(event.target.value)} className={field} /></label><label className="text-xs text-muted-foreground">Agency fee (UAH)<input required type="number" min="0" step="0.01" value={feeUah} onChange={(event) => setFeeUah(event.target.value)} className={field} /></label></div>
    <button disabled={busy} className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{busy ? "Saving…" : "Save placement"}</button>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </form>;
}

export function CheckPlacementButton({ siteId, placementId }: { siteId: string; placementId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <span><button disabled={busy} className="text-sm text-signal hover:underline disabled:opacity-50" onClick={async () => {
    setBusy(true); setError("");
    try { const response = await fetch(`/api/sites/${siteId}/placements/${placementId}/check`, { method: "POST" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Check failed"); router.refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Check failed"); }
    finally { setBusy(false); }
  }}>{busy ? "Checking…" : "Check live article"}</button>{error && <span role="alert" className="block text-xs text-danger">{error}</span>}</span>;
}

export function PlacementOutcomeButton({ siteId, placementId }: { siteId: string; placementId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<{ status: string; baseline?: { clicks: number } | null; after?: { clicks: number } | null; clickDelta?: number | null; qualification: string } | null>(null);
  return <span><button disabled={busy} className="text-sm text-signal hover:underline disabled:opacity-50" onClick={async () => {
    setBusy(true); setError("");
    try { const response = await fetch(`/api/sites/${siteId}/placements/${placementId}/outcome`);
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Measurement failed"); setOutcome(data); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Measurement failed"); }
    finally { setBusy(false); }
  }}>{busy ? "Measuring…" : "Measure page trend"}</button>{outcome && <span className="mt-1 block text-xs text-muted-foreground">{outcome.status}: {outcome.status === "OBSERVED" ? `${outcome.baseline?.clicks ?? "—"} → ${outcome.after?.clicks ?? "—"} clicks (${outcome.clickDelta !== null && outcome.clickDelta !== undefined && outcome.clickDelta >= 0 ? "+" : ""}${outcome.clickDelta ?? "—"}) · ` : ""}{outcome.qualification}</span>}{error && <span role="alert" className="block text-xs text-danger">{error}</span>}</span>;
}

export function CompareCrawlsButton({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <span><button disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" onClick={async () => {
    setBusy(true); setError("");
    try { const response = await fetch(`/api/sites/${siteId}/crawl-comparisons`, { method: "POST" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Comparison failed"); router.refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Comparison failed"); }
    finally { setBusy(false); }
  }}>{busy ? "Comparing…" : "Compare latest crawl"}</button>{error && <span role="alert" className="block text-xs text-danger">{error}</span>}</span>;
}
