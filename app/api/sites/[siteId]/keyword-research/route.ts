import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseKeywordResults } from "@/lib/dataforseo/client";
import { DataForSeoError, executeDataForSeo } from "@/lib/dataforseo/gateway";
import { fetchSuggestions } from "@/lib/google/autocomplete";

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

    const url = new URL(req.url);
    const query = url.searchParams.get("q");
    if (!query) {
      return Response.json({ error: "Missing query parameter: q" }, { status: 400 });
    }

    // GET is deliberately free. DataForSEO requires an explicit POST.
    const suggestions = await fetchSuggestions(query);
    return Response.json({
      source: "autocomplete",
      keywords: suggestions.map((s) => ({
        keyword: s,
        volume: null,
        difficulty: null,
        cpc: null,
        competition: null,
        trend: null,
      })),
    });
  } catch (error) {
    console.error("Keyword research error:", error);
    return Response.json(
      { error: "Keyword research failed" },
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
  if (!body || body.confirm !== true || typeof body.query !== "string") {
    return Response.json({ error: "Preview and confirm this provider request first" }, { status: 400 });
  }
  try {
    const result = await executeDataForSeo(siteId, session.user.id, site.domain, "keywords", body.query);
    return Response.json({
      source: result.mode === "SANDBOX" ? "dataforseo-sandbox" : "dataforseo-live",
      keywords: parseKeywordResults(result.results[0] as Parameters<typeof parseKeywordResults>[0]),
      meta: { mode: result.mode, cached: result.cached, chargedUsd: result.chargedUsd },
    });
  } catch (error) {
    if (error instanceof DataForSeoError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
