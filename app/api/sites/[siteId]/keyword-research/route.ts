import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { keywordResearch } from "@/lib/dataforseo/client";
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

    // Try DataForSEO first
    const dfResults = await keywordResearch(session.user.id, query);

    if (dfResults !== null) {
      return Response.json({
        source: "dataforseo",
        keywords: dfResults,
      });
    }

    // Fallback to Google Autocomplete
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
