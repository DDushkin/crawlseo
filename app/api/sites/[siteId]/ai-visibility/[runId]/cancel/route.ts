import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(_request: Request, { params }: { params: Promise<{ siteId: string; runId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId, runId } = await params;
  const run = await db.aiVisibilityRun.findFirst({ where: { id: runId, siteId, site: { userId: session.user.id } }, select: { id: true, status: true } });
  if (!run) return Response.json({ error: "Not found" }, { status: 404 });
  if (run.status !== "QUEUED") return Response.json({ error: "Wait for the current request to finish before cancelling" }, { status: 409 });
  const result = await db.aiVisibilityRun.updateMany({ where: { id: runId, siteId, status: "QUEUED" },
    data: { status: "CANCELLED", activeKey: null, leaseUntil: null, finishedAt: new Date() } });
  return result.count ? Response.json({ status: "CANCELLED" }) : Response.json({ error: "Run changed; refresh and try again" }, { status: 409 });
}
