"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ExternalLink, Bookmark } from "lucide-react";
import { confirmDataForSeoRequest } from "./dataforseo-confirm";

export type Kind = "competitor_gap" | "placement" | "ai_citation";
type Gap = { keyword: string; volume: number | null; difficulty: number | null; intent: string | null; competitorRank: number | null; competitorUrl: string | null };
type Placement = { observed: boolean; links: Array<{ sourceUrl: string; targetUrl: string; anchorText: string; dofollow: boolean | null }> };
type Citation = { model: string | null; observedAt: string | null; siteCited: boolean; sources: Array<{ domain: string; url: string; title: string }> };
type Item = { kind: Kind; target: string; mode: "SANDBOX" | "LIVE"; chargedUsd: number | null; createdAt?: string; nextStep: string; evidence: Gap[] | Placement | Citation };

const workflows: Array<{ kind: Kind; title: string; label: string; placeholder: string; help: string }> = [
  { kind: "competitor_gap", title: "Competitor gaps", label: "Competitor domain", placeholder: "competitor.com",
    help: "Find organic queries a direct competitor ranks for but this site does not, then map relevant queries to a service page or brief." },
  { kind: "placement", title: "Paid article checks", label: "Published article URL", placeholder: "https://publisher.example/article",
    help: "Check whether DataForSEO has indexed a backlink from the exact paid article, and inspect its destination, anchor, and link attribute." },
  { kind: "ai_citation", title: "AI citations", label: "Customer question", placeholder: "Which investment tracker should I use?",
    help: "Sample one ChatGPT web-search answer. Only sources used in the final answer count as citations; one sample is not a visibility rate." },
];

