import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { DashboardMetrics } from "@/components/dashboard/metrics";
import { TrafficChart } from "@/components/dashboard/traffic-chart";
import { TopKeywords } from "@/components/dashboard/top-keywords";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { SyncButton } from "@/components/sites/sync-button";
import { GscDataHealthPanel } from "@/components/sites/gsc-data-health";
import { getGscDataHealth } from "@/lib/gsc/health";
import {
  CrawlButton,
  VitalsButton,
} from "@/components/sites/action-buttons";
import { CsvExportButton } from "@/components/ui/csv-export-button";
import { hasGscData } from "@/lib/seo-metrics";
import { loadWeeklyReport } from "@/lib/operator/weekly-report";

interface SitePageProps {
  params: Promise<{ siteId: string }>;
}

export default async function SiteOverviewPage({ params }: SitePageProps) {
  const session = await auth();
  const { siteId } = await params;

  const site = await db.site.findUnique({
    where: { id: siteId },
    select: {
      userId: true,
      domain: true,
      gscProperty: true,
    },
  });

  if (!site || site.userId !== session?.user?.id) {
    redirect("/sites");
  }

  const latestCrawl = await db.crawl.findFirst({
    where: { siteId, status: "COMPLETED" },
    orderBy: { finishedAt: "desc" },
    select: { healthScore: true, issuesFound: true, pagesFound: true, finishedAt: true },
  });

  const latestVital = await db.vitalsReport.findFirst({
    where: { siteId },
    orderBy: { date: "desc" },
    select: { perfScore: true, lcp: true, url: true },
  });

  const [hasData, health, report] = await Promise.all([
    hasGscData(siteId), getGscDataHealth(siteId), loadWeeklyReport(siteId),
  ]);

  return (
    <div>
      <PageHeader
        eyebrow="Site"
        title={site.domain}
        description="Today: what changed, what to do next, and whether completed work helped."
        actions={
          <div className="flex flex-wrap items-start gap-2">
            <SyncButton siteId={siteId} />
            <CrawlButton siteId={siteId} />
            <VitalsButton siteId={siteId} />
          </div>
        }
      />

      <GscDataHealthPanel health={health} />

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <section className="panel p-5 lg:col-span-2"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-heading text-lg font-semibold">This week&apos;s three priorities</h2><Link href={`/sites/${siteId}/actions`} className="text-sm text-signal hover:underline">Open action backlog</Link></div>
          {report.nextActions.length ? <ol className="mt-3 space-y-3">{report.nextActions.map((action, index) => <li key={action.id} className="flex gap-3 border-t border-border pt-3 first:border-0 first:pt-0"><span className="shrink-0 text-sm font-semibold text-signal">{index + 1}.</span><div><Link href={`/sites/${siteId}/actions#action-${action.id}`} className="text-sm font-medium hover:text-signal">{action.title}</Link><p className="text-xs text-muted-foreground">{action.status.replaceAll("_", " ")} · priority {action.priority}</p></div></li>)}</ol> :
            <p className="mt-3 text-sm text-muted-foreground">No active evidence-backed actions yet. Run a full GSC sync, then refresh free-data actions in the backlog. Completed crawl comparisons can also create technical actions.</p>}</section>
        <section className="panel p-5"><h2 className="font-heading text-lg font-semibold">Did it help?</h2>
          <p className="mt-3 text-sm"><span className="font-semibold">{report.work.pendingOutcomes}</span> change(s) awaiting comparable GSC data</p>
          <p className="mt-2 text-sm"><span className="font-semibold">{report.work.observedOutcomes}</span> outcome(s) observed this week</p>
          <p className="mt-3 text-xs text-muted-foreground">A measured difference after a change is not proof of causation. Each action retains its baseline and equal-length comparison window.</p></section>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="panel p-4"><p className="text-xs text-muted-foreground">Search clicks · finalized 7 days</p><p className="mt-1 text-2xl font-semibold">{report.search.clicks === null ? "Unavailable" : report.search.clicks.toLocaleString()}</p><p className="text-xs text-muted-foreground">GSC property total · {report.search.state}{report.search.changePct !== null ? ` · ${report.search.changePct > 0 ? "+" : ""}${report.search.changePct}% vs prior week` : ""}</p></div>
        <div className="panel p-4"><p className="text-xs text-muted-foreground">Technical change</p><p className="mt-1 text-2xl font-semibold">{report.technical ? `${report.technical.newCount} new / ${report.technical.resolvedCount} resolved` : "Unavailable"}</p><p className="text-xs text-muted-foreground">Latest complete crawl comparison this week</p></div>
        <div className="panel p-4"><p className="text-xs text-muted-foreground">AI-referred sessions</p><p className="mt-1 text-2xl font-semibold">{report.ga4.sessions === null ? "Unavailable" : report.ga4.sessions.toLocaleString()}</p><p className="text-xs text-muted-foreground">GA4 identifiable referrers only · <Link href={`/sites/${siteId}/ai-visibility`} className="text-signal hover:underline">AI visibility</Link></p></div>
        <div className="panel p-4"><p className="text-xs text-muted-foreground">Published placement commitments</p><p className="mt-1 text-2xl font-semibold">{report.placements.spentUah.toLocaleString()} UAH</p><p className="text-xs text-muted-foreground">{report.placements.published} recorded this week · <Link href={`/sites/${siteId}/placements`} className="text-signal hover:underline">ledger</Link></p></div>
      </div>

      <div className="mb-6 flex flex-wrap gap-2"><Link href={`/sites/${siteId}/weekly-report`} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Review full weekly report</Link><Link href={`/sites/${siteId}/keyword-map`} className="rounded-lg border border-border px-4 py-2 text-sm">Plan keywords</Link><Link href={`/sites/${siteId}/content-briefs`} className="rounded-lg border border-border px-4 py-2 text-sm">Prepare content</Link></div>

      <div className="mb-6 flex flex-wrap gap-2">
        {[
          ["Action Backlog", "actions"],
          ["Keywords", "keywords"],
          ["Saved Keywords", "saved-keywords"],
          ["Pages", "pages"],
          ["Crawl", "crawl"],
          ["Vitals", "vitals"],
          ["Alerts", "alerts"],
          ["Settings", "settings"],
        ].map(([label, path]) => (
          <Link
            key={path}
            href={`/sites/${siteId}/${path}`}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-atom-caption font-medium text-muted-foreground shadow-[var(--shadow-1)] transition hover:border-primary hover:text-primary"
          >
            {label}
          </Link>
        ))}
      </div>

      {!hasData ? (
        <EmptyState
          icon="↻"
          title="Waiting for GSC data"
          description="Run a sync to pull keywords, pages, and traffic for the last 28 days."
        />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="panel p-4">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Crawl health
              </p>
              <p className="mt-1 font-heading text-2xl font-semibold text-foreground">
                {latestCrawl?.healthScore != null ? `${latestCrawl.healthScore}/100` : "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {latestCrawl
                  ? `${latestCrawl.pagesFound} pages · ${latestCrawl.issuesFound} issues`
                  : "Run a crawl"}
              </p>
            </div>
            <div className="panel p-4">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Active actions
              </p>
              <p className="mt-1 font-heading text-2xl font-semibold text-signal">
                {report.nextActions.length}
              </p>
              <p className="text-xs text-muted-foreground">top priorities; see the full backlog</p>
            </div>
            <div className="panel p-4">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Latest perf score
              </p>
              <p className="mt-1 font-heading text-2xl font-semibold text-foreground">
                {latestVital?.perfScore ?? "—"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {latestVital?.url || "Check vitals"}
              </p>
            </div>
          </div>

          <DashboardMetrics siteId={siteId} />
          <TrafficChart key={health.lastSuccessfulSync} siteId={siteId} days={28} />
          <TopKeywords siteId={siteId} />

          <div className="flex flex-wrap gap-2">
            <CsvExportButton siteId={siteId} type="keywords" />
            <CsvExportButton siteId={siteId} type="pages" />
          </div>
        </div>
      )}
    </div>
  );
}
