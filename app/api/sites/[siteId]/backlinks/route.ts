import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseBacklinksOverview, parseBacklinksProfile } from "@/lib/dataforseo/client";
import { DataForSeoError, executeDataForSeo } from "@/lib/dataforseo/gateway";

async function getOwnedSite(siteId: string, userId: string) {
  return db.site.findFirst({ where: { id: siteId, userId }, select: { domain: true } });
}

export async function GET(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  if (!await getOwnedSite(siteId, session.user.id)) return Response.json({ error: "Not found" }, { status: 404 });
  // Outgoing external links discovered by a crawl are not inbound backlinks.
  return Response.json({ source: "none", overview: null, backlinks: [] });
}

export async function POST(req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  const site = await getOwnedSite(siteId, session.user.id);
  if (!site) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || body.confirm !== true) return Response.json({ error: "Preview and confirm this provider request first" }, { status: 400 });
  try {
    const result = await executeDataForSeo(siteId, session.user.id, site.domain, "backlinks", site.domain, body.limit);
    return Response.json({
      source: result.mode === "SANDBOX" ? "dataforseo-sandbox" : "dataforseo-live",
      overview: parseBacklinksOverview(result.results[0] as Parameters<typeof parseBacklinksOverview>[0]),
      backlinks: parseBacklinksProfile(result.results[1] as Parameters<typeof parseBacklinksProfile>[0]),
      meta: { mode: result.mode, cached: result.cached, chargedUsd: result.chargedUsd },
    });
  } catch (error) {
    if (error instanceof DataForSeoError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
