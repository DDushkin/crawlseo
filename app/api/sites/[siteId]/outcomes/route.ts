import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { pacificDateLabel } from "@/lib/gsc/date-range";
import { evaluateDueChanges } from "@/lib/operator/outcomes";
import { prismaEvaluationStore } from "@/lib/operator/outcome-store";

async function ownedSite(siteId: string, userId: string) {
  return db.site.findFirst({ where: { id: siteId, userId }, select: { id: true } });
}

export async function GET(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  if (!await ownedSite(siteId, session.user.id)) return Response.json({ error: "Not found" }, { status: 404 });
  const outcomes = await db.seoOutcome.findMany({
    where: { siteId }, orderBy: { evaluatedAt: "desc" }, take: 100,
    include: { change: { select: { description: true, changedAt: true, metricScope: true, metricKey: true, baselineStart: true, baselineEnd: true, afterStart: true, afterEnd: true, baselineClicks: true, baselineImpressions: true } } },
  });
  return Response.json({ outcomes });
}

export async function POST(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  if (!await ownedSite(siteId, session.user.id)) return Response.json({ error: "Not found" }, { status: 404 });
  const result = await evaluateDueChanges(siteId, pacificDateLabel(new Date()), prismaEvaluationStore);
  return Response.json(result);
}
