import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { previewAiPanel } from "@/lib/operator/ai-panel-run";
import { recentAiWindow, summarizeCitationPanel } from "@/lib/operator/ai-visibility";

export async function GET(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session.user.id }, select: { gscProperty: true, ga4PropertyId: true, lastGa4SyncAt: true } });
  if (!site) return Response.json({ error: "Not found" }, { status: 404 });
  const window = recentAiWindow();
  const [gscAi, referrals, organic, runs, imports] = await Promise.all([
    db.gscAiDaily.findMany({ where: { siteId, property: site.gscProperty || "", date: window.db }, orderBy: { date: "asc" } }),
    db.aiReferralDaily.findMany({ where: { siteId, date: window.db }, orderBy: { date: "asc" } }),
    db.ga4OrganicDaily.findMany({ where: { siteId, date: window.db }, orderBy: { date: "asc" } }),
    db.aiVisibilityRun.findMany({ where: { siteId }, orderBy: { startedAt: "desc" }, take: 20, include: { results: true } }),
    db.gscAiImport.findMany({ where: { siteId }, orderBy: { importedAt: "desc" }, take: 5 }),
  ]);
  return Response.json({ property: site.gscProperty, ga4PropertyId: site.ga4PropertyId, lastGa4SyncAt: site.lastGa4SyncAt,
    window: { startDate: window.startDate, endDate: window.endDate },
    googleAi: { source: "GSC_EXPORT", impressions: gscAi.reduce((sum, day) => sum + day.impressions, 0), days: gscAi },
    aiReferrals: { source: "GA4", sessions: referrals.reduce((sum, day) => sum + day.sessions, 0),
      keyEvents: referrals.reduce((sum, day) => sum + day.keyEvents, 0), days: referrals },
    organic: { source: "GA4", sessions: organic.reduce((sum, day) => sum + day.sessions, 0),
      keyEvents: organic.reduce((sum, day) => sum + day.keyEvents, 0), days: organic },
    panelRuns: runs.map((run) => ({ ...run, summary: summarizeCitationPanel({ mode: run.mode, promptCount: run.promptCount,
      results: run.results.map((result) => ({ status: result.status, siteCited: result.siteCited,
        sources: Array.isArray(result.sources) ? result.sources as { domain: string; url: string }[] : [] })) }) })),
    imports });
}

export async function POST(req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session.user.id }, select: { domain: true } });
  if (!site) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || body.confirm !== true || !Array.isArray(body.promptIds) || typeof body.maxUsd !== "number") {
    return Response.json({ error: "Preview and confirm the exact panel cost first" }, { status: 400 });
  }
  try {
    const preview = await previewAiPanel(siteId, site.domain);
    const ids = preview.prompts.map((prompt) => prompt.id);
    if (JSON.stringify(ids) !== JSON.stringify(body.promptIds) || preview.estimatedUsd > body.maxUsd || body.maxUsd < 0) {
      return Response.json({ error: "Panel or cost changed; preview again" }, { status: 409 });
    }
    if (preview.mode === "LIVE" && preview.estimatedUsd + preview.spentUsd + preview.reservedUsd > preview.budgetUsd) {
      return Response.json({ error: "Panel exceeds the site DataForSEO budget" }, { status: 409 });
    }
    const run = await db.aiVisibilityRun.create({ data: { siteId, activeKey: siteId, mode: preview.mode,
      locationCode: preview.locationCode, languageCode: preview.languageCode, promptCount: preview.prompts.length,
      promptSnapshots: preview.prompts.map((prompt) => ({ id: prompt.id, fingerprint: prompt.fingerprint, question: prompt.question })) },
      select: { id: true } });
    return Response.json({ runId: run.id, status: "QUEUED", estimatedUsd: preview.estimatedUsd }, { status: 202 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ error: "An AI panel run is already queued or running" }, { status: 409 });
    }
    return Response.json({ error: error instanceof Error ? error.message : "AI panel unavailable" }, { status: 400 });
  }
}
