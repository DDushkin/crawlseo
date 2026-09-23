import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { compareAndStoreCompletedCrawl } from "@/lib/operator/crawl-diff";

export async function GET(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  if (!await db.site.findFirst({ where: { id: siteId, userId: session.user.id }, select: { id: true } })) return Response.json({ error: "Not found" }, { status: 404 });
  const comparisons = await db.crawlComparison.findMany({ where: { siteId }, orderBy: { comparedAt: "desc" }, take: 20,
    include: { findings: { take: 500 }, crawl: { select: { finishedAt: true, pagesFound: true } }, baselineCrawl: { select: { finishedAt: true } } } });
  return Response.json({ comparisons });
}

export async function POST(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  if (!await db.site.findFirst({ where: { id: siteId, userId: session.user.id }, select: { id: true } })) return Response.json({ error: "Not found" }, { status: 404 });
  const crawl = await db.crawl.findFirst({ where: { siteId, status: "COMPLETED" }, orderBy: { finishedAt: "desc" }, select: { id: true } });
  if (!crawl) return Response.json({ error: "No completed crawl" }, { status: 404 });
  const comparison = await compareAndStoreCompletedCrawl(siteId, crawl.id);
  return Response.json({ comparison });
}
