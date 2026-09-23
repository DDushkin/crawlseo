import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { pacificDateLabel } from "@/lib/gsc/date-range";
import { prismaGscMetricReader } from "@/lib/operator/outcome-store";
import { comparisonWindow, observedOutcome, outcomeReady, readGscMetricWindow } from "@/lib/operator/outcomes";

export async function GET(_req: Request, { params }: { params: Promise<{ siteId: string; placementId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId, placementId } = await params;
  if (!await db.site.findFirst({ where: { id: siteId, userId: session.user.id }, select: { id: true } })) return Response.json({ error: "Not found" }, { status: 404 });
  const placement = await db.placement.findFirst({ where: { id: placementId, siteId }, select: { publishedAt: true, targetUrl: true } });
  if (!placement) return Response.json({ error: "Not found" }, { status: 404 });
  if (!placement.publishedAt) return Response.json({ status: "NOT_PUBLISHED", qualification: "Add a publication date to measure this placement." });
  const window = comparisonWindow(placement.publishedAt.toISOString().slice(0, 10));
  if (!outcomeReady(window.afterEnd, pacificDateLabel(new Date()))) return Response.json({ status: "PENDING", window,
    qualification: "Wait for a complete 28-day post-publication window and GSC finalization." });
  const [before, after] = await Promise.all([
    readGscMetricWindow(siteId, "PAGE", placement.targetUrl, { startDate: window.baselineStart, endDate: window.baselineEnd }, prismaGscMetricReader),
    readGscMetricWindow(siteId, "PAGE", placement.targetUrl, { startDate: window.afterStart, endDate: window.afterEnd }, prismaGscMetricReader),
  ]);
  if (!after) return Response.json({ status: "PENDING", window, qualification: "Post-publication GSC page coverage is incomplete." });
  const outcome = observedOutcome({ baselineClicks: before?.clicks ?? null, baselineImpressions: before?.impressions ?? null,
    afterClicks: after.clicks, afterImpressions: after.impressions });
  return Response.json({ ...outcome, baseline: before, after, window,
    qualification: outcome.status === "OBSERVED" ? "Page-level GSC difference after publication. This does not attribute the change to the link." : outcome.qualification });
}
