import { db } from "@/lib/db";
import { isAuthorizedCronRequest } from "@/lib/gsc/cron-auth";
import { refreshGscActions } from "@/lib/operator/detect-service";

export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sites = await db.site.findMany({ where: { gscProperty: { not: null }, gscDataVersion: 2 }, select: { id: true } });
  const results: { siteId: string; state: string; detected: number }[] = [];
  for (const site of sites) {
    try { const result = await refreshGscActions(site.id); results.push({ siteId: site.id, state: result.state, detected: result.detected }); }
    catch { results.push({ siteId: site.id, state: "FAILED", detected: 0 }); }
  }
  return Response.json({ results });
}
