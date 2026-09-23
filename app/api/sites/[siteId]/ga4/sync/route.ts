import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { toDbDate } from "@/lib/gsc/date-range";
import { fetchGa4Report, parseGa4TrafficRows } from "@/lib/google/ga4-client";

export async function POST(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session.user.id }, select: { ga4PropertyId: true } });
  if (!site) return Response.json({ error: "Not found" }, { status: 404 });
  if (!site.ga4PropertyId) return Response.json({ error: "Connect a GA4 property first" }, { status: 409 });
  const end = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  const start = new Date(Date.now() - 91 * 86_400_000).toISOString().slice(0, 10);
  try {
    const report = await fetchGa4Report(session.user.id, site.ga4PropertyId, start, end);
    const rows = parseGa4TrafficRows(report);
    await db.$transaction(async (tx) => {
      const updated = await tx.site.updateMany({ where: { id: siteId, ga4PropertyId: site.ga4PropertyId }, data: { lastGa4SyncAt: new Date() } });
      if (updated.count !== 1) throw new Error("GA4 property changed during sync");
      const range = { gte: toDbDate(start), lte: toDbDate(end) };
      await tx.aiReferralDaily.deleteMany({ where: { siteId, date: range } });
      await tx.ga4OrganicDaily.deleteMany({ where: { siteId, date: range } });
      if (rows.ai.length) await tx.aiReferralDaily.createMany({ data: rows.ai.map((row) => ({ siteId, date: toDbDate(row.date), source: row.source,
        sessions: row.sessions, keyEvents: row.keyEvents })) });
      if (rows.organic.length) await tx.ga4OrganicDaily.createMany({ data: rows.organic.map((row) => ({ siteId, date: toDbDate(row.date),
        sessions: row.sessions, keyEvents: row.keyEvents })) });
    });
    return Response.json({ start, end, aiRows: rows.ai.length, organicRows: rows.organic.length,
      qualification: "GA4 sessions and key events from identifiable AI referrers; direct or stripped referrers cannot be identified." });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "GA4 sync failed" }, { status: 502 }); }
}
