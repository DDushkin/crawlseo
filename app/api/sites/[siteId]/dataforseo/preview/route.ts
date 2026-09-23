import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { DataForSeoError, previewDataForSeo, type DataForSeoKind } from "@/lib/dataforseo/gateway";

export async function POST(req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session.user.id }, select: { domain: true } });
  if (!site) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || !["keywords", "domain", "backlinks"].includes(body.kind) || typeof body.target !== "string") {
    return Response.json({ error: "Invalid preview request" }, { status: 400 });
  }
  try {
    return Response.json(await previewDataForSeo(siteId, site.domain, body.kind as DataForSeoKind, body.target, body.limit));
  } catch (error) {
    if (error instanceof DataForSeoError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
