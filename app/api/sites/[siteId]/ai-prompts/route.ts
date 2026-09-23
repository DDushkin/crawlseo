import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeAiPrompt, promptFingerprint } from "@/lib/operator/ai-prompts";

async function ownedSite(siteId: string, userId: string) {
  return db.site.findFirst({ where: { id: siteId, userId }, select: { id: true } });
}

export async function GET(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  if (!await ownedSite(siteId, session.user.id)) return Response.json({ error: "Not found" }, { status: 404 });
  const prompts = await db.aiPrompt.findMany({ where: { siteId }, orderBy: [{ active: "desc" }, { createdAt: "asc" }], take: 100 });
  return Response.json({ prompts });
}

export async function POST(req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  if (!await ownedSite(siteId, session.user.id)) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  let input: ReturnType<typeof normalizeAiPrompt>;
  try { input = normalizeAiPrompt(body); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid prompt" }, { status: 400 }); }
  const fingerprint = promptFingerprint(input);
  const prompt = await db.aiPrompt.upsert({ where: { siteId_fingerprint: { siteId, fingerprint } },
    create: { siteId, fingerprint, ...input }, update: { active: true, intent: input.intent },
  });
  return Response.json({ prompt });
}
