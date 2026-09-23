"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type PanelPreview = { mode: string; promptIds: string[]; prompts: { question: string; country: string; language: string }[];
  estimatedUsd: number; cachedRequests: number; uncachedRequests: number; budgetUsd: number; spentUsd: number; reservedUsd: number; locationCode: number; languageCode: string };

export function GscAiImportControl({ siteId, property }: { siteId: string; property: string | null }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ rowCount: number; firstDate: string; lastDate: string; impressions: number } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function uploadPreview(nextFile: File) {
    setFile(nextFile); setPreview(null); setMessage(""); setConfirmed(false); setBusy(true);
    try { const form = new FormData(); form.set("file", nextFile);
      const response = await fetch(`/api/sites/${siteId}/gsc-ai-import/preview`, { method: "POST", body: form });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not preview export"); setPreview(data); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Could not preview export"); }
    finally { setBusy(false); }
  }
  async function importFile() {
    if (!file || !property || !confirmed) return;
    setBusy(true); setMessage("");
    try { const form = new FormData(); form.set("file", file); form.set("property", property); form.set("confirmedProperty", "true");
      const response = await fetch(`/api/sites/${siteId}/gsc-ai-import`, { method: "POST", body: form });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not import export");
      setMessage(data.imported ? `Imported ${data.rows} daily rows.` : data.reason); setPreview(null); setFile(null); router.refresh(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Could not import export"); }
    finally { setBusy(false); }
  }
  return <section className="panel p-5"><h2 className="font-heading text-lg font-semibold">Google AI impressions</h2>
    <p className="mt-2 text-sm text-muted-foreground">Export the chart CSV from Search Console → Performance → Generative AI (Search). It reports AI Overviews and AI Mode impressions, already included in Web performance. Upload the chart, not the Pages table.</p>
    <p className="mt-2 text-xs text-muted-foreground">Selected property: {property || "not connected"}. The CSV does not embed a verifiable property ID, so you must confirm its origin. Google exports unavailable ~ / – values as zero.</p>
    <input disabled={!property || busy} className="mt-3 block max-w-full text-sm" type="file" accept=".csv" onChange={(event) => { const next = event.target.files?.[0]; if (next) void uploadPreview(next); }} />
    {preview && <div className="mt-3 rounded-lg border border-border p-3 text-sm"><p>{preview.rowCount} days · {preview.firstDate} to {preview.lastDate} · {preview.impressions.toLocaleString()} impressions</p>
      <label className="mt-2 flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I exported this chart from the selected property&apos;s Generative AI (Search) report.</label>
      <button disabled={!confirmed || busy} onClick={() => void importFile()} className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">Import confirmed export</button></div>}
    {message && <p role="status" className="mt-2 text-sm text-muted-foreground">{message}</p>}
  </section>;
}

export function Ga4Controls({ siteId, propertyId, lastSync, credentialConnected }: { siteId: string; propertyId: string | null; lastSync: string | null; credentialConnected: boolean }) {
  const router = useRouter();
  const [input, setInput] = useState(propertyId || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function connect() {
    setBusy(true); setMessage("");
    try { const response = await fetch(`/api/sites/${siteId}/ga4/connect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ propertyId: input }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not connect GA4");
      setMessage(`Connected GA4 property ${data.propertyId}. Run the first sync.`); router.refresh(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Could not connect GA4"); }
    finally { setBusy(false); }
  }
  async function sync() {
    setBusy(true); setMessage("");
    try { const response = await fetch(`/api/sites/${siteId}/ga4/sync`, { method: "POST" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not sync GA4");
      setMessage(`Synced ${data.start} to ${data.end}: ${data.aiRows} AI-referrer rows, ${data.organicRows} organic rows.`); router.refresh(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Could not sync GA4"); }
    finally { setBusy(false); }
  }
  return <section className="panel p-5"><h2 className="font-heading text-lg font-semibold">GA4 referrals and conversions</h2>
    <p className="mt-2 text-sm text-muted-foreground">Connect a service account in <Link href={`/sites/${siteId}/settings`} className="text-signal hover:underline">Settings</Link>, grant it Viewer access to this GA4 property, then enter the numeric property ID. Only known AI referrers are classified; direct visits without referrer are not counted as AI.</p>
    {!credentialConnected && <p className="mt-2 text-sm text-warning">No GA4 service account connected yet. Add one in Settings before connecting or syncing this property.</p>}
    <div className="mt-3 flex flex-wrap gap-2">
      <input inputMode="numeric" value={input} onChange={(event) => setInput(event.target.value)} placeholder="GA4 property ID" aria-label="GA4 property ID" className="rounded-lg border border-border bg-card px-3 py-2 text-sm" />
      <button disabled={busy || !credentialConnected || !input.trim()} onClick={() => void connect()} className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">Connect property</button>
      <button disabled={busy || !credentialConnected || !propertyId} onClick={() => void sync()} className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50">Sync 90 days</button></div>
    <p className="mt-2 text-xs text-muted-foreground">{propertyId ? `Connected property ${propertyId}` : "No GA4 property connected"} · {lastSync ? `Last sync ${new Date(lastSync).toLocaleString()}` : "No successful sync"}</p>
    {message && <p role="status" className="mt-2 text-sm text-muted-foreground">{message}</p>}
  </section>;
}

export function AiPanelRunControl({ siteId, activeRun, providerConnected }: { siteId: string; providerConnected: boolean;
  activeRun: { id: string; status: string; promptCount: number; completedCount: number } | null }) {
  const router = useRouter();
  const [preview, setPreview] = useState<PanelPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function getPreview() {
    setBusy(true); setMessage(""); setPreview(null);
    try { const response = await fetch(`/api/sites/${siteId}/ai-visibility/preview`, { method: "POST" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not preview panel"); setPreview(data); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Could not preview panel"); }
    finally { setBusy(false); }
  }
  async function run() {
    if (!preview) return;
    setBusy(true); setMessage("");
    try { const response = await fetch(`/api/sites/${siteId}/ai-visibility`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true, promptIds: preview.promptIds, maxUsd: preview.estimatedUsd }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not start panel");
      setPreview(null); setMessage(`Panel queued (${data.runId}). Process the next question here or let the configured scheduler continue it.`); router.refresh(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Could not start panel"); }
    finally { setBusy(false); }
  }
  async function advance() {
    if (!activeRun) return;
    setBusy(true); setMessage("Processing one question. This can take up to two minutes; do not start another run.");
    try { const response = await fetch(`/api/sites/${siteId}/ai-visibility/${activeRun.id}/advance`, { method: "POST" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not process question");
      setMessage(data.status === "QUEUED" ? "Question saved. Continue with the next question or let the scheduler process it." :
        data.status === "BUSY" ? "A question is already being processed. Refresh shortly." : `Panel ${data.status.toLowerCase()}.`);
      router.refresh(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Request interrupted; refresh to inspect the run before retrying"); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (!activeRun || activeRun.status !== "QUEUED") return;
    setBusy(true); setMessage("");
    try { const response = await fetch(`/api/sites/${siteId}/ai-visibility/${activeRun.id}/cancel`, { method: "POST" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not cancel panel");
      setMessage("Remaining questions cancelled; already completed observations and charges remain in history."); router.refresh(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Could not cancel panel"); }
    finally { setBusy(false); }
  }
  return <section className="panel p-5"><h2 className="font-heading text-lg font-semibold">Sample the fixed prompt panel</h2>
    <p className="mt-2 text-sm text-muted-foreground">DataForSEO samples ChatGPT web-search answers for the active questions. This is a controlled test, not what real users typed. No provider call occurs until you confirm the preview.</p>
    {!providerConnected && <p className="mt-2 text-sm text-warning">Connect your DataForSEO key in site Settings before running a panel.</p>}
    {activeRun && <div className="mt-3 rounded-lg border border-border p-3 text-sm"><p>{activeRun.status} · {activeRun.completedCount}/{activeRun.promptCount} questions processed</p>
      <p className="mt-1 text-xs text-muted-foreground">Each request processes one question. The authenticated scheduler can continue this run if the browser closes; you can also advance it manually.</p>
      <div className="mt-2 flex flex-wrap gap-2"><button disabled={busy || !["QUEUED", "INTERRUPTED"].includes(activeRun.status)} onClick={() => void advance()} className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">{activeRun.status === "INTERRUPTED" ? "Resume run" : "Process next question"}</button>
        <button disabled={busy || activeRun.status !== "QUEUED"} onClick={() => void cancel()} className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50">Cancel remaining</button></div></div>}
    <button disabled={busy || !!activeRun || !providerConnected} onClick={() => void getPreview()} className="mt-3 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50">Preview panel and cost</button>
    {preview && <div className="mt-3 rounded-lg border border-border p-4 text-sm"><p>{preview.prompts.length} questions · {preview.languageCode}/{preview.locationCode} · {preview.mode}</p>
      <p className="mt-1">Estimate: ${preview.estimatedUsd.toFixed(4)} · {preview.cachedRequests} cached · {preview.uncachedRequests} uncached · remaining site budget ${Math.max(0, preview.budgetUsd - preview.spentUsd - preview.reservedUsd).toFixed(3)}</p>
      {preview.mode === "LIVE" && <p className="mt-1 text-warning">Estimate, not a guaranteed maximum. Each uncached request reserves $0.06 against the local site guard; the provider reports the actual charge afterward and may stop the panel early if budget remains insufficient.</p>}
      {preview.mode === "SANDBOX" && <p className="mt-1 text-warning">Sandbox results are synthetic and excluded from visibility statistics.</p>}
      <ol className="mt-2 list-decimal pl-5 text-xs text-muted-foreground">{preview.prompts.map((prompt) => <li key={prompt.question}>{prompt.question}</li>)}</ol>
      <div className="mt-3 flex gap-2"><button disabled={busy} onClick={() => void run()} className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">Confirm and run</button><button onClick={() => setPreview(null)} className="rounded-lg border border-border px-4 py-2 text-sm">Cancel</button></div></div>}
    {message && <p role="status" className="mt-2 text-sm text-muted-foreground">{message}</p>}
  </section>;
}
