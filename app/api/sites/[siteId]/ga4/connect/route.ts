import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { fetchGa4Report } from "@/lib/google/ga4-client";

export async function POST(req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  if (!await db.site.findFirst({ where: { id: siteId, userId: session.user.id }, select: { id: true } })) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const propertyId = typeof body?.propertyId === "string" ? body.propertyId.trim().replace(/^properties\//, "") : "";
  if (!/^\d{1,20}$/.test(propertyId)) return Response.json({ error: "Enter a numeric GA4 property ID" }, { status: 400 });
  try {
    await fetchGa4Report(session.user.id, propertyId, "yesterday", "yesterday");
    await db.site.update({ where: { id: siteId }, data: { ga4PropertyId: propertyId, lastGa4SyncAt: null } });
    return Response.json({ propertyId });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not connect GA4" }, { status: 409 }); }
}
