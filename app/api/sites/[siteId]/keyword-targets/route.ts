import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeTargetQuery, validateKeywordDecision } from "@/lib/operator/pages";

async function ownedSite(siteId: string, userId: string) {
  return db.site.findFirst({ where: { id: siteId, userId }, select: { id: true, domain: true } });
}

export async function GET(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  if (!await ownedSite(siteId, session.user.id)) return Response.json({ error: "Not found" }, { status: 404 });
  const targets = await db.keywordTarget.findMany({
    where: { siteId }, orderBy: { updatedAt: "desc" }, take: 500,
    include: { page: { select: { id: true, url: true } }, _count: { select: { briefs: true } } },
  });
  return Response.json({ targets });
}

export async function POST(req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  if (!await ownedSite(siteId, session.user.id)) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.query !== "string" || typeof body.decision !== "string" ||
      typeof body.country !== "string" || typeof body.language !== "string") {
    return Response.json({ error: "Query, decision, country, and language required" }, { status: 400 });
  }
  let query: string;
  try {
    query = normalizeTargetQuery(body.query);
    validateKeywordDecision(body.decision, typeof body.pageId === "string" ? body.pageId : null);
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid target" }, { status: 400 }); }
  const country = body.country.trim().toUpperCase();
  const language = body.language.trim().toLowerCase();
  if (!/^[A-Z]{2}$/.test(country) || !/^[a-z]{2}$/.test(language)) {
    return Response.json({ error: "Use two-letter country and language codes" }, { status: 400 });
  }
  const pageId = typeof body.pageId === "string" ? body.pageId : null;
  if (pageId && !await db.sitePage.findFirst({ where: { id: pageId, siteId }, select: { id: true } })) {
    return Response.json({ error: "Target page not found" }, { status: 404 });
  }
  const role = body.role === "SUPPORTING" ? "SUPPORTING" : "PRIMARY";
  const intent = typeof body.intent === "string" && body.intent.length <= 80 ? body.intent.trim() || null : null;
  const notes = typeof body.notes === "string" && body.notes.length <= 2000 ? body.notes.trim() || null : null;
  const target = await db.keywordTarget.upsert({
    where: { siteId_query_country_language: { siteId, query, country, language } },
    create: { siteId, query, country, language, decision: body.decision, pageId, role, intent, notes, source: "MANUAL" },
    update: { decision: body.decision, pageId, role, intent, notes },
  });
  return Response.json({ target });
}
