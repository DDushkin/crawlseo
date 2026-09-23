import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { BriefEditor } from "@/components/operator/brief-editor";
import type { BriefPlan } from "@/lib/operator/briefs";

export default async function ContentBriefsPage({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  const { siteId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session?.user?.id ?? "" }, select: { domain: true } });
  if (!site) redirect("/sites");
  const briefs = await db.contentBrief.findMany({ where: { siteId }, orderBy: { createdAt: "desc" }, take: 100,
    include: { target: { select: { query: true, decision: true } }, page: { select: { url: true } } } });
  return <div><PageHeader eyebrow={site.domain} title="Content briefs" description="Evidence snapshots and writing direction for your copywriter. No page is published automatically." />
    <div className="space-y-4">{briefs.map((brief) => {
      const content = brief.content as { gscEvidence?: { clicks: number; impressions: number; startDate: string; endDate: string } | null; competitorStatus?: string; competitorEvidence?: { domain: string; url: string; position: number | null }[]; nextStep?: string; suggestedStructure?: string[]; aiCitability?: string;
        intent?: string | null; pageEvidence?: { crawledAt: string; title: string | null; description: string | null; indexable: boolean; canonical: string | null; hasSchema: boolean; internalLinks: number } | null;
        queryPageEvidence?: { url: string; impressions: number }[]; cannibalizationReview?: { status: string; qualification: string };
        crawlChecks?: string[]; expertiseSignals?: string[]; serpStatus?: string; serpQuestionsStatus?: string; entitiesStatus?: string; plan?: BriefPlan;
        serpEvidence?: { observedAt: string | null; locationCode: number | null; languageCode: string | null; organic: { url: string; title: string; position: number | null }[]; questions: string[]; relatedSearches: string[] } | null };
      return <article key={brief.id} className="panel p-5"><div className="flex flex-wrap justify-between gap-2"><h2 className="font-heading text-lg font-semibold">{brief.title}</h2><span className="text-xs text-muted-foreground">{brief.createdAt.toISOString().slice(0, 10)} · {brief.status}</span></div>
        <p className="mt-2 text-sm text-muted-foreground">{brief.page?.url || "New page or rejected target"}</p>
        <p className="mt-3 text-sm">{content.nextStep}</p>
        <p className="mt-3 text-xs text-muted-foreground">Intent: {content.intent || "to confirm"} · GSC query: {content.gscEvidence ? `${content.gscEvidence.clicks} clicks, ${content.gscEvidence.impressions} impressions (${content.gscEvidence.startDate}–${content.gscEvidence.endDate})` : "unavailable"} · Competitor research: {content.competitorStatus || "unavailable"}</p>
        {!!content.competitorEvidence?.length && <ul className="mt-2 text-xs text-muted-foreground">{content.competitorEvidence.map((item) => <li key={item.url}><a className="text-signal hover:underline" href={item.url} target="_blank" rel="noopener noreferrer">{item.domain}</a> · position {item.position ?? "unknown"}</li>)}</ul>}
        <div className="mt-4 grid gap-3 text-sm md:grid-cols-2"><div className="rounded-lg border border-border p-3"><h3 className="font-medium">Latest completed crawl</h3>{content.pageEvidence ? <p className="mt-1 text-xs text-muted-foreground">{content.pageEvidence.crawledAt.slice(0, 10)} · {content.pageEvidence.indexable ? "indexable" : "not indexable"} · {content.pageEvidence.internalLinks} internal links out · schema {content.pageEvidence.hasSchema ? "observed" : "not observed"}</p> : <p className="mt-1 text-xs text-muted-foreground">Unavailable for this page.</p>}{!!content.crawlChecks?.length && <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">{content.crawlChecks.map((check) => <li key={check}>{check}</li>)}</ul>}</div>
          <div className="rounded-lg border border-border p-3"><h3 className="font-medium">Query-to-page overlap</h3><p className="mt-1 text-xs text-muted-foreground">{content.cannibalizationReview?.status || "UNAVAILABLE"} · {content.cannibalizationReview?.qualification || "No complete query-to-page evidence"}</p>{!!content.queryPageEvidence?.length && <ul className="mt-2 space-y-1 text-xs">{content.queryPageEvidence.map((row) => <li key={row.url}>{row.impressions} impressions · <a href={row.url} target="_blank" rel="noopener noreferrer" className="break-all text-signal hover:underline">{row.url}</a></li>)}</ul>}</div></div>
        <div className="mt-4 rounded-lg border border-border p-3 text-sm"><h3 className="font-medium">Google SERP research · {content.serpStatus || "UNAVAILABLE"}</h3>{content.serpEvidence ? <><p className="mt-1 text-xs text-muted-foreground">DataForSEO Live · {content.serpEvidence.languageCode}/{content.serpEvidence.locationCode} · observed {content.serpEvidence.observedAt || "time unavailable"}. A sampled SERP, not a stable ranking report.</p><ul className="mt-2 space-y-1 text-xs">{content.serpEvidence.organic.map((item) => <li key={item.url}>#{item.position ?? "?"} <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-signal hover:underline">{item.title || item.url}</a></li>)}</ul><p className="mt-2 text-xs">Observed questions: {content.serpEvidence.questions.length ? content.serpEvidence.questions.join(" · ") : "none returned"}</p><p className="mt-1 text-xs">Related searches: {content.serpEvidence.relatedSearches.length ? content.serpEvidence.relatedSearches.join(" · ") : "none returned"}</p></> : <p className="mt-1 text-xs text-muted-foreground">Research this query from the Keyword Map with cost preview, then create a new brief. No SERP questions or competitor content gaps are invented.</p>}</div>
        <p className="mt-3 text-xs text-muted-foreground">SERP questions: {content.serpQuestionsStatus || "UNAVAILABLE"} · Entities: {content.entitiesStatus || "UNAVAILABLE"}. Verify concepts and expertise claims with your copywriter.</p>
        <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm">{content.suggestedStructure?.map((line) => <li key={line}>{line}</li>)}</ol>
        <p className="mt-3 text-sm text-muted-foreground">AI citation readiness: {content.aiCitability}</p>
        {!!content.expertiseSignals?.length && <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">{content.expertiseSignals.map((signal) => <li key={signal}>{signal}</li>)}</ul>}
        <BriefEditor siteId={siteId} briefId={brief.id} initial={content.plan} status={brief.status} />
      </article>;
    })}{briefs.length === 0 && <p className="panel p-5 text-sm text-muted-foreground">No briefs yet. Confirm a target in the keyword map, then create an evidence brief.</p>}</div>
  </div>;
}
