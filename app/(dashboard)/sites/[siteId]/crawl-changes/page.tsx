import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { CompareCrawlsButton } from "@/components/operator/placement-controls";

export default async function CrawlChangesPage({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  const { siteId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session?.user?.id ?? "" }, select: { domain: true } });
  if (!site) redirect("/sites");
  const comparisons = await db.crawlComparison.findMany({ where: { siteId }, orderBy: { comparedAt: "desc" }, take: 20,
    include: { findings: { orderBy: [{ status: "asc" }, { severity: "asc" }], take: 500 }, crawl: { select: { finishedAt: true, pagesFound: true } }, baselineCrawl: { select: { finishedAt: true } } } });
  return <div><PageHeader eyebrow={site.domain} title="Crawl changes" description="New, persistent, and resolved technical findings between completed crawl snapshots. Uncrawled URLs are not assumed fixed." actions={<CompareCrawlsButton siteId={siteId} />} />
    <div className="space-y-4">{comparisons.map((comparison) => <section key={comparison.id} className="panel p-5"><h2 className="font-heading text-lg font-semibold">{comparison.crawl.finishedAt?.toISOString().slice(0, 10) || "Completed crawl"}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{comparison.baselineCrawl ? `Compared with ${comparison.baselineCrawl.finishedAt?.toISOString().slice(0, 10)} · ` : "First successful baseline · "}{comparison.crawl.pagesFound} pages checked</p>
      <p className="mt-3 text-sm">{comparison.newCount} new · {comparison.persistentCount} persistent · {comparison.resolvedCount} resolved</p>
      <div className="mt-3 max-h-[36rem] overflow-y-auto">{comparison.findings.map((finding) => <div key={finding.id} className="border-t border-border/60 py-2 text-sm"><span className="mr-2 font-semibold">{finding.status}</span><span className="mr-2 text-muted-foreground">{finding.severity}</span>{finding.type.replaceAll("_", " ")}<span className="block break-all text-xs text-muted-foreground">{finding.url}</span></div>)}</div>
    </section>)}{comparisons.length === 0 && <p className="panel p-5 text-sm text-muted-foreground">No comparison yet. Run a crawl, then compare the latest completed snapshot. The first successful crawl establishes the baseline.</p>}</div>
  </div>;
}
