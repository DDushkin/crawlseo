import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { syncGa4Site } from "@/lib/google/ga4-sync";

export async function POST(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session.user.id }, select: { ga4PropertyId: true } });
  if (!site) return Response.json({ error: "Not found" }, { status: 404 });
  if (!site.ga4PropertyId) return Response.json({ error: "Connect a GA4 property first" }, { status: 409 });
  try {
    return Response.json(await syncGa4Site(siteId, session.user.id, site.ga4PropertyId));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "GA4 sync failed" }, { status: 502 }); }
}
