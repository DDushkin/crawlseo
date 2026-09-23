import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseDomainOverview, parseBacklinksOverview } from "@/lib/dataforseo/client";
import { DataForSeoError, executeDataForSeo } from "@/lib/dataforseo/gateway";
import { getSitePeriodMetrics } from "@/lib/seo-metrics";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ siteId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { siteId } = await params;
    const site = await db.site.findUnique({
      where: { id: siteId },
      select: { userId: true, domain: true },
    });
    if (!site || site.userId !== session.user.id) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    if (new URL(req.url).searchParams.has("domain")) {
      return Response.json({ error: "Competitor data requires a confirmed DataForSEO request" }, { status: 400 });
    }

    const targetDomain = site.domain;
    // GET uses first-party GSC data only; no paid request on page load.
    const metrics = await getSitePeriodMetrics(siteId, 28);

    return Response.json({
      source: "gsc",
      domain: targetDomain,
      overview: {
        organicKeywords: metrics.current.uniqueKeywords,
        organicTraffic: metrics.current.clicks,
        organicCost: null,
        backlinks: null,
        referringDomains: null,
      },
      backlinks: null,
      metrics,
    });
  } catch (error) {
    console.error("Domain overview error:", error);
    return Response.json(
      { error: "Domain overview failed" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session.user.id }, select: { domain: true } });
  if (!site) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || body.confirm !== true || typeof body.target !== "string") {
    return Response.json({ error: "Preview and confirm this provider request first" }, { status: 400 });
  }
  try {
    const result = await executeDataForSeo(siteId, session.user.id, site.domain, "domain", body.target);
    return Response.json({
      source: result.mode === "SANDBOX" ? "dataforseo-sandbox" : "dataforseo-live",
      domain: result.target,
      overview: parseDomainOverview(result.results[0] as Parameters<typeof parseDomainOverview>[0]),
      backlinks: parseBacklinksOverview(result.results[1] as Parameters<typeof parseBacklinksOverview>[0]),
      meta: { mode: result.mode, cached: result.cached, chargedUsd: result.chargedUsd },
    });
  } catch (error) {
    if (error instanceof DataForSeoError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
