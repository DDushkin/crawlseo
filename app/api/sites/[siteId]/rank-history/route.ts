import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

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
      select: { userId: true },
    });
    if (!site || site.userId !== session.user.id) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const url = new URL(req.url);
    const query = url.searchParams.get("query");
    const days = parseInt(url.searchParams.get("days") || "90", 10);

    if (!query) {
      return Response.json(
        { error: "Missing required param: query" },
        { status: 400 }
      );
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    // Fetch from both Keyword table and RankSnapshot in parallel
    const [keywordRows, snapshots] = await Promise.all([
      db.keyword.findMany({
        where: {
          siteId,
          query,
          date: { gte: startDate },
        },
        select: {
          date: true,
          position: true,
          clicks: true,
          impressions: true,
        },
        orderBy: { date: "asc" },
      }),
      db.rankSnapshot.findMany({
        where: {
          siteId,
          query,
          date: { gte: startDate },
        },
        select: {
          date: true,
          position: true,
          clicks: true,
          impressions: true,
        },
        orderBy: { date: "asc" },
      }),
    ]);

    // Merge data by date, preferring RankSnapshot when both exist
    const byDate = new Map<
      string,
      { date: string; position: number; clicks: number; impressions: number }
    >();

    // Aggregate keyword rows by date (may have multiple per date for different devices/countries)
    for (const row of keywordRows) {
      const dateStr = row.date.toISOString().split("T")[0];
      const existing = byDate.get(dateStr);
      if (existing) {
        existing.clicks += row.clicks;
        existing.impressions += row.impressions;
        // Use weighted average for position
        existing.position =
          (existing.position * (existing.impressions - row.impressions) +
            row.position * row.impressions) /
          existing.impressions;
      } else {
        byDate.set(dateStr, {
          date: dateStr,
          position: row.position,
          clicks: row.clicks,
          impressions: row.impressions,
        });
      }
    }

    // Overlay RankSnapshot data (takes precedence)
    for (const snap of snapshots) {
      const dateStr = snap.date.toISOString().split("T")[0];
      byDate.set(dateStr, {
        date: dateStr,
        position: snap.position,
        clicks: snap.clicks,
        impressions: snap.impressions,
      });
    }

    const history = [...byDate.values()].sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    return Response.json(history);
  } catch (error) {
    console.error("Rank history error:", error);
    return Response.json(
      { error: "Failed to load rank history" },
      { status: 500 }
    );
  }
}
