import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { DataForSeoError, executeDataForSeo } from "@/lib/dataforseo/gateway";
import { normalizeOperatorEvidence, type OperatorKind } from "@/lib/dataforseo/operator-decisions";

const kinds: OperatorKind[] = ["competitor_gap", "placement", "ai_citation"];

async function ownedSite(siteId: string, userId: string) {
  return db.site.findFirst({ where: { id: siteId, userId }, select: { domain: true } });
}

export async function GET(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  const site = await ownedSite(siteId, session.user.id);
  if (!site) return Response.json({ error: "Not found" }, { status: 404 });

  const runs = await db.dataForSeoRun.findMany({
    where: { siteId, operation: { in: ["competitor_gap", "placement_check", "ai_citation"] }, status: "SUCCEEDED" },
    orderBy: { createdAt: "desc" }, take: 20,
    select: { operation: true, target: true, mode: true, chargedUsd: true, createdAt: true, response: true },
  });
  const history = runs.filter((run) => run.response).map((run) => {
    const kind: OperatorKind = run.operation === "placement_check" ? "placement" : run.operation as OperatorKind;
    return {
      kind, target: run.target, mode: run.mode, chargedUsd: run.chargedUsd, createdAt: run.createdAt,
      ...normalizeOperatorEvidence(kind, run.response as Parameters<typeof normalizeOperatorEvidence>[1], site.domain, run.target),
    };
  });
  return Response.json({ history });
}

export async function POST(req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  const site = await ownedSite(siteId, session.user.id);
  if (!site) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || body.confirm !== true || !kinds.includes(body.kind) || typeof body.target !== "string") {
    return Response.json({ error: "Preview and confirm this provider request first" }, { status: 400 });
  }
  try {
    const result = await executeDataForSeo(siteId, session.user.id, site.domain, body.kind, body.target, 20);
    return Response.json({
      kind: body.kind, target: result.target, mode: result.mode, cached: result.cached, chargedUsd: result.chargedUsd,
      ...normalizeOperatorEvidence(body.kind, result.results[0] as Parameters<typeof normalizeOperatorEvidence>[1], site.domain, result.target),
    });
  } catch (error) {
    if (error instanceof DataForSeoError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
