import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeSitePageUrl } from "@/lib/operator/pages";

async function ownedSite(siteId: string, userId: string) {
  return db.site.findFirst({ where: { id: siteId, userId }, select: { id: true, domain: true } });
}

export async function GET(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  if (!await ownedSite(siteId, session.user.id)) return Response.json({ error: "Not found" }, { status: 404 });
  const pages = await db.sitePage.findMany({
    where: { siteId }, orderBy: { url: "asc" }, take: 500,
    include: { _count: { select: { keywordTargets: true, actions: true, contentBriefs: true } } },
  });
  return Response.json({ pages });
}

export async function POST(req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  const site = await ownedSite(siteId, session.user.id);
  if (!site) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.url !== "string") return Response.json({ error: "Page URL required" }, { status: 400 });
  let url: string;
  try { url = normalizeSitePageUrl(site.domain, body.url); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid URL" }, { status: 400 }); }
  const pageType = typeof body.pageType === "string" && body.pageType.length <= 60 ? body.pageType.trim() || null : null;
  const page = await db.sitePage.upsert({
    where: { siteId_url: { siteId, url } },
    create: { siteId, url, pageType },
    update: { ...(pageType ? { pageType } : {}) },
  });
  return Response.json({ page }, { status: 200 });
}
