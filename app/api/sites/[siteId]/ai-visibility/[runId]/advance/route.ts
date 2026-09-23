import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { processNextAiPanelPrompt } from "@/lib/operator/ai-panel-run";

export const maxDuration = 180;

export async function POST(_request: Request, { params }: { params: Promise<{ siteId: string; runId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId, runId } = await params;
  const run = await db.aiVisibilityRun.findFirst({ where: { id: runId, siteId, site: { userId: session.user.id } }, select: { id: true } });
  if (!run) return Response.json({ error: "Not found" }, { status: 404 });
  try { return Response.json(await processNextAiPanelPrompt(run.id)); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "AI panel interrupted" }, { status: 502 }); }
}
