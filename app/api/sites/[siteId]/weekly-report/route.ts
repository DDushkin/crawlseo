import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadWeeklyReport } from "@/lib/operator/weekly-report";

export async function GET(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session.user.id }, select: { id: true } });
  if (!site) return Response.json({ error: "Not found" }, { status: 404 });
  const endDate = new URL(request.url).searchParams.get("endDate") ?? undefined;
  try { return Response.json(await loadWeeklyReport(siteId, new Date(), endDate)); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Report unavailable" }, { status: 400 }); }
}
