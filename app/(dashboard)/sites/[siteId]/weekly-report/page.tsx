import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { loadWeeklyReport, weeklyWindow } from "@/lib/operator/weekly-report";
import { shiftDateLabel } from "@/lib/gsc/date-range";

function NumberCard({ label, value, context }: { label: string; value: string; context: string }) {
  return <div className="panel p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{context}</p></div>;
}

export default async function WeeklyReportPage({ params, searchParams }: { params: Promise<{ siteId: string }>;
  searchParams: Promise<{ endDate?: string }> }) {
  const session = await auth(); const { siteId } = await params; const { endDate } = await searchParams;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session?.user?.id ?? "" }, select: { domain: true } });
  if (!site) redirect("/sites");
  let report: Awaited<ReturnType<typeof loadWeeklyReport>>;
  try { report = await loadWeeklyReport(siteId, new Date(), endDate); }
  catch { notFound(); }
  const latestEnd = weeklyWindow().current.endDate;
  const previousEnd = shiftDateLabel(report.window.current.endDate, -7);
  const nextEnd = shiftDateLabel(report.window.current.endDate, 7);
  const historical = !!endDate;
  return <div><PageHeader eyebrow={site.domain} title="Weekly operator report" description="One evidence-qualified review of performance, work, technical changes, AI visibility and recorded spend." />
    <div className="mb-5 flex flex-wrap items-center gap-3 text-sm"><Link href={`/sites/${siteId}/weekly-report?endDate=${previousEnd}`} className="rounded-lg border border-border px-3 py-2">← Previous week</Link>
      <span>{report.window.current.startDate} to {report.window.current.endDate}</span>
      {nextEnd <= latestEnd && <Link href={`/sites/${siteId}/weekly-report?endDate=${nextEnd}`} className="rounded-lg border border-border px-3 py-2">Next week →</Link>}
      {historical && <Link href={`/sites/${siteId}/weekly-report`} className="text-signal hover:underline">Latest report</Link>}</div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <NumberCard label="GSC property clicks" value={report.search.clicks === null ? "Unavailable" : report.search.clicks.toLocaleString()}
        context={`${report.search.state} · ${report.search.changePct === null ? "comparison unavailable" : `${report.search.changePct > 0 ? "+" : ""}${report.search.changePct}% vs prior 7 days`}`} />
      <NumberCard label="GSC property impressions" value={report.search.impressions === null ? "Unavailable" : report.search.impressions.toLocaleString()}
        context="Web search · same finalized property scope" />
      <NumberCard label="AI-referred GA4 sessions" value={report.ga4.sessions === null ? "Unavailable" : report.ga4.sessions.toLocaleString()}
        context={`${report.ga4.keyEvents ?? "—"} key events · identifiable AI referrers only`} />
      <NumberCard label="Google AI impressions" value={report.googleAi.impressions === null ? "Unavailable" : report.googleAi.impressions.toLocaleString()}
        context={`GSC generative-AI export · ${report.googleAi.days}/7 days imported`} />
    </div>
    <div className="mt-5 grid gap-4 lg:grid-cols-2"><section className="panel p-5"><h2 className="font-heading text-lg font-semibold">Work and outcomes</h2>
      <ul className="mt-3 space-y-2 text-sm"><li>{report.work.completed} site changes recorded this week</li><li>{report.work.pendingOutcomes} changes currently awaiting a comparable outcome</li>
        <li>{report.work.observedOutcomes} outcomes evaluated this week</li></ul>
      <Link href={`/sites/${siteId}/actions`} className="mt-3 inline-block text-sm text-signal hover:underline">Review action evidence and outcomes →</Link></section>
      <section className="panel p-5"><h2 className="font-heading text-lg font-semibold">Technical changes</h2>
        {report.technical ? <p className="mt-3 text-sm">Latest complete crawl comparison: {report.technical.newCount} new issue(s), {report.technical.resolvedCount} resolved · {report.technical.comparedAt.slice(0, 10)}</p> :
          <p className="mt-3 text-sm text-muted-foreground">No complete crawl comparison this week; this is not zero issues.</p>}
        <Link href={`/sites/${siteId}/crawl-changes`} className="mt-3 inline-block text-sm text-signal hover:underline">Inspect affected URLs →</Link></section></div>
    <div className="mt-4 grid gap-4 lg:grid-cols-2"><section className="panel p-5"><h2 className="font-heading text-lg font-semibold">AI citation sample</h2>
      {report.aiPanel ? <p className="mt-3 text-sm">{report.aiPanel.cited}/{report.aiPanel.observed} observed ChatGPT answers cited this site across {report.aiPanel.promptCount} fixed prompts · {report.aiPanel.citationRate === null ? "rate unavailable" : `${Math.round(report.aiPanel.citationRate * 100)}% sample citation rate`} · sampled {report.aiPanel.observedAt.slice(0, 10)}</p> :
        <p className="mt-3 text-sm text-muted-foreground">No live fixed-panel sample as of this week. Real customer prompts remain unknown.</p>}
      <Link href={`/sites/${siteId}/ai-visibility`} className="mt-3 inline-block text-sm text-signal hover:underline">Inspect AI sources and coverage →</Link></section>
      <section className="panel p-5"><h2 className="font-heading text-lg font-semibold">Recorded external commitments</h2>
        <p className="mt-3 text-sm">{report.placements.published} published placement(s) · {report.placements.spentUah.toLocaleString()} UAH recorded cost, including fees.</p>
        <p className="mt-2 text-sm">${report.provider.spentUsd.toFixed(4)} reported DataForSEO charges this week.</p>
        <p className="mt-2 text-xs text-muted-foreground">Placement publication date is not a payment date or proof of SEO return.</p></section></div>
    <section className="panel mt-5 p-5"><h2 className="font-heading text-lg font-semibold">Next work to consider</h2>
      {historical && <p className="mt-2 text-xs text-muted-foreground">Priorities below reflect the current backlog, not a snapshot of historical action statuses.</p>}
      {report.nextActions.length ? <ol className="mt-3 space-y-2">{report.nextActions.map((action) => <li key={action.id} className="text-sm"><Link href={`/sites/${siteId}/actions#action-${action.id}`} className="text-signal hover:underline">{action.title}</Link> · {action.status.replaceAll("_", " ")}</li>)}</ol> :
        <p className="mt-2 text-sm text-muted-foreground">No active evidence-backed actions. Refresh detection after a complete GSC sync or inspect content briefs and the keyword map.</p>}</section>
    <section className="mt-5 text-xs text-muted-foreground"><h2 className="font-medium text-foreground">How to read this report</h2><ul className="mt-2 list-disc space-y-1 pl-5">{report.qualifications.map((line) => <li key={line}>{line}</li>)}</ul></section>
  </div>;
}
