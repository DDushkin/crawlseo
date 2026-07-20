import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  backlinksOverview,
  backlinksProfile,
} from "@/lib/dataforseo/client";

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
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);

    // Try DataForSEO
    const [overview, profile] = await Promise.all([
      backlinksOverview(session.user.id, site.domain),
      backlinksProfile(session.user.id, site.domain, limit, offset),
    ]);

    if (overview !== null) {
      return Response.json({
        source: "dataforseo",
        overview,
        backlinks: profile ?? [],
      });
    }

    // Fallback: external links from our own crawl data
    const latestCrawl = await db.crawl.findFirst({
      where: { siteId, status: "COMPLETED" },
      orderBy: { finishedAt: "desc" },
      select: { id: true },
    });

    if (latestCrawl) {
      const externalLinks = await db.auditLink.findMany({
        where: { crawlId: latestCrawl.id, isInternal: false },
        take: limit,
        skip: offset,
        select: {
          sourceUrl: true,
          targetUrl: true,
          anchorText: true,
          isNofollow: true,
        },
      });

      return Response.json({
        source: "crawl",
        overview: null,
        backlinks: externalLinks.map((link) => ({
          referringDomain: "",
          sourceUrl: link.sourceUrl,
          targetUrl: link.targetUrl,
          anchorText: link.anchorText ?? "",
          dofollow: !link.isNofollow,
          firstSeen: null,
          lastSeen: null,
        })),
      });
    }

    return Response.json({
      source: "none",
      overview: null,
      backlinks: [],
    });
  } catch (error) {
    console.error("Backlinks error:", error);
    return Response.json({ error: "Backlinks fetch failed" }, { status: 500 });
  }
}
