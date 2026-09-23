import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { previewAiPanel } from "@/lib/operator/ai-panel-run";

export async function POST(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session.user.id }, select: { domain: true } });
  if (!site) return Response.json({ error: "Not found" }, { status: 404 });
  try { const preview = await previewAiPanel(siteId, site.domain);
    return Response.json({ ...preview, promptIds: preview.prompts.map((prompt) => prompt.id), prompts: preview.prompts.map((prompt) => ({ question: prompt.question, country: prompt.country, language: prompt.language })) }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Panel preview unavailable" }, { status: 400 }); }
}
