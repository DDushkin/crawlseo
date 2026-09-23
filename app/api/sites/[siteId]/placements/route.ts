import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizePlacement } from "@/lib/operator/placements";

async function ownedSite(siteId: string, userId: string) {
  return db.site.findFirst({ where: { id: siteId, userId }, select: { domain: true } });
}

export async function GET(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  if (!await ownedSite(siteId, session.user.id)) return Response.json({ error: "Not found" }, { status: 404 });
  const placements = await db.placement.findMany({ where: { siteId }, orderBy: { createdAt: "desc" }, take: 200,
    include: { checks: { orderBy: { checkedAt: "desc" }, take: 1 } } });
  return Response.json({ placements });
}

export async function POST(req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  const site = await ownedSite(siteId, session.user.id);
  if (!site) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.articleUrl !== "string" || typeof body.targetUrl !== "string" ||
      typeof body.costUah !== "number" || typeof body.feeUah !== "number") {
    return Response.json({ error: "Article, target, and UAH cost required" }, { status: 400 });
  }
  let input: ReturnType<typeof normalizePlacement>;
  try { input = normalizePlacement(site.domain, body); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid placement" }, { status: 400 }); }
  const status = body.status === "PUBLISHED" ? "PUBLISHED" : "PLANNED";
  const publishedAt = typeof body.publishedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.publishedAt) &&
    !Number.isNaN(Date.parse(`${body.publishedAt}T00:00:00Z`)) ? new Date(`${body.publishedAt}T00:00:00Z`) : null;
  if (status === "PUBLISHED" && !publishedAt) return Response.json({ error: "Publication date required" }, { status: 400 });
  const anchorText = typeof body.anchorText === "string" ? body.anchorText.trim().slice(0, 200) || null : null;
  const articleTitle = typeof body.articleTitle === "string" ? body.articleTitle.trim().slice(0, 300) || null : null;
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) || null : null;
  const placement = await db.$transaction(async (tx) => {
    const page = await tx.sitePage.upsert({ where: { siteId_url: { siteId, url: input.targetUrl } },
      create: { siteId, url: input.targetUrl }, update: {}, select: { id: true } });
    return tx.placement.upsert({ where: { siteId_articleUrl_targetUrl: { siteId, articleUrl: input.articleUrl, targetUrl: input.targetUrl } },
      create: { siteId, pageId: page.id, publisher: input.publisher, articleUrl: input.articleUrl,
        targetUrl: input.targetUrl, anchorText, articleTitle, costUah: input.costUah, feeUah: input.feeUah,
        status, publishedAt, notes },
      update: { pageId: page.id, anchorText, articleTitle, costUah: input.costUah, feeUah: input.feeUah,
        status, publishedAt, notes } });
  });
  return Response.json({ placement });
}
