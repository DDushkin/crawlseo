import { db } from "@/lib/db";
import { isAuthorizedCronRequest } from "@/lib/gsc/cron-auth";
import { syncGa4Site } from "@/lib/google/ga4-sync";

export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sites = await db.site.findMany({ where: { ga4PropertyId: { not: null } }, select: { id: true, userId: true, ga4PropertyId: true } });
  const results: { siteId: string; state: string; aiRows?: number; error?: string }[] = [];
  for (const site of sites) {
    if (!site.ga4PropertyId) continue;
    try { const result = await syncGa4Site(site.id, site.userId, site.ga4PropertyId);
      results.push({ siteId: site.id, state: "COMPLETE", aiRows: result.aiRows }); }
    catch (error) { results.push({ siteId: site.id, state: "FAILED", error: error instanceof Error ? error.message.slice(0, 200) : "GA4 sync failed" }); }
  }
  return Response.json({ results });
}
