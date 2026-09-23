import { db } from "@/lib/db";
import { isAuthorizedCronRequest } from "@/lib/gsc/cron-auth";
import { pacificDateLabel } from "@/lib/gsc/date-range";
import { evaluateDueChanges } from "@/lib/operator/outcomes";
import { prismaEvaluationStore } from "@/lib/operator/outcome-store";

export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sites = await db.site.findMany({
    where: { seoChanges: { some: { outcome: { is: null } } } },
    select: { id: true },
  });
  const asOf = pacificDateLabel(new Date());
  let sitesProcessed = 0;
  let sitesFailed = 0;
  let outcomesEvaluated = 0;
  for (const site of sites) {
    try {
      const result = await evaluateDueChanges(site.id, asOf, prismaEvaluationStore);
      outcomesEvaluated += result.evaluated;
      sitesProcessed++;
    } catch {
      sitesFailed++;
    }
  }
  return Response.json({ sitesProcessed, sitesFailed, outcomesEvaluated });
}
