import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { emptyBriefPlan, updateBriefPlan, type BriefPlan } from "@/lib/operator/briefs";

export async function PATCH(req: Request, { params }: { params: Promise<{ siteId: string; briefId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId, briefId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session.user.id }, select: { id: true } });
  if (!site) return Response.json({ error: "Not found" }, { status: 404 });
  const brief = await db.contentBrief.findFirst({ where: { id: briefId, siteId }, select: { id: true, content: true } });
  if (!brief) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || !body.plan || (body.status && !["DRAFT", "READY"].includes(body.status))) {
    return Response.json({ error: "Valid plan and status required" }, { status: 400 });
  }
  try {
    const content = brief.content && typeof brief.content === "object" && !Array.isArray(brief.content) ? brief.content : {};
    const updated = updateBriefPlan({ ...content, plan: (content.plan || emptyBriefPlan()) as BriefPlan }, body.plan as BriefPlan);
    const saved = await db.contentBrief.update({ where: { id: briefId, siteId },
      data: { content: updated as Prisma.InputJsonValue, status: body.status === "READY" ? "READY" : "DRAFT" },
      select: { id: true, status: true, updatedAt: true } });
    return Response.json({ brief: saved });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid brief" }, { status: 400 });
  }
}
