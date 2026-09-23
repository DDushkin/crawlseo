import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session.user.id }, select: { id: true } });
  if (!site) return Response.json({ error: "Not found" }, { status: 404 });

  const status = new URL(req.url).searchParams.get("status");
  const allowed = ["NEW", "PLANNED", "IN_PROGRESS", "COMPLETED", "DISMISSED", "MONITORING"];
  if (status && !allowed.includes(status)) return Response.json({ error: "Invalid status" }, { status: 400 });
  const actions = await db.seoAction.findMany({
    where: { siteId, ...(status ? { status } : {}) },
    orderBy: [{ priority: "desc" }, { lastSeenAt: "desc" }],
    take: 100,
  });
  return Response.json({ actions });
}
