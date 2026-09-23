import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseSerpBrief } from "@/lib/dataforseo/client";
import { DataForSeoError, executeDataForSeo, getDataForSeoSettings, previewDataForSeo } from "@/lib/dataforseo/gateway";
import { countryForDataForSeoLocation } from "@/lib/operator/ai-visibility";

/** Explicit one-keyword SERP research; opening a brief or map never sends a paid request. */
export async function POST(req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session.user.id }, select: { domain: true } });
  if (!site) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.targetId !== "string") return Response.json({ error: "Keyword target required" }, { status: 400 });
  const target = await db.keywordTarget.findFirst({ where: { id: body.targetId, siteId }, select: { query: true, country: true, language: true } });
  if (!target) return Response.json({ error: "Keyword target not found" }, { status: 404 });
  try {
    const settings = await getDataForSeoSettings(siteId, site.domain);
    if (countryForDataForSeoLocation(settings.locationCode) !== target.country || settings.languageCode !== target.language) {
      return Response.json({ error: "Set this site's DataForSEO market to match the keyword target before SERP research" }, { status: 409 });
    }
    const preview = await previewDataForSeo(siteId, site.domain, "serp_brief", target.query, 10);
    if (body.confirm !== true) return Response.json({ ...preview, query: target.query });
    if (typeof body.maxUsd !== "number" || !Number.isFinite(body.maxUsd) || body.maxUsd < preview.estimatedUsd) {
      return Response.json({ error: "SERP cost changed; preview again" }, { status: 409 });
    }
    const result = await executeDataForSeo(siteId, session.user.id, site.domain, "serp_brief", target.query, 10);
    return Response.json({ mode: result.mode, cached: result.cached, chargedUsd: result.chargedUsd,
      evidence: result.mode === "LIVE" ? parseSerpBrief(result.results[0] as Parameters<typeof parseSerpBrief>[0]) : null });
  } catch (error) {
    if (error instanceof DataForSeoError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: error instanceof Error ? error.message : "SERP research unavailable" }, { status: 400 });
  }
}
