"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BriefPlan } from "@/lib/operator/briefs";

const empty: BriefPlan = { title: "", metaDescription: "", outline: [], questions: [], entities: [], internalLinks: [], expertiseNotes: "", notes: "" };
const field = "mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground";
const lines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);

export function BriefEditor({ siteId, briefId, initial, status }: { siteId: string; briefId: string; initial?: BriefPlan; status: string }) {
  const router = useRouter();
  const [plan, setPlan] = useState<BriefPlan>({ ...empty, ...initial });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const update = (key: keyof BriefPlan, value: string | string[]) => setPlan((current) => ({ ...current, [key]: value }));
  const save = async (nextStatus: "DRAFT" | "READY") => {
    setBusy(true); setError(""); setSaved("");
    try {
      const response = await fetch(`/api/sites/${siteId}/briefs/${briefId}`, { method: "PATCH",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan, status: nextStatus }) });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Could not save brief");
      setSaved(nextStatus === "READY" ? "Ready for your copywriter" : "Draft saved");
      router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save brief"); }
    finally { setBusy(false); }
  };
  return <details className="mt-4 border-t border-border pt-4" open={status === "DRAFT" && !!initial?.title}>
    <summary className="cursor-pointer text-sm font-medium text-signal">Edit copywriter plan</summary>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="text-xs text-muted-foreground">Proposed title<input value={plan.title} onChange={(event) => update("title", event.target.value)} className={field} maxLength={200} /></label>
      <label className="text-xs text-muted-foreground">Proposed meta description<textarea value={plan.metaDescription} onChange={(event) => update("metaDescription", event.target.value)} className={field} rows={2} maxLength={500} /></label>
      {(["outline", "questions", "entities", "internalLinks"] as const).map((key) => <label key={key} className="text-xs text-muted-foreground">{({ outline: "Section outline", questions: "Customer questions to answer", entities: "Entities and concepts to verify", internalLinks: "Internal links to consider" })[key]} · one per line<textarea value={plan[key].join("\n")} onChange={(event) => update(key, lines(event.target.value))} className={field} rows={4} /></label>)}
      <label className="text-xs text-muted-foreground">Expertise and source notes<textarea value={plan.expertiseNotes} onChange={(event) => update("expertiseNotes", event.target.value)} className={field} rows={3} maxLength={4000} /></label>
      <label className="text-xs text-muted-foreground">Copywriter notes<textarea value={plan.notes} onChange={(event) => update("notes", event.target.value)} className={field} rows={3} maxLength={8000} /></label>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" disabled={busy} onClick={() => save("DRAFT")} className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50">Save draft</button><button type="button" disabled={busy} onClick={() => save("READY")} className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">Mark ready</button><span className="text-xs text-muted-foreground">This edits the plan only; source evidence remains a snapshot.</span></div>
    {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}{saved && <p role="status" className="mt-2 text-xs text-signal">{saved}</p>}
  </details>;
}
