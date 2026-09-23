import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDataForSeoSettings, LIVE_SITE_BUDGET_USD } from "@/lib/dataforseo/gateway";

async function ownedSite(siteId: string, userId: string) {
  return db.site.findFirst({ where: { id: siteId, userId }, select: { id: true, domain: true } });
}

export async function GET(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  const site = await ownedSite(siteId, session.user.id);
  if (!site) return Response.json({ error: "Not found" }, { status: 404 });
  const settings = await getDataForSeoSettings(siteId, site.domain);
  const runs = await db.dataForSeoRun.findMany({
    where: { siteId }, orderBy: { createdAt: "desc" }, take: 10,
    select: { id: true, operation: true, target: true, mode: true, status: true, estimatedUsd: true, chargedUsd: true, createdAt: true },
  });
  return Response.json({ settings: { ...settings, budgetUsd: LIVE_SITE_BUDGET_USD }, runs });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  const site = await ownedSite(siteId, session.user.id);
  if (!site) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || !["SANDBOX", "LIVE"].includes(body.mode) || !Number.isInteger(body.locationCode) ||
      body.locationCode < 1 || body.locationCode > 999999 || !/^[a-z]{2,5}$/.test(body.languageCode ?? "")) {
    return Response.json({ error: "Invalid mode, location code, or language code" }, { status: 400 });
  }
  if (body.mode === "LIVE") {
    if (body.acknowledgePaid !== true) return Response.json({ error: "Explicit paid-usage acknowledgement required" }, { status: 400 });
    const key = await db.apiKey.findUnique({ where: { userId_provider: { userId: session.user.id, provider: "dataforseo" } }, select: { id: true } });
    if (!key) return Response.json({ error: "Connect your API key before enabling Live mode" }, { status: 409 });
  }
  const settings = await db.dataForSeoSettings.upsert({
    where: { siteId },
    create: { siteId, mode: body.mode, locationCode: body.locationCode, languageCode: body.languageCode },
    update: { mode: body.mode, locationCode: body.locationCode, languageCode: body.languageCode },
  });
  return Response.json({ settings: { ...settings, budgetUsd: LIVE_SITE_BUDGET_USD } });
}
