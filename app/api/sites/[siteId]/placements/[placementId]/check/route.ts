import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { verifyPublishedArticle } from "@/lib/operator/placements";

export async function POST(_req: Request, { params }: { params: Promise<{ siteId: string; placementId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId, placementId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session.user.id }, select: { id: true } });
  if (!site) return Response.json({ error: "Not found" }, { status: 404 });
  const placement = await db.placement.findFirst({ where: { id: placementId, siteId }, select: { id: true, articleUrl: true, targetUrl: true } });
  if (!placement) return Response.json({ error: "Not found" }, { status: 404 });
  const result = await verifyPublishedArticle(placement.articleUrl, placement.targetUrl);
  const check = await db.placementCheck.create({ data: { siteId, placementId, source: "LIVE_HTML", ...result } });
  return Response.json({ check });
}
