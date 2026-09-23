import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";

export default async function ContentBriefsPage({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  const { siteId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session?.user?.id ?? "" }, select: { domain: true } });
  if (!site) redirect("/sites");
  const briefs = await db.contentBrief.findMany({ where: { siteId }, orderBy: { createdAt: "desc" }, take: 100,
    include: { target: { select: { query: true, decision: true } }, page: { select: { url: true } } } });
  return <div><PageHeader eyebrow={site.domain} title="Content briefs" description="Evidence snapshots and writing direction for your copywriter. No page is published automatically." />
    <div className="space-y-4">{briefs.map((brief) => {
      const content = brief.content as { gscEvidence?: { clicks: number; impressions: number; startDate: string; endDate: string } | null; competitorStatus?: string; competitorEvidence?: { domain: string; url: string; position: number | null }[]; nextStep?: string; suggestedStructure?: string[]; aiCitability?: string };
      return <article key={brief.id} className="panel p-5"><div className="flex flex-wrap justify-between gap-2"><h2 className="font-heading text-lg font-semibold">{brief.title}</h2><span className="text-xs text-muted-foreground">{brief.createdAt.toISOString().slice(0, 10)} · {brief.status}</span></div>
        <p className="mt-2 text-sm text-muted-foreground">{brief.page?.url || "New page or rejected target"}</p>
        <p className="mt-3 text-sm">{content.nextStep}</p>
        <p className="mt-3 text-xs text-muted-foreground">GSC: {content.gscEvidence ? `${content.gscEvidence.clicks} clicks, ${content.gscEvidence.impressions} impressions (${content.gscEvidence.startDate}–${content.gscEvidence.endDate})` : "unavailable"} · Competitor research: {content.competitorStatus || "unavailable"}</p>
        {!!content.competitorEvidence?.length && <ul className="mt-2 text-xs text-muted-foreground">{content.competitorEvidence.map((item) => <li key={item.url}><a className="text-signal hover:underline" href={item.url} target="_blank" rel="noopener noreferrer">{item.domain}</a> · position {item.position ?? "unknown"}</li>)}</ul>}
        <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm">{content.suggestedStructure?.map((line) => <li key={line}>{line}</li>)}</ol>
        <p className="mt-3 text-sm text-muted-foreground">AI citation readiness: {content.aiCitability}</p>
      </article>;
    })}{briefs.length === 0 && <p className="panel p-5 text-sm text-muted-foreground">No briefs yet. Confirm a target in the keyword map, then create an evidence brief.</p>}</div>
  </div>;
}
