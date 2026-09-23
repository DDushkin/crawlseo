import { db } from "@/lib/db";
import { isAuthorizedCronRequest } from "@/lib/gsc/cron-auth";
import { processNextAiPanelPrompt } from "@/lib/operator/ai-panel-run";

export const maxDuration = 180;

export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const run = await db.aiVisibilityRun.findFirst({ where: { status: { in: ["QUEUED", "RUNNING"] },
    OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, orderBy: { startedAt: "asc" }, select: { id: true } });
  if (!run) return Response.json({ status: "IDLE" });
  try {
    const result = await processNextAiPanelPrompt(run.id);
    return Response.json({ runId: run.id, ...result });
  } catch (error) {
    return Response.json({ runId: run.id, status: "INTERRUPTED",
      error: error instanceof Error ? error.message : "AI panel worker interrupted" }, { status: 500 });
  }
}
