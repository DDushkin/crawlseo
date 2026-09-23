import { db } from "@/lib/db";
import { toDbDate } from "@/lib/gsc/date-range";
import { fetchGa4Report, parseGa4TrafficRows } from "./ga4-client";

/** Shared manual/scheduled sync. Replace normalized rows only after a complete valid GA4 response. */
export async function syncGa4Site(siteId: string, userId: string, propertyId: string, now = new Date()) {
  const end = new Date(now.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
  const start = new Date(now.getTime() - 91 * 86_400_000).toISOString().slice(0, 10);
  const report = await fetchGa4Report(userId, propertyId, start, end);
  const rows = parseGa4TrafficRows(report);
  await db.$transaction(async (tx) => {
    const updated = await tx.site.updateMany({ where: { id: siteId, userId, ga4PropertyId: propertyId }, data: { lastGa4SyncAt: new Date() } });
    if (updated.count !== 1) throw new Error("GA4 property changed during sync");
    const range = { gte: toDbDate(start), lte: toDbDate(end) };
    await tx.aiReferralDaily.deleteMany({ where: { siteId, date: range } });
    await tx.ga4OrganicDaily.deleteMany({ where: { siteId, date: range } });
    if (rows.ai.length) await tx.aiReferralDaily.createMany({ data: rows.ai.map((row) => ({ siteId, date: toDbDate(row.date), source: row.source,
      sessions: row.sessions, keyEvents: row.keyEvents })) });
    if (rows.organic.length) await tx.ga4OrganicDaily.createMany({ data: rows.organic.map((row) => ({ siteId, date: toDbDate(row.date),
      sessions: row.sessions, keyEvents: row.keyEvents })) });
  });
  return { start, end, aiRows: rows.ai.length, organicRows: rows.organic.length,
    qualification: "GA4 sessions and key events from identifiable AI referrers; direct or stripped referrers cannot be identified." };
}
