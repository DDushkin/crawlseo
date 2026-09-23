import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeAiPrompt, promptFingerprint } from "@/lib/operator/ai-prompts";

export async function PATCH(req: Request, { params }: { params: Promise<{ siteId: string; promptId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId, promptId } = await params;
  if (!await db.site.findFirst({ where: { id: siteId, userId: session.user.id }, select: { id: true } })) return Response.json({ error: "Not found" }, { status: 404 });
  const existing = await db.aiPrompt.findFirst({ where: { id: promptId, siteId } });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid update" }, { status: 400 });
  let input: ReturnType<typeof normalizeAiPrompt>;
  try { input = normalizeAiPrompt({ question: body.question ?? existing.question,
    country: body.country ?? existing.country, language: body.language ?? existing.language,
    platform: existing.platform, intent: body.intent === null ? null : body.intent ?? existing.intent }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid prompt" }, { status: 400 }); }
  if (body.active !== undefined && typeof body.active !== "boolean") return Response.json({ error: "Active must be true or false" }, { status: 400 });
  try {
    const prompt = await db.aiPrompt.update({ where: { id: promptId }, data: { ...input,
      fingerprint: promptFingerprint(input), active: body.active ?? existing.active } });
    return Response.json({ prompt });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return Response.json({ error: "This question is already in the panel" }, { status: 409 });
    throw error;
  }
}
