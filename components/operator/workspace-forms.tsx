"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

async function submit(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${response.status})`);
  }
}

const inputClass = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground";
const buttonClass = "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50";

export function PageInventoryForm({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [pageType, setPageType] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <form className="panel mb-5 grid gap-3 p-4 sm:grid-cols-[1fr_12rem_auto]" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try { await submit(`/api/sites/${siteId}/page-inventory`, { url, pageType }); setUrl(""); router.refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save page"); }
    finally { setBusy(false); }
  }}>
    <label className="text-xs text-muted-foreground">Canonical HTTPS URL<input required type="url" value={url} onChange={(event) => setUrl(event.target.value)} className={`mt-1 ${inputClass}`} placeholder="https://www.example.com/features/" /></label>
    <label className="text-xs text-muted-foreground">Page type<input value={pageType} onChange={(event) => setPageType(event.target.value)} className={`mt-1 ${inputClass}`} placeholder="Service, article…" /></label>
    <button disabled={busy} className={`${buttonClass} self-end`}>{busy ? "Saving…" : "Add page"}</button>
    {error && <p role="alert" className="text-sm text-danger sm:col-span-3">{error}</p>}
  </form>;
}

export function KeywordTargetForm({ siteId, pages, country, language }: {
  siteId: string; pages: { id: string; url: string }[]; country: string; language: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [decision, setDecision] = useState("OPTIMIZE_EXISTING");
  const [pageId, setPageId] = useState("");
  const [intent, setIntent] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const needsPage = decision === "OPTIMIZE_EXISTING" || decision === "CONSOLIDATE";
  return <form className="panel mb-5 grid gap-3 p-4 sm:grid-cols-2" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await submit(`/api/sites/${siteId}/keyword-targets`, { query, decision, pageId: needsPage ? pageId : null, country, language, intent });
      setQuery(""); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save target"); }
    finally { setBusy(false); }
  }}>
    <label className="text-xs text-muted-foreground">Customer query<input required value={query} onChange={(event) => setQuery(event.target.value)} className={`mt-1 ${inputClass}`} /></label>
    <label className="text-xs text-muted-foreground">Decision<select value={decision} onChange={(event) => setDecision(event.target.value)} className={`mt-1 ${inputClass}`}><option value="OPTIMIZE_EXISTING">Optimize existing page</option><option value="CONSOLIDATE">Consolidate pages</option><option value="CREATE_PAGE">Create page</option><option value="REJECT">Do not target</option></select></label>
    {needsPage && <label className="text-xs text-muted-foreground">Target page<select required value={pageId} onChange={(event) => setPageId(event.target.value)} className={`mt-1 ${inputClass}`}><option value="">Choose a page</option>{pages.map((page) => <option key={page.id} value={page.id}>{page.url}</option>)}</select></label>}
    <label className="text-xs text-muted-foreground">Intent<input value={intent} onChange={(event) => setIntent(event.target.value)} className={`mt-1 ${inputClass}`} placeholder="Commercial, informational…" /></label>
    <div className="flex items-end gap-3"><button disabled={busy || (needsPage && !pageId)} className={buttonClass}>{busy ? "Saving…" : "Confirm target"}</button><span className="pb-2 text-xs text-muted-foreground">{country} · {language}</span></div>
    {error && <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p>}
  </form>;
}

export function CreateBriefButton({ siteId, targetId }: { siteId: string; targetId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div><button disabled={busy} className="text-sm font-medium text-signal hover:underline disabled:opacity-50" onClick={async () => {
    setBusy(true); setError("");
    try { await submit(`/api/sites/${siteId}/briefs`, { targetId }); router.refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create brief"); }
    finally { setBusy(false); }
  }}>{busy ? "Creating…" : "Create evidence brief"}</button>{error && <p role="alert" className="text-xs text-danger">{error}</p>}</div>;
}
