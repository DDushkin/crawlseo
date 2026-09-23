import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { completeAction } from "@/lib/operator/outcomes";
import { prismaCompletionStore } from "@/lib/operator/outcome-store";

export async function POST(req: Request, { params }: { params: Promise<{ siteId: string; actionId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId, actionId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session.user.id }, select: { id: true } });
  if (!site) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.description !== "string" || typeof body.changedAt !== "string") {
    return Response.json({ error: "Describe the change and its date" }, { status: 400 });
  }
  try {
    const change = await completeAction(siteId, actionId, {
      description: body.description, changedAt: body.changedAt,
    }, prismaCompletionStore);
    return Response.json({ change }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not complete action";
    if (message === "Action not found") return Response.json({ error: "Not found" }, { status: 404 });
    if (/status changed|not ready/.test(message)) return Response.json({ error: message }, { status: 409 });
    if (/date|Describe/.test(message)) return Response.json({ error: message }, { status: 400 });
    throw error;
  }
}
