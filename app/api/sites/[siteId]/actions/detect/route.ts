import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { refreshGscActions } from "@/lib/operator/detect-service";

export async function POST(_request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session.user.id }, select: { id: true } });
  if (!site) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(await refreshGscActions(siteId));
}
