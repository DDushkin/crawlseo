"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Prompt = { id: string; question: string; country: string; language: string; intent: string | null; active: boolean };

export function AiPromptPanel({ siteId, prompts }: { siteId: string; prompts: Prompt[] }) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [intent, setIntent] = useState("");
  const [country, setCountry] = useState("UA");
  const [language, setLanguage] = useState("uk");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQuestion, setEditQuestion] = useState("");
  const [editIntent, setEditIntent] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { const response = await fetch(`/api/sites/${siteId}/ai-prompts`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, intent, country, language }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not save question");
      setQuestion(""); setIntent(""); router.refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save question"); }
    finally { setBusy(false); }
  }
  async function toggle(prompt: Prompt) {
    setBusy(true); setError("");
    try { const response = await fetch(`/api/sites/${siteId}/ai-prompts/${prompt.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !prompt.active }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not update question"); router.refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update question"); }
    finally { setBusy(false); }
  }
  async function saveEdit(prompt: Prompt) {
    setBusy(true); setError("");
    try { const response = await fetch(`/api/sites/${siteId}/ai-prompts/${prompt.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: editQuestion, intent: editIntent }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not edit question");
      setEditingId(null); router.refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not edit question"); }
    finally { setBusy(false); }
  }
  return <section className="panel mb-5 p-5"><h2 className="font-heading text-lg font-semibold">Fixed customer-question panel</h2>
    <p className="mt-1 text-sm text-muted-foreground">These are representative questions you choose, not a feed of real users&apos; private prompts. Keep them stable to compare sampled citations over time.</p>
    <form className="mt-4 grid gap-2 sm:grid-cols-[1fr_10rem_5rem_5rem_auto]" onSubmit={save}>
      <input required value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What service helps track OVDP in Ukraine?" aria-label="Customer question" className="rounded-lg border border-border bg-card px-3 py-2 text-sm" />
      <input value={intent} onChange={(event) => setIntent(event.target.value)} placeholder="Intent" aria-label="Intent" className="rounded-lg border border-border bg-card px-3 py-2 text-sm" />
      <input required value={country} onChange={(event) => setCountry(event.target.value)} aria-label="Country code" maxLength={2} className="rounded-lg border border-border bg-card px-3 py-2 text-sm" />
      <input required value={language} onChange={(event) => setLanguage(event.target.value)} aria-label="Language code" maxLength={2} className="rounded-lg border border-border bg-card px-3 py-2 text-sm" />
      <button disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">Add</button>
    </form>
    {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    <div className="mt-4 space-y-2">{prompts.map((prompt) => <div key={prompt.id} className="flex flex-wrap items-start justify-between gap-2 border-t border-border/60 pt-2 text-sm"><div className="min-w-0 flex-1">{editingId === prompt.id ? <div className="flex flex-wrap gap-2"><input aria-label="Edit customer question" value={editQuestion} onChange={(event) => setEditQuestion(event.target.value)} className="min-w-64 flex-1 rounded-lg border border-border bg-card px-3 py-2" /><input aria-label="Edit intent" value={editIntent} onChange={(event) => setEditIntent(event.target.value)} className="rounded-lg border border-border bg-card px-3 py-2" /><button disabled={busy} onClick={() => void saveEdit(prompt)} className="text-signal hover:underline">Save</button><button onClick={() => setEditingId(null)} className="text-muted-foreground hover:underline">Cancel</button></div> : <p>{prompt.question}</p>}<p className="text-xs text-muted-foreground">{prompt.country}/{prompt.language} · {prompt.intent || "intent not labeled"} · {prompt.active ? "active" : "paused"}</p></div><div className="flex gap-3"><button disabled={busy} onClick={() => { setEditingId(prompt.id); setEditQuestion(prompt.question); setEditIntent(prompt.intent || ""); }} className="text-signal hover:underline disabled:opacity-50">Edit</button><button disabled={busy} onClick={() => void toggle(prompt)} className="text-signal hover:underline disabled:opacity-50">{prompt.active ? "Pause" : "Activate"}</button></div></div>)}{prompts.length === 0 && <p className="text-sm text-muted-foreground">No fixed questions yet. Add 5–15 questions across your service intents before measuring a panel rate.</p>}</div>
  </section>;
}