export function OperatorResearchClient({ siteId, domain, hasDataForSEO, initialHistory, kind }: {
  siteId: string; domain: string; hasDataForSEO: boolean; initialHistory: Item[]; kind: Kind;
}) {
  const [targets, setTargets] = useState<Record<Kind, string>>({
    competitor_gap: "", placement: "", ai_citation: domain === "strum.capital" ? "Який сервіс допомагає відстежувати інвестиційний портфель в Україні?" : "",
  });
  const [running, setRunning] = useState<Kind | null>(null);
  const [latest, setLatest] = useState<Item | null>(null);
  const [history, setHistory] = useState<Item[]>(initialHistory);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/sites/${siteId}/operator-research?kind=${kind}`).then((res) => res.json()).then((data) => {
      if (active && Array.isArray(data.history)) setHistory(data.history);
    }).catch(() => {});
    return () => { active = false; };
  }, [siteId, kind]);

  async function run(kind: Kind) {
    const target = targets[kind].trim();
    if (!target || running) return;
    setError(null);
    try {
      if (!await confirmDataForSeoRequest(siteId, kind, target, 20)) return;
      setRunning(kind);
      const res = await fetch(`/api/sites/${siteId}/operator-research`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, target, confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Research request failed");
      setLatest(data);
      const historyRes = await fetch(`/api/sites/${siteId}/operator-research?kind=${kind}`);
      if (historyRes.ok) setHistory((await historyRes.json()).history ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Research request failed");
    } finally {
      setRunning(null);
    }
  }

  async function saveKeyword(keyword: string) {
    const res = await fetch(`/api/sites/${siteId}/saved-keywords`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: keyword }),
    });
    if (!res.ok) setError("Could not save keyword. Try again.");
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        Each run is manual and shows a cost preview. DataForSEO Sandbox is free but synthetic; switch to Live in <Link href={`/sites/${siteId}/settings`} className="text-primary underline">Settings</Link> only when ready. GSC remains the source for actual clicks and impressions.
      </div>
      {!hasDataForSEO && <p className="rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm text-warning">Connect your DataForSEO key in site Settings to use these workflows.</p>}
      <div className="max-w-3xl">
        {workflows.filter((workflow) => workflow.kind === kind).map((workflow) => (
          <section key={workflow.kind} className="panel p-5">
            <h2 className="font-heading text-lg font-semibold">{workflow.title}</h2>
            <p className="mt-2 min-h-20 text-sm text-muted-foreground">{workflow.help}</p>
            <label htmlFor={workflow.kind} className="mt-3 block text-xs font-medium">{workflow.label}</label>
            <input id={workflow.kind} value={targets[workflow.kind]} placeholder={workflow.placeholder}
              onChange={(event) => setTargets((previous) => ({ ...previous, [workflow.kind]: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
            <button type="button" disabled={!hasDataForSEO || !targets[workflow.kind].trim() || running !== null}
              onClick={() => run(workflow.kind)} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {running === workflow.kind && <Loader2 className="size-4 animate-spin" />} Run with preview cost
            </button>
          </section>
        ))}
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {latest && <section className="panel p-5"><h2 className="font-heading text-lg font-semibold">Latest result</h2><Evidence item={latest} onSave={saveKeyword} /></section>}
      <section className="panel p-5">
        <h2 className="font-heading text-lg font-semibold">Previous runs</h2>
        {history.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No {labelFor(kind).toLowerCase()} runs yet.</p> :
          <ul className="mt-3 space-y-3">{history.map((item, index) => <li key={`${item.kind}-${item.target}-${index}`} className="border-t border-border pt-3">
            <details><summary className="cursor-pointer text-sm font-medium">{labelFor(item.kind)} · {item.target} · {new Date(item.createdAt ?? "").toLocaleDateString()}</summary>
              <Evidence item={item} onSave={saveKeyword} />
            </details>
          </li>)}</ul>}
      </section>
    </div>
  );
}

function labelFor(kind: Kind) { return workflows.find((workflow) => workflow.kind === kind)?.title ?? kind; }

function Evidence({ item, onSave }: { item: Item; onSave: (keyword: string) => void }) {
  return <div className="mt-3 space-y-3 text-sm">
    <p className="text-xs text-muted-foreground">{item.mode === "SANDBOX" ? "Sandbox · synthetic test data" : "DataForSEO Live"} · Charged ${Number(item.chargedUsd ?? 0).toFixed(4)} {item.createdAt ? `· ${new Date(item.createdAt).toLocaleString()}` : ""}</p>
    {item.mode === "SANDBOX" ? <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-warning">Synthetic Sandbox result. Do not use it for SEO or purchasing decisions.</p> : <p className="rounded-lg bg-signal-muted p-3 text-foreground"><span className="font-semibold">Next step:</span> {item.nextStep}</p>}
    {item.kind === "competitor_gap" && <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead><tr className="border-b border-border text-muted-foreground"><th className="py-2">Query</th><th>Volume</th><th>Difficulty</th><th>Competitor</th><th>Action</th></tr></thead><tbody>
      {(item.evidence as Gap[]).map((gap) => <tr key={gap.keyword} className="border-b border-border/50"><td className="py-2 font-medium">{gap.keyword}<span className="block text-xs text-muted-foreground">{gap.intent ?? "intent unknown"}</span></td><td>{gap.volume ?? "—"}</td><td>{gap.difficulty ?? "—"}</td><td>{gap.competitorUrl ? <a href={gap.competitorUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">#{gap.competitorRank ?? "?"} page <ExternalLink className="inline size-3" /></a> : "—"}</td><td><button type="button" onClick={() => onSave(gap.keyword)} disabled={item.mode === "SANDBOX"} className="inline-flex items-center gap-1 text-primary disabled:opacity-50"><Bookmark className="size-3" /> Save query</button></td></tr>)}
      </tbody></table>{(item.evidence as Gap[]).length === 0 && <p className="py-3 text-muted-foreground">No matching competitor-only keywords in this sample.</p>}</div>}
    {item.kind === "placement" && <div>{(item.evidence as Placement).observed ? <ul className="space-y-2">{(item.evidence as Placement).links.map((link, index) => <li key={`${link.targetUrl}-${index}`} className="rounded-lg border border-border p-3"><p>Observed link to <a href={link.targetUrl} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline">{link.targetUrl}</a></p><p>Anchor: {link.anchorText || "none"} · {link.dofollow === null ? "attribute unknown" : link.dofollow ? "dofollow" : "nofollow"}</p></li>)}</ul> : <p className="text-muted-foreground">No matching link observed in DataForSEO&apos;s index. This does not prove it is absent from the live article.</p>}</div>}
    {item.kind === "ai_citation" && <div><p className="font-medium">{(item.evidence as Citation).siteCited ? `${item.target}: site cited in this answer` : "Site not cited in this sampled answer"}</p><p className="text-xs text-muted-foreground">One ChatGPT sample · {(item.evidence as Citation).model ?? "model unspecified"} · {(item.evidence as Citation).observedAt ?? "time unavailable"}</p><ul className="mt-2 space-y-1">{(item.evidence as Citation).sources.map((source, index) => <li key={`${source.url}-${index}`}><a href={source.url} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline">{source.title || source.domain}</a> <span className="text-xs text-muted-foreground">({source.domain})</span></li>)}</ul>{(item.evidence as Citation).sources.length === 0 && <p className="text-muted-foreground">No final-answer sources returned.</p>}</div>}
  </div>;
}
