import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { CrawlButton } from "@/components/sites/action-buttons";
import { CrawlStatusPoller } from "@/components/sites/crawl-status-poller";
import {
  findOrphanPages,
  getIndexingState,
  isSearchIndexCandidate,
} from "@/lib/crawler/analysis";
import { cn } from "@/lib/utils";

interface Props {
  params: Promise<{ siteId: string }>;
}

export default async function CrawlPage({ params }: Props) {
  const session = await auth();
  const { siteId } = await params;

  const site = await db.site.findUnique({
    where: { id: siteId },
    select: { userId: true, domain: true },
  });
  if (!site || site.userId !== session?.user?.id) redirect("/sites");

  const [runningCrawl, latest] = await Promise.all([
    db.crawl.findFirst({
      where: { siteId, status: "RUNNING" },
      select: { id: true, pagesFound: true, startedAt: true },
    }),
    db.crawl.findFirst({
      where: { siteId, status: "COMPLETED" },
      orderBy: { finishedAt: "desc" },
      include: {
        issues: {
          orderBy: [{ severity: "asc" }, { type: "asc" }],
          take: 1000,
        },
      },
    }),
  ]);

  // Page metadata and link-graph counts are independent once the crawl is known.
  const [auditPages, internalInlinks] = latest
    ? await Promise.all([
        db.auditPage.findMany({
          where: { crawlId: latest.id },
          orderBy: { contentScore: "desc" },
        }),
        db.auditLink.groupBy({
          by: ["sourceUrl", "targetUrl"],
          where: { crawlId: latest.id, isInternal: true },
        }),
      ])
    : [[], []];

  const realIssues = latest?.issues.filter((i) => {
    const kind = (i.details as { kind?: string } | null)?.kind;
    return kind !== "crawl_summary" && kind !== "content_score";
  }) || [];

  const bySeverity = {
    CRITICAL: realIssues.filter((i) => i.severity === "CRITICAL").length,
    WARNING: realIssues.filter((i) => i.severity === "WARNING").length,
    INFO: realIssues.filter((i) => i.severity === "INFO").length,
  };

  const searchPages = auditPages.filter(isSearchIndexCandidate);
  const avgContentScore =
    searchPages.length > 0
      ? Math.round(searchPages.reduce((s, p) => s + p.contentScore, 0) / searchPages.length)
      : null;

  const inlinkCount = new Map<string, number>();
  for (const link of internalInlinks) {
    inlinkCount.set(link.targetUrl, (inlinkCount.get(link.targetUrl) ?? 0) + 1);
  }
  const seedUrl = site.domain.startsWith("http") ? site.domain : `https://${site.domain}`;
  const orphanCount = findOrphanPages(auditPages, inlinkCount, seedUrl).length;

  return (
    <div>
      <PageHeader
        eyebrow={site.domain}
        title="Site crawl"
        description="Technical SEO audit · meta, headings, schema, sitemap, orphans, content score"
        actions={<CrawlButton siteId={siteId} />}
      />

      {/* Running crawl indicator */}
      {runningCrawl && (
        <CrawlStatusPoller
          siteId={siteId}
          crawlId={runningCrawl.id}
        />
      )}

      {!latest ? (
        <EmptyState
          icon="◎"
          title="No crawl yet"
          description="Run a crawl to check titles, H1s, canonicals, broken pages, sitemap coverage, and on-page content scores."
        />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <ScoreCard
              label="Health"
              value={`${latest.healthScore ?? "—"}`}
              hint="/100"
              tone={(latest.healthScore ?? 0) >= 80 ? "good" : (latest.healthScore ?? 0) >= 60 ? "mid" : "bad"}
            />
            <ScoreCard
              label="Pages"
              value={String(latest.pagesFound)}
              hint={`${searchPages.length} indexable`}
            />
            <ScoreCard
              label="Issues"
              value={String(realIssues.length)}
              hint={`${bySeverity.CRITICAL} critical`}
            />
            <ScoreCard
              label="Content avg"
              value={String(avgContentScore ?? "—")}
              hint="/100"
            />
            <ScoreCard
              label="Orphans"
              value={String(orphanCount)}
              hint="indexable · no inlinks"
            />
          </div>

          {/* Crawled pages table (from AuditPage model) */}
          {auditPages.length > 0 && (
            <div className="panel overflow-hidden">
              <div className="border-b border-border/60 px-5 py-4">
                <h3 className="font-heading text-lg font-semibold">Crawled pages</h3>
                <p className="text-sm text-muted-foreground">
                  {auditPages.length} pages stored with full metadata
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[800px] text-sm">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/20 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                      <th className="px-4 py-3 text-left">URL</th>
                      <th className="px-4 py-3 text-right">Status</th>
                      <th className="px-4 py-3 text-right">Indexing</th>
                      <th className="px-4 py-3 text-right">Score</th>
                      <th className="px-4 py-3 text-right">Words</th>
                      <th className="px-4 py-3 text-right">H1s</th>
                      <th className="px-4 py-3 text-right">Images</th>
                      <th className="px-4 py-3 text-right">Inlinks</th>
                      <th className="px-4 py-3 text-right">Outlinks</th>
                      <th className="px-4 py-3 text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {auditPages.slice(0, 100).map((p) => {
                      const indexingState = getIndexingState(p);
                      const searchCandidate = indexingState === "indexable";
                      return (
                        <tr key={p.id} className="hover:bg-muted/20">
                          <td className="max-w-md truncate px-4 py-2.5 font-medium" title={p.url}>
                            {p.url}
                          </td>
                          <td className="px-4 py-2.5 text-right font-data">
                            <span
                              className={cn(
                                p.statusCode >= 400
                                  ? "text-danger"
                                  : p.statusCode >= 300
                                    ? "text-warning"
                                    : "text-signal"
                              )}
                            >
                              {p.statusCode}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right font-data">
                            <span
                              className={cn(
                                "text-xs",
                                indexingState === "indexable" && "text-signal",
                                indexingState === "canonicalized" && "text-warning",
                                indexingState === "excluded" && "text-muted-foreground",
                                indexingState === "non_success" && "text-danger"
                              )}
                            >
                              {indexingState === "non_success"
                                ? "Non-2xx"
                                : indexingState.charAt(0).toUpperCase() + indexingState.slice(1)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right font-data">
                            <span
                              className={cn(
                                !searchCandidate
                                  ? "text-muted-foreground"
                                  : p.contentScore >= 70
                                    ? "text-signal"
                                    : p.contentScore >= 50
                                      ? "text-warning"
                                      : "text-danger"
                              )}
                            >
                              {searchCandidate ? p.contentScore : "—"}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right font-data text-muted-foreground">
                            {p.wordCount}
                          </td>
                          <td className="px-4 py-2.5 text-right font-data text-muted-foreground">
                            {p.h1Count}
                          </td>
                          <td className="px-4 py-2.5 text-right font-data text-muted-foreground">
                            {p.imagesMissingAlt > 0 ? (
                              <span className="text-warning">
                                {p.imagesMissingAlt}/{p.imageCount}
                              </span>
                            ) : (
                              p.imageCount
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right font-data text-muted-foreground">
                            {inlinkCount.get(p.url) ?? 0}
                          </td>
                          <td className="px-4 py-2.5 text-right font-data text-muted-foreground">
                            {p.internalLinks}
                          </td>
                          <td className="px-4 py-2.5 text-right font-data text-muted-foreground">
                            {p.responseTimeMs}ms
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Issues list with remediation */}
          <div className="panel overflow-hidden">
            <div className="border-b border-border/60 px-5 py-4">
              <h3 className="font-heading text-lg font-semibold">Issues</h3>
              <p className="text-sm text-muted-foreground">
                Critical {bySeverity.CRITICAL} · Warning {bySeverity.WARNING} · Info{" "}
                {bySeverity.INFO}
              </p>
            </div>
            {realIssues.length === 0 ? (
              <p className="px-5 py-8 text-sm text-muted-foreground">No issues found</p>
            ) : (
              <ul className="divide-y divide-border/40">
                {realIssues.slice(0, 100).map((issue) => {
                  const details = issue.details as { howToFix?: string; kind?: string } | null;
                  return (
                    <li key={issue.id} className="px-5 py-3">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="font-medium text-foreground">{issue.message}</p>
                          <p className="truncate text-xs text-muted-foreground">{issue.url}</p>
                          <p className="mt-0.5 font-data text-[11px] text-muted-foreground">
                            {issue.type.replace(/_/g, " ")}
                            {details?.kind === "orphan" ? " · orphan" : ""}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                            issue.severity === "CRITICAL" && "bg-danger/15 text-danger",
                            issue.severity === "WARNING" && "bg-warning/15 text-warning",
                            issue.severity === "INFO" && "bg-muted text-muted-foreground"
                          )}
                        >
                          {issue.severity}
                        </span>
                      </div>
                      {details?.howToFix && (
                        <p className="mt-1.5 rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                          <span className="font-semibold text-foreground/80">Fix: </span>
                          {details.howToFix}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "mid" | "bad";
}) {
  return (
    <div className="panel p-4">
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-2 font-heading text-2xl font-semibold",
          tone === "good" && "text-signal",
          tone === "mid" && "text-warning",
          tone === "bad" && "text-danger"
        )}
      >
        {value}
        {hint && (
          <span className="ml-1 text-sm font-normal text-muted-foreground">{hint}</span>
        )}
      </p>
    </div>
  );
}
