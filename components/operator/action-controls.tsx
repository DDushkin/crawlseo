"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DetectActionsButton({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run() {
    setBusy(true); setMessage("");
    try { const response = await fetch(`/api/sites/${siteId}/actions/detect`, { method: "POST" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Detection failed");
      setMessage(`${data.state}: ${data.detected} current signals${data.reason ? ` · ${data.reason}` : ""}`); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Detection failed"); }
    finally { setBusy(false); }
  }
  return <div><button disabled={busy} onClick={() => void run()} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{busy ? "Checking GSC…" : "Refresh free-data actions"}</button>
    {message && <p role="status" className="mt-1 max-w-sm text-xs text-muted-foreground">{message}</p>}</div>;
}

type Action = { id: string; status: string; notes: string | null; owner: string | null; dueAt: string | null };
export function ActionControls({ siteId, action }: { siteId: string; action: Action }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState(action.notes || "");
  const [owner, setOwner] = useState(action.owner || "");
  const [dueAt, setDueAt] = useState(action.dueAt?.slice(0, 10) || "");
  const [description, setDescription] = useState("");
  const [changedAt, setChangedAt] = useState(new Date().toISOString().slice(0, 10));
  async function update(body: Record<string, unknown>) {
    setBusy(true); setMessage("");
    try { const response = await fetch(`/api/sites/${siteId}/actions/${action.id}`, { method: "PATCH",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not update action");
      setMessage("Saved."); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not update action"); }
    finally { setBusy(false); }
  }
  async function complete() {
    if (!description.trim() || !changedAt) { setMessage("Describe what changed and when."); return; }
    setBusy(true); setMessage("");
    try { const response = await fetch(`/api/sites/${siteId}/actions/${action.id}/complete`, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description, changedAt }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not record change");
      setMessage("Change recorded. The equal-window GSC outcome will appear after data finalizes."); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not record change"); }
    finally { setBusy(false); }
  }
  const transitions: Record<string, { label: string; status: string }[]> = {
    NEW: [{ label: "Plan", status: "PLANNED" }, { label: "Start", status: "IN_PROGRESS" }, { label: "Dismiss", status: "DISMISSED" }],
    PLANNED: [{ label: "Start", status: "IN_PROGRESS" }, { label: "Move to new", status: "NEW" }, { label: "Dismiss", status: "DISMISSED" }],
    IN_PROGRESS: [{ label: "Move to planned", status: "PLANNED" }, { label: "Dismiss", status: "DISMISSED" }],
    DISMISSED: [{ label: "Reopen", status: "NEW" }],
  };
  return <div className="mt-3 border-t border-border pt-3 text-sm">
    <div className="flex flex-wrap gap-2">{(transitions[action.status] || []).map((item) => <button key={item.status} disabled={busy}
      onClick={() => void update({ status: item.status })} className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-50">{item.label}</button>)}</div>
    {["NEW", "PLANNED", "IN_PROGRESS"].includes(action.status) && <details className="mt-3"><summary className="cursor-pointer font-medium">Record a completed change</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]"><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2}
        placeholder="What did you change on the site?" aria-label="Completed change" className="rounded-lg border border-border bg-background p-2" />
        <div><label className="block text-xs text-muted-foreground">Change date</label><input type="date" value={changedAt} onChange={(event) => setChangedAt(event.target.value)} className="mt-1 rounded-lg border border-border bg-background p-2" /></div></div>
      <button disabled={busy || !description.trim()} onClick={() => void complete()} className="mt-2 rounded-lg bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50">Record completion and baseline</button></details>}
    <details className="mt-3"><summary className="cursor-pointer text-muted-foreground">Owner, due date and notes</summary><div className="mt-2 grid gap-2 sm:grid-cols-2">
      <input value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="Owner (you or copywriter)" aria-label="Action owner" className="rounded-lg border border-border bg-background p-2" />
      <input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} aria-label="Due date" className="rounded-lg border border-border bg-background p-2" />
      <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} placeholder="Implementation notes" aria-label="Action notes" className="rounded-lg border border-border bg-background p-2 sm:col-span-2" /></div>
      <button disabled={busy} onClick={() => void update({ owner: owner || null, dueAt: dueAt || null, notes })} className="mt-2 rounded-lg border border-border px-3 py-2 disabled:opacity-50">Save plan</button></details>
    {message && <p role="status" className="mt-2 text-xs text-muted-foreground">{message}</p>}
  </div>;
}
