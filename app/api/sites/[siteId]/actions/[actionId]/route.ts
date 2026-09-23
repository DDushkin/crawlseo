import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { validateActionTransition, type ActionStatus } from "@/lib/operator/actions";

const editableStatuses: ActionStatus[] = ["NEW", "PLANNED", "IN_PROGRESS", "DISMISSED"];

export async function PATCH(req: Request, { params }: { params: Promise<{ siteId: string; actionId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId, actionId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session.user.id }, select: { id: true } });
  if (!site) return Response.json({ error: "Not found" }, { status: 404 });
  const action = await db.seoAction.findFirst({ where: { id: actionId, siteId }, select: { id: true, status: true } });
  if (!action) return Response.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "Invalid request" }, { status: 400 });
  const status = body.status as ActionStatus | undefined;
  if (status !== undefined && !editableStatuses.includes(status)) {
    return Response.json({ error: "Complete actions with a recorded change" }, { status: 400 });
  }
  if (status && !validateActionTransition(action.status as ActionStatus, status)) {
    return Response.json({ error: "Invalid status transition" }, { status: 409 });
  }
  if (body.notes !== undefined && (typeof body.notes !== "string" || body.notes.length > 4000)) {
    return Response.json({ error: "Notes must be at most 4000 characters" }, { status: 400 });
  }
  if (body.owner !== undefined && body.owner !== null && (typeof body.owner !== "string" || body.owner.length > 120)) {
    return Response.json({ error: "Invalid owner" }, { status: 400 });
  }
  if (body.dueAt !== undefined && body.dueAt !== null && (typeof body.dueAt !== "string" || Number.isNaN(Date.parse(body.dueAt)))) {
    return Response.json({ error: "Invalid due date" }, { status: 400 });
  }
  const data = {
    ...(status ? { status, dismissedUntil: status === "DISMISSED" ? null : undefined } : {}),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
    ...(body.owner !== undefined ? { owner: body.owner } : {}),
    ...(body.dueAt !== undefined ? { dueAt: body.dueAt ? new Date(body.dueAt) : null } : {}),
  };
  if (Object.keys(data).length === 0) return Response.json({ error: "No changes supplied" }, { status: 400 });
  const updated = await db.seoAction.update({ where: { id: actionId }, data });
  return Response.json({ action: updated });
}
