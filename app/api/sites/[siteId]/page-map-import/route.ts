import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { preparePageMapImport, type ImportRow } from "@/lib/operator/import";

export async function POST(req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session.user.id }, select: { domain: true } });
  if (!site) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.rows) || body.rows.some((row: unknown) => !row || typeof row !== "object" || Array.isArray(row))) {
    return Response.json({ error: "Invalid rows" }, { status: 400 });
  }
  let prepared: ReturnType<typeof preparePageMapImport>;
  try { prepared = preparePageMapImport(site.domain, body.rows as ImportRow[], body.country || "UA", body.language || "uk"); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid import" }, { status: 400 }); }
  await db.$transaction(async (tx) => {
    const ids = new Map<string, string>();
    for (const page of prepared.pages) {
      const saved = await tx.sitePage.upsert({ where: { siteId_url: { siteId, url: page.url } },
        create: { siteId, url: page.url, pageType: page.pageType }, update: page.pageType ? { pageType: page.pageType } : {}, select: { id: true } });
      ids.set(page.url, saved.id);
    }
    for (const target of prepared.targets) {
      await tx.keywordTarget.upsert({ where: { siteId_query_country_language: { siteId, query: target.query, country: target.country, language: target.language } },
        create: { siteId, query: target.query, country: target.country, language: target.language, pageId: ids.get(target.url)!, decision: "OPTIMIZE_EXISTING", source: "IMPORT", intent: target.intent, notes: target.notes },
        update: { pageId: ids.get(target.url)!, decision: "OPTIMIZE_EXISTING", intent: target.intent, notes: target.notes } });
    }
  });
  return Response.json({ pages: prepared.pages.length, targets: prepared.targets.length });
}
