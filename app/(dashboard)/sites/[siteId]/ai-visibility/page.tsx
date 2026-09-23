import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { AiPanelRunControl, Ga4Controls, GscAiImportControl } from "@/components/operator/ai-visibility-controls";
import { ga4WindowCovered, recentAiWindow, summarizeAiWindow, summarizeCitationPanel } from "@/lib/operator/ai-visibility";

export default async function AiVisibilityPage({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth(); const { siteId } = await params;
  const userId = session?.user?.id ?? "";
  const site = await db.site.findFirst({ where: { id: siteId, userId },
    select: { domain: true, gscProperty: true, ga4PropertyId: true, lastGa4SyncAt: true } });
  if (!site) redirect("/sites");
  const window = recentAiWindow();
  const [googleDays, referralDays, organicDays, imports, runs, credentials] = await Promise.all([
    db.gscAiDaily.findMany({ where: { siteId, property: site.gscProperty || "", date: window.db }, orderBy: { date: "asc" } }),
    db.aiReferralDaily.findMany({ where: { siteId, date: window.db }, orderBy: { date: "asc" } }),
    db.ga4OrganicDaily.findMany({ where: { siteId, date: window.db }, orderBy: { date: "asc" } }),
    db.gscAiImport.findMany({ where: { siteId }, orderBy: { importedAt: "desc" }, take: 5 }),
    db.aiVisibilityRun.findMany({ where: { siteId }, orderBy: { startedAt: "desc" }, take: 20, include: { results: true } }),
    db.apiKey.findUnique({ where: { userId_provider: { userId, provider: "dataforseo" } }, select: { id: true } }),
  ]);
  const latestLive = runs.find((run) => run.mode === "LIVE" && ["COMPLETE", "PARTIAL"].includes(run.status));
  const latestSummary = latestLive ? summarizeCitationPanel({ mode: latestLive.mode, promptCount: latestLive.promptCount,
    results: latestLive.results.map((result) => ({ status: result.status, siteCited: result.siteCited, sources: [] })) }) : null;
  const activeRun = runs.find((run) => run.status === "QUEUED" || run.status === "RUNNING") ?? null;
  const googleAi = summarizeAiWindow(googleDays, window);
  const ga4Ready = ga4WindowCovered(site.lastGa4SyncAt, window);
  return <div><PageHeader eyebrow={site.domain} title="AI visibility" description="Three distinct measurements: Google's AI search impressions, identifiable GA4 AI referrals, and sampled ChatGPT citations. No opaque blended score." />
    <div className="mb-5 grid gap-3 md:grid-cols-3">
      <div className="panel p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Google AI impressions · 28 days</p><p className="mt-2 text-2xl font-semibold">{googleAi.impressions !== null ? googleAi.impressions.toLocaleString() : googleAi.state === "PARTIAL" ? "Partial" : "Unavailable"}</p><p className="mt-1 text-xs text-muted-foreground">GSC export · {googleAi.observedDays}/{googleAi.expectedDays} days · {googleAi.state === "PARTIAL" ? `${googleAi.observedImpressions.toLocaleString()} impressions in imported days only · ` : ""}{imports[0] ? `latest import ${imports[0].importedAt.toISOString().slice(0, 10)}` : "no export"}</p></div>
      <div className="panel p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">AI-referred sessions · 28 days</p><p className="mt-2 text-2xl font-semibold">{ga4Ready ? referralDays.reduce((sum, day) => sum + day.sessions, 0).toLocaleString() : "Unavailable"}</p><p className="mt-1 text-xs text-muted-foreground">GA4 known AI referrers · {ga4Ready ? `${referralDays.reduce((sum, day) => sum + day.keyEvents, 0)} key events · complete sync window` : "connect or refresh GA4 for this window"}</p></div>
      <div className="panel p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">ChatGPT citation sample</p><p className="mt-2 text-2xl font-semibold">{latestSummary?.citationRate !== null && latestSummary?.citationRate !== undefined ? `${Math.round(latestSummary.citationRate * 100)}%` : "Unavailable"}</p><p className="mt-1 text-xs text-muted-foreground">{latestSummary ? `${latestSummary.cited}/${latestSummary.observed} observed answers cited this site · ${latestSummary.observed}/${latestSummary.promptCount} prompts covered · ${latestSummary.coverage}` : "no live fixed-panel run"}</p></div>
    </div>
    <p className="mb-5 text-xs text-muted-foreground">Google AI impressions are included in Web search totals; do not add them to GSC clicks. AI referral sessions can miss stripped or direct referrers. ChatGPT samples are not actual user-query volume.</p>
    <div className="grid gap-4 xl:grid-cols-2"><GscAiImportControl siteId={siteId} property={site.gscProperty} /><Ga4Controls siteId={siteId} propertyId={site.ga4PropertyId} lastSync={site.lastGa4SyncAt?.toISOString() ?? null} /></div>
    <div className="mt-4"><AiPanelRunControl siteId={siteId} providerConnected={!!credentials} activeRun={activeRun ? { id: activeRun.id,
      status: activeRun.status === "RUNNING" && activeRun.leaseUntil && activeRun.leaseUntil < new Date() ? "INTERRUPTED" : activeRun.status,
      promptCount: activeRun.promptCount, completedCount: activeRun.results.length } : null} /></div>
    <div className="mt-5 grid gap-4 lg:grid-cols-2"><section className="panel p-5"><h2 className="font-heading text-lg font-semibold">Recent Google AI imports</h2>{imports.length ? <ul className="mt-3 space-y-2 text-sm">{imports.map((item) => <li key={item.id}>{item.importedAt.toISOString().slice(0, 10)} · {item.firstDate.toISOString().slice(0, 10)} to {item.lastDate.toISOString().slice(0, 10)} · {item.rowCount} days · {item.fileName}</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">No export imported. The report may be unavailable if Google has insufficient impressions for this property.</p>}<a className="mt-3 inline-block text-xs text-signal hover:underline" href="https://support.google.com/webmasters/answer/16984139?hl=en" target="_blank" rel="noopener noreferrer">Google report documentation</a></section>
      <section className="panel p-5"><h2 className="font-heading text-lg font-semibold">GA4 organic context · 28 days</h2><p className="mt-3 text-2xl font-semibold">{ga4Ready ? organicDays.reduce((sum, day) => sum + day.sessions, 0).toLocaleString() : "Unavailable"}</p><p className="text-xs text-muted-foreground">Organic Search sessions · {ga4Ready ? `${organicDays.reduce((sum, day) => sum + day.keyEvents, 0)} key events` : "refresh GA4 for this window"}</p><p className="mt-3 text-xs text-muted-foreground">This is a separate GA4 outcome metric, not a Search Console click count.</p></section></div>
    <section className="panel mt-5 p-5"><div className="flex flex-wrap justify-between gap-2"><h2 className="font-heading text-lg font-semibold">Fixed-panel history</h2><Link href={`/sites/${siteId}/ai-citations`} className="text-sm text-signal hover:underline">Manage questions and one-off samples</Link></div>
      {runs.length ? <div className="mt-3 space-y-2">{runs.map((run) => { const summary = summarizeCitationPanel({ mode: run.mode, promptCount: run.promptCount,
        results: run.results.map((result) => ({ status: result.status, siteCited: result.siteCited, sources: [] })) });
        return <details key={run.id} className="border-t border-border py-3 text-sm"><summary className="cursor-pointer font-medium">{run.startedAt.toISOString().slice(0, 16).replace("T", " ")} · {run.mode} · {run.status} · {run.mode === "LIVE" ? `${summary.cited}/${summary.observed} citations, ${summary.observed}/${summary.promptCount} observed` : "synthetic, excluded"} · ${run.chargedUsd.toFixed(4)}</summary>
          <p className="mt-2 text-xs text-muted-foreground">ChatGPT web search · location {run.locationCode} · language {run.languageCode} · {summary.coverage}{run.error ? ` · ${run.error}` : ""}</p><ul className="mt-2 space-y-3">{run.results.map((result) => { const sources = Array.isArray(result.sources) ? result.sources as { domain: string; url: string; title?: string }[] : [];
            return <li key={result.id} className="rounded-lg bg-muted/30 p-3"><p>{result.questionSnapshot} · {result.status === "OBSERVED" ? result.siteCited ? "site cited" : "not cited" : "error"}{result.cached ? " · cached answer" : ""}</p>{sources.length > 0 && <ul className="mt-1 space-y-1 text-xs text-muted-foreground">{sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer" className="text-signal hover:underline">{source.title || source.domain}</a></li>)}</ul>}</li>; })}</ul></details>; })}</div> : <p className="mt-2 text-sm text-muted-foreground">No fixed-panel runs yet.</p>}
    </section>
  </div>;
}
