import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseCompetitorGap, parseSerpBrief } from "@/lib/dataforseo/client";
import { buildContentBrief } from "@/lib/operator/briefs";
import { countryForDataForSeoLocation } from "@/lib/operator/ai-visibility";
import { getGscSavedQueryMetrics, getStoredGscRange, hasCompleteGscReportCoverage } from "@/lib/seo-metrics";
import { toDbDate } from "@/lib/gsc/date-range";

async function ownedSite(siteId: string, userId: string) {
  return db.site.findFirst({ where: { id: siteId, userId }, select: { id: true, domain: true, gscProperty: true, gscSearchType: true } });
}

export async function GET(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  if (!await ownedSite(siteId, session.user.id)) return Response.json({ error: "Not found" }, { status: 404 });
  const briefs = await db.contentBrief.findMany({
    where: { siteId }, orderBy: { createdAt: "desc" }, take: 100,
    include: { target: { select: { query: true, decision: true } }, page: { select: { url: true } } },
  });
  return Response.json({ briefs });
}

export async function POST(req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  const site = await ownedSite(siteId, session.user.id);
  if (!site) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.targetId !== "string") return Response.json({ error: "Keyword target required" }, { status: 400 });
  const target = await db.keywordTarget.findFirst({
    where: { id: body.targetId, siteId }, include: { page: { select: { url: true } } },
  });
  if (!target) return Response.json({ error: "Keyword target not found" }, { status: 404 });

  let gsc: { clicks: number; impressions: number; position: number | null; startDate: string; endDate: string } | null = null;
  let queryPageEvidence: Array<{ url: string; impressions: number }> = [];
  if (site.gscProperty) {
    const range = await getStoredGscRange(siteId, 28);
    if (range && await hasCompleteGscReportCoverage(siteId, "query", range)) {
      const row = (await getGscSavedQueryMetrics(siteId, [target.query], 28)).get(target.query);
      gsc = { clicks: row?.clicks ?? 0, impressions: row?.impressions ?? 0, position: row?.position ?? null, ...range };
    }
    if (range && await hasCompleteGscReportCoverage(siteId, "queryPage", range)) {
      const rows = await db.gscQueryPageDaily.groupBy({ by: ["url"], where: { siteId, property: site.gscProperty,
        searchType: site.gscSearchType, query: target.query,
        date: { gte: toDbDate(range.startDate), lte: toDbDate(range.endDate) }, syncRun: { property: site.gscProperty } },
        _sum: { impressions: true }, orderBy: { _sum: { impressions: "desc" } }, take: 10 });
      queryPageEvidence = rows.map((row) => ({ url: row.url, impressions: row._sum.impressions ?? 0 }));
    }
  }

  const crawl = target.page?.url ? await db.crawl.findFirst({ where: { siteId, status: "COMPLETED" },
    orderBy: { finishedAt: "desc" }, select: { id: true, finishedAt: true } }) : null;
  const audited = crawl && target.page?.url ? await db.auditPage.findFirst({ where: { crawlId: crawl.id, url: target.page.url },
    select: { title: true, description: true, canonical: true, indexable: true, hasSchema: true, internalLinks: true } }) : null;
  const pageEvidence = crawl?.finishedAt && audited ? { source: "CRAWL" as const, crawledAt: crawl.finishedAt.toISOString(), ...audited } : null;

  const runs = await db.dataForSeoRun.findMany({
    where: { siteId, operation: "competitor_gap", mode: "LIVE", status: "SUCCEEDED" },
    orderBy: { createdAt: "desc" }, take: 10,
    select: { target: true, response: true, createdAt: true },
  });
  const competitorResults = runs.flatMap((run) => {
    if (!run.response) return [];
    return parseCompetitorGap(run.response as Parameters<typeof parseCompetitorGap>[0])
      .filter((item) => item.keyword.toLocaleLowerCase() === target.query && item.competitorUrl)
      .map((item) => ({ domain: run.target, url: item.competitorUrl!, query: item.keyword,
        position: item.competitorRank, observedAt: run.createdAt.toISOString() }));
  });
  const serpRun = await db.dataForSeoRun.findFirst({ where: { siteId, operation: "serp_brief", target: target.query,
    mode: "LIVE", status: "SUCCEEDED", expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, select: { response: true } });
  const observedSerp = serpRun?.response ? parseSerpBrief(serpRun.response as Parameters<typeof parseSerpBrief>[0]) : null;
  const serpEvidence = observedSerp && countryForDataForSeoLocation(observedSerp.locationCode ?? 0) === target.country &&
    observedSerp.languageCode === target.language ? observedSerp : null;
  const content = buildContentBrief({
    decision: target.decision as Parameters<typeof buildContentBrief>[0]["decision"],
    query: target.query, intent: target.intent, pageUrl: target.page?.url ?? null, gsc, competitorResults,
    pageEvidence, queryPageEvidence, serpEvidence,
  });
  const brief = await db.contentBrief.create({
    data: { siteId, targetId: target.id, pageId: target.pageId, title: `${target.query} — ${target.decision.toLowerCase().replaceAll("_", " ")}`, content },
    select: { id: true, title: true, createdAt: true },
  });
  return Response.json({ brief }, { status: 201 });
}
