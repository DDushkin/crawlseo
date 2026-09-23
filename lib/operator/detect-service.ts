import { db } from "@/lib/db";
import { inclusiveRangeEnding, pacificDateLabel, previousDateRange, shiftDateLabel, toDbDate } from "@/lib/gsc/date-range";
import { getV2GscReportCoverage, hasV2CompleteGscReportCoverage } from "@/lib/gsc/read-model";
import { actionFingerprint, upsertDetectedAction } from "./actions";
import { detectGscFindings } from "./detect";

const GSC_TYPES = ["SITE_TRAFFIC_DECLINE", "PAGE_TRAFFIC_DECLINE", "QUERY_STRIKING_DISTANCE"] as const;

/** Refresh free first-party recommendations only from complete, recent finalized V2 reports. */
export async function refreshGscActions(siteId: string, now = new Date()) {
  const site = await db.site.findUnique({ where: { id: siteId },
    select: { gscProperty: true, gscSearchType: true, gscDataVersion: true } });
  if (!site?.gscProperty || site.gscDataVersion !== 2 || process.env.GSC_READ_MODEL_V2 === "false") {
    return { state: "UNAVAILABLE" as const, detected: 0, reason: "Connect and fully sync Search Console V2 first" };
  }
  const scope = { siteId, property: site.gscProperty, searchType: site.gscSearchType };
  const totalCoverage = await getV2GscReportCoverage(scope, "dailyTotal");
  if (!totalCoverage) return { state: "UNAVAILABLE" as const, detected: 0, reason: "GSC property totals are unavailable" };
  const finalizedEnd = [totalCoverage.endDate, shiftDateLabel(pacificDateLabel(now), -2)].sort()[0];
  if (finalizedEnd < shiftDateLabel(pacificDateLabel(now), -4)) {
    return { state: "STALE" as const, detected: 0, reason: `Latest finalized GSC date is ${finalizedEnd}` };
  }
  const current = inclusiveRangeEnding(finalizedEnd, 28);
  const previous = previousDateRange(current);
  const entire = { startDate: previous.startDate, endDate: current.endDate };
  if (!await hasV2CompleteGscReportCoverage(scope, "dailyTotal", entire)) {
    return { state: "PARTIAL" as const, detected: 0, reason: "Property totals do not cover two full 28-day periods" };
  }
  const [pageReady, queryReady] = await Promise.all([
    hasV2CompleteGscReportCoverage(scope, "page", entire),
    hasV2CompleteGscReportCoverage(scope, "query", current),
  ]);
  const date = { gte: toDbDate(entire.startDate), lte: toDbDate(entire.endDate) };
  const source = { siteId, property: site.gscProperty, searchType: site.gscSearchType, syncRun: { property: site.gscProperty } };
  const [totals, pages, queries] = await Promise.all([
    db.gscDailyTotal.findMany({ where: { ...source, date }, select: { date: true, clicks: true, impressions: true } }),
    pageReady ? db.gscPageDaily.findMany({ where: { ...source, date }, select: { date: true, url: true, clicks: true, impressions: true, position: true } }) : [],
    queryReady ? db.gscQueryDaily.findMany({ where: { ...source, date: { gte: toDbDate(current.startDate), lte: toDbDate(current.endDate) } },
      select: { date: true, query: true, clicks: true, impressions: true, position: true } }) : [],
  ]);
  const findings = detectGscFindings({ property: site.gscProperty, searchType: site.gscSearchType, previous, current,
    totals: totals.map((row) => ({ ...row, date: row.date.toISOString().slice(0, 10) })),
    pages: pages.map((row) => ({ ...row, date: row.date.toISOString().slice(0, 10) })),
    queries: queries.map((row) => ({ ...row, date: row.date.toISOString().slice(0, 10) })) });
  const availableTypes = GSC_TYPES.filter((type) => type === "SITE_TRAFFIC_DECLINE" ||
    type === "PAGE_TRAFFIC_DECLINE" && pageReady || type === "QUERY_STRIKING_DISTANCE" && queryReady);
  await db.$transaction(async (tx) => {
    for (const finding of findings) await upsertDetectedAction(siteId, finding, tx);
    for (const type of availableTypes) {
      const active = findings.filter((finding) => finding.type === type).map(actionFingerprint);
      await tx.seoAction.updateMany({ where: { siteId, type, fingerprint: { notIn: active }, signalActive: true },
        data: { signalActive: false } });
    }
  });
  return { state: pageReady && queryReady ? "FRESH" as const : "PARTIAL" as const,
    detected: findings.length, pageReady, queryReady, current, previous,
    reason: pageReady && queryReady ? null : "Some GSC dimensions are incomplete; only complete sources created actions" };
}
