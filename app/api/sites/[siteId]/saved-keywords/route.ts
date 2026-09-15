import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getGscLatestQueryMetric } from "@/lib/seo-metrics";

export async function GET(
  _req: Request,
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
      select: { userId: true },
    });
    if (!site || site.userId !== session.user.id) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const savedKeywords = await db.savedKeyword.findMany({
      where: { siteId },
      orderBy: { createdAt: "desc" },
    });

    // Fetch latest rank data for each saved keyword
    const withRankData = await Promise.all(
      savedKeywords.map(async (sk) => {
        const latestKeyword = await getGscLatestQueryMetric(siteId, sk.query);

        return {
          id: sk.id,
          query: sk.query,
          notes: sk.notes,
          createdAt: sk.createdAt,
          latestRank: latestKeyword ? {
            clicks: latestKeyword.clicks,
            impressions: latestKeyword.impressions,
            ctr: latestKeyword.ctr,
            position: latestKeyword.position,
            page: latestKeyword.page,
            date: latestKeyword.date,
          } : null,
        };
      })
    );

    return Response.json(withRankData);
  } catch (error) {
    console.error("Saved keywords GET error:", error);
    return Response.json(
      { error: "Failed to load saved keywords" },
      { status: 500 }
    );
  }
}

export async function POST(
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
      select: { userId: true },
    });
    if (!site || site.userId !== session.user.id) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const body = (await req.json()) as { query?: string; notes?: string };
    if (!body.query || typeof body.query !== "string") {
      return Response.json(
        { error: "Missing required field: query" },
        { status: 400 }
      );
    }

    const saved = await db.savedKeyword.upsert({
      where: {
        siteId_query: {
          siteId,
          query: body.query,
        },
      },
      create: {
        siteId,
        query: body.query,
        notes: body.notes ?? null,
      },
      update: {
        notes: body.notes ?? undefined,
      },
    });

    return Response.json(saved, { status: 201 });
  } catch (error) {
    console.error("Saved keywords POST error:", error);
    return Response.json(
      { error: "Failed to save keyword" },
      { status: 500 }
    );
  }
}

export async function DELETE(
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
      select: { userId: true },
    });
    if (!site || site.userId !== session.user.id) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const body = (await req.json()) as { query?: string };
    if (!body.query || typeof body.query !== "string") {
      return Response.json(
        { error: "Missing required field: query" },
        { status: 400 }
      );
    }

    await db.savedKeyword.delete({
      where: {
        siteId_query: {
          siteId,
          query: body.query,
        },
      },
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error("Saved keywords DELETE error:", error);
    return Response.json(
      { error: "Failed to delete saved keyword" },
      { status: 500 }
    );
  }
}
