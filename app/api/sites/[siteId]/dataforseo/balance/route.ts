import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { DataForSeoError, getDataForSeoAccountBalance } from "@/lib/dataforseo/gateway";

export async function GET(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session.user.id }, select: { id: true } });
  if (!site) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    const balanceUsd = await getDataForSeoAccountBalance(session.user.id);
    return Response.json({ balanceUsd, source: "dataforseo-account", billable: false });
  } catch (error) {
    if (error instanceof DataForSeoError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Account balance check failed" }, { status: 502 });
  }
}
